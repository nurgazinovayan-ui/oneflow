#!/usr/bin/env python3
"""Bring over what `supabase db dump` leaves out, and list what must not travel as-is.

    managed_extras.py          (OLD_DB_URL and NEW_DB_URL in the environment; psql on PATH)

`supabase db dump` skips the auth and storage schemas entirely, so these never reach the new server:
  * your own triggers on auth/storage tables (e.g. "create a profile when a user signs up"):
    re-created here when their function lives outside auth/storage (Supabase's own triggers
    already exist on the new server, in the version that matches it);
  * RLS policies on auth/storage tables (e.g. who may upload into which bucket): re-created here.
Each statement runs on its own; a failure is reported and the rest continue.

Reported, not copied (as-is they would make the new server call the OLD project):
  * pg_cron jobs: name and schedule only, the command can hold secrets;
  * database webhooks (triggers calling supabase_functions.http_request): disabled on the new
    server until they are re-pointed at the new address;
  * functions whose source mentions supabase.co;
  * tables published to Realtime, Vault secrets.
Prints names and counts only, never row contents or function bodies. Exit code 1 if something
could not be re-created.
"""
import base64
import os
import subprocess
import sys

OLD = os.environ["OLD_DB_URL"]
NEW = os.environ["NEW_DB_URL"]
MANAGED = ("auth", "storage")
SYSTEM_SCHEMAS = (
    "auth", "storage", "extensions", "graphql", "graphql_public", "pgbouncer", "realtime",
    "supabase_functions", "supabase_migrations", "vault", "pgsodium", "pgsodium_masks", "net", "cron",
    "pg_catalog", "information_schema", "_realtime", "_analytics", "_supavisor",
)


def q(url: str, sql: str) -> list[list[str]]:
    out = subprocess.run(["psql", url, "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True, timeout=600)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip().splitlines()[-1] if out.stderr.strip() else "psql error")
    return [line.split("\t") for line in out.stdout.splitlines() if line]


def run(url: str, sql: str) -> str:
    """Execute one statement; '' on success, else the last error line."""
    out = subprocess.run(["psql", url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True, timeout=600)
    if out.returncode == 0:
        return ""
    lines = [l for l in out.stderr.strip().splitlines() if l.strip()]
    return lines[0][:160] if lines else "psql error"


def b64(expr: str) -> str:
    # statements may contain tabs or newlines; base64 keeps them out of the TSV
    return f"translate(encode(convert_to({expr}, 'UTF8'), 'base64'), E'\\n', '')"


def unb64(s: str) -> str:
    return base64.b64decode(s).decode("utf-8")


def qi(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def schemas_sql(names) -> str:
    return ", ".join(f"'{n}'" for n in names)


def main() -> int:
    failed = 0
    new_tables = {r[0] for r in q(NEW, f"""
        select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p') and n.nspname in ({schemas_sql(MANAGED)})""")}

    # --- triggers on auth/storage tables whose function is yours (outside auth/storage) ----------
    print("  Свои триггеры на таблицах auth/storage (например, «создать профиль при регистрации»):")
    old_trg = q(OLD, f"""
        select n.nspname, c.relname, t.tgname, {b64('pg_get_triggerdef(t.oid)')}, t.tgenabled
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
        where not t.tgisinternal and n.nspname in ({schemas_sql(MANAGED)})
          and pn.nspname not in ({schemas_sql(MANAGED)})
        order by 1, 2, 3""")
    new_trg = {r[0] for r in q(NEW, f"""
        select n.nspname || '.' || c.relname || '.' || t.tgname
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        where not t.tgisinternal and n.nspname in ({schemas_sql(MANAGED)})""")}
    if not old_trg:
        print("    нет")
    for schema, table, name, defn, enabled in old_trg:
        label = f"{schema}.{table}: {name}"
        if f"{schema}.{table}.{name}" in new_trg:
            print(f"    = {label} — уже есть")
            continue
        if f"{schema}.{table}" not in new_tables:
            print(f"    ✗ {label} — таблицы нет на этом сервере")
            failed += 1
            continue
        err = run(NEW, unb64(defn))
        if not err and enabled in ("D", "R", "A"):
            mode = {"D": "DISABLE", "R": "ENABLE REPLICA", "A": "ENABLE ALWAYS"}[enabled]
            err = run(NEW, f"ALTER TABLE {qi(schema)}.{qi(table)} {mode} TRIGGER {qi(name)}")
        if err:
            print(f"    ✗ {label} — {err}")
            failed += 1
        else:
            print(f"    ✓ {label}" + (" (выключен, как в старом проекте)" if enabled == "D" else ""))

    # --- RLS policies on auth/storage tables -------------------------------------------------------
    print("\n  Правила доступа к файлам и таблицам auth/storage:")
    stmt = """format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
        policyname, schemaname, tablename, permissive, cmd,
        (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
        coalesce(' USING (' || qual || ')', ''), coalesce(' WITH CHECK (' || with_check || ')', ''))"""
    old_pol = q(OLD, f"""
        select schemaname, tablename, {b64('policyname')}, {b64(stmt)}
        from pg_policies where schemaname in ({schemas_sql(MANAGED)}) order by 1, 2, policyname""")
    new_pol = {r[0] for r in q(NEW, f"""
        select {b64("schemaname || '.' || tablename || '.' || policyname")}
        from pg_policies where schemaname in ({schemas_sql(MANAGED)})""")}
    if not old_pol:
        print("    нет")
    for schema, table, pname64, defn in old_pol:
        pname = unb64(pname64)
        label = f'{schema}.{table}: "{pname}"'
        key = base64.b64encode(f"{schema}.{table}.{pname}".encode()).decode()
        if key in new_pol:
            print(f"    = {label} — уже есть")
            continue
        if f"{schema}.{table}" not in new_tables:
            print(f"    ✗ {label} — таблицы нет на этом сервере")
            failed += 1
            continue
        err = run(NEW, unb64(defn))
        if err:
            print(f"    ✗ {label} — {err}")
            failed += 1
        else:
            print(f"    ✓ {label}")

    # --- database webhooks restored by schema.sql: they point at the OLD project -------------------
    print("\n  Вебхуки базы (триггеры, которые отправляют запросы по адресу):")
    hooks = q(NEW, """
        select n.nspname, c.relname, t.tgname
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
        join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
        where not t.tgisinternal and pn.nspname = 'supabase_functions' and p.proname = 'http_request'
        order by 1, 2, 3""")
    if not hooks:
        print("    нет")
    for schema, table, name in hooks:
        err = run(NEW, f"ALTER TABLE {qi(schema)}.{qi(table)} DISABLE TRIGGER {qi(name)}")
        print(f"    ! {schema}.{table}: {name} — " + (f"не удалось выключить: {err}" if err else
              "выключен (ведёт на старый проект; включим с новым адресом при переключении)"))
        failed += bool(err)

    # --- report only -----------------------------------------------------------------------------
    print("\n  Не переносится автоматически (настроим отдельно при переключении):")
    try:
        if q(OLD, "select to_regclass('cron.job') is not null")[0][0] == "t":
            jobs = q(OLD, "select jobname, schedule, active from cron.job order by jobid")
            print(f"    Расписания pg_cron: {len(jobs) or 'нет'}")
            for jobname, schedule, active in jobs:
                print(f"      {jobname or '(без имени)'} — {schedule}" + ("" if active == "t" else " (выключено)"))
        else:
            print("    Расписания pg_cron: нет")
    except Exception as e:
        print(f"    Расписания pg_cron: не удалось прочитать ({str(e)[:80]})")

    try:
        funcs = q(NEW, f"""
            select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prosrc ilike '%supabase.co%' and n.nspname not in ({schemas_sql(SYSTEM_SCHEMAS)})
            order by 1""")
        print(f"    Функции БД с адресом старого проекта (*.supabase.co): {len(funcs) or 'нет'}")
        for (fname,) in funcs:
            print(f"      {fname}")
    except Exception as e:
        print(f"    Функции БД с адресом старого проекта: не удалось проверить ({str(e)[:80]})")

    for title, table, sql in (
        ("Таблицы в Realtime (в приложении не используется)", "pg_catalog.pg_publication_tables",
         "select count(*) from pg_publication_tables where pubname = 'supabase_realtime'"),
        ("Секреты Vault (зашифрованы ключом старого проекта)", "vault.secrets",
         "select count(*) from vault.secrets"),
    ):
        try:
            exists = q(OLD, f"select to_regclass('{table}') is not null")[0][0] == "t"
            n = q(OLD, sql)[0][0] if exists else "0"
        except Exception:
            n = "не удалось прочитать"
        print(f"    {title}: {'нет' if n == '0' else n}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
