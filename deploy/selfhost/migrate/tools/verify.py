#!/usr/bin/env python3
"""Compare the old Supabase database with this server after a migration.

    verify.py            (OLD_DB_URL and NEW_DB_URL in the environment; psql on PATH)

Counts: users and identities, every table of the public schema, buckets and objects per bucket
(with total size), RLS policies, your own triggers on auth/storage and functions. Prints a table
and returns 1 if a count differs where it must not (the repository updates and the security
migration legitimately add functions, policies, triggers, tables and settings on the new side). The old project keeps serving users during a rehearsal, so small differences in
live tables (new sign-ups, generations, messages) are expected then; at the real switch the old
project is frozen first and everything must match.
"""
import os
import subprocess
import sys

OLD = os.environ["OLD_DB_URL"]
NEW = os.environ["NEW_DB_URL"]


def q(url: str, sql: str) -> list[list[str]]:
    out = subprocess.run(["psql", url, "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True, timeout=600)
    if out.returncode != 0:
        errors = [l for l in out.stderr.splitlines() if "ERROR:" in l or "ОШИБКА:" in l]
        raise RuntimeError(errors[0] if errors else "psql error")
    return [line.split("\t") for line in out.stdout.splitlines() if line]


def scalar(url: str, sql: str) -> str:
    try:
        rows = q(url, sql)
        return rows[0][0] if rows else "0"
    except Exception as e:  # a table missing on one side shows up as a mismatch, not a crash
        return "нет" if "does not exist" in str(e) or "не существует" in str(e) else "ошибка"


def main() -> int:
    checks: list[tuple[str, str]] = [
        ("Пользователи (auth.users)", "select count(*) from auth.users"),
        ("Входы через Google и др. (auth.identities)", "select count(*) from auth.identities"),
    ]
    tables = [r[0] for r in q(OLD, "select tablename from pg_tables where schemaname = 'public' order by 1")]
    old_tables = set(tables)
    for t in tables:
        checks.append((f"public.{t}", f'select count(*) from public."{t}"'))
    checks += [
        ("Бакеты (storage.buckets)", "select count(*) from storage.buckets"),
        ("Файлы всего (storage.objects)", "select count(*) from storage.objects"),
        ("Объём файлов, МБ", "select coalesce(round(sum((metadata->>'size')::bigint) / 1e6, 1), 0) from storage.objects"),
        ("Правила доступа public", "select count(*) from pg_policies where schemaname = 'public'"),
        ("Правила доступа storage", "select count(*) from pg_policies where schemaname = 'storage'"),
        ("Функции БД public", "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"),
        ("Свои триггеры на auth/storage", """select count(*) from pg_trigger t
            join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
            join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
            where not t.tgisinternal and n.nspname in ('auth', 'storage') and pn.nspname not in ('auth', 'storage')"""),
    ]
    buckets = [r[0] for r in q(OLD, "select id from storage.buckets order by 1")]
    for b in buckets:
        checks.append((f"  файлы в {b}", f"select count(*) from storage.objects where bucket_id = '{b}'"))

    width = max(len(n) for n, _ in checks) + 2
    print(f"    {'Что':{width}} {'старый':>10} {'новый':>10}")
    bad = 0
    for name, sql in checks:
        old, new = scalar(OLD, sql), scalar(NEW, sql)
        same = old == new
        # repository updates and the security migration change these on the new side only
        extra_ok = name.startswith(("Функции БД", "Правила доступа", "Свои триггеры")) or name == "public.app_settings"
        mark = "✓" if same else ("~" if extra_ok else "✗")
        if not same and not extra_ok:
            bad += 1
        print(f"    {name:{width}} {old:>10} {new:>10}  {mark}")
    added = [r[0] for r in q(NEW, "select tablename from pg_tables where schemaname = 'public' order by 1") if r[0] not in old_tables]
    if added:
        print(f"    Новые таблицы из обновлений и защиты: {', '.join(added)}")
    print("\n    ✓ совпадает   ~ отличается ожидаемо (обновления и защита)   ✗ расходится")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
