#!/usr/bin/env python3
"""Adapt a `supabase db dump --data-only --use-copy` file to this self-hosted instance.

    fix_data.py <data.sql> <managed-columns.tsv> <out.sql>

managed-columns.tsv lists, for the schemas Supabase itself manages on the new server (auth,
storage), every existing table with its columns: "schema.table<TAB>col1,col2,...", and every
existing sequence as "seq:schema.sequence<TAB>".

For each COPY block:
  * schemas/tables that must not travel (pg_cron jobs, Vault secrets, pg_net queues, Realtime,
    webhooks, migration bookkeeping) are skipped: they would re-run the old project's schedules
    against the old URLs, or hold secrets encrypted with the old project's key;
  * in managed schemas, a table that does not exist here is skipped and a column that does not
    exist here is dropped (platform Auth/Storage can be newer than self-hosted);
  * everything else (public and other app schemas created by schema.sql) passes unchanged.
Sequence positions (SELECT pg_catalog.setval(...)) follow the same rules: skipped for schemas that
do not travel and for managed sequences that do not exist here.

COPY text format escapes tabs and newlines inside values, so a data row splits on "\t" safely.
Prints one line per change; never prints row contents.
"""
import re
import sys

SKIP_SCHEMAS = {
    "cron", "vault", "pgsodium", "net", "realtime", "supabase_functions",
    "_realtime", "_analytics", "_supavisor", "graphql", "pgbouncer",
}
SKIP_TABLES = {"auth.schema_migrations", "storage.migrations"}
MANAGED_SCHEMAS = {"auth", "storage"}

IDENT = r'(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)'
COPY_RE = re.compile(rf'^COPY\s+(?P<schema>{IDENT})\.(?P<table>{IDENT})\s*\((?P<cols>.*)\)\s+FROM\s+stdin;\s*$')
COL_RE = re.compile(r'"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*)')
SETVAL_RE = re.compile(rf"^SELECT pg_catalog\.setval\('(?P<schema>{IDENT})\.(?P<seq>{IDENT})', .*\);\s*$")


def unquote(ident: str) -> str:
    return ident[1:-1].replace('""', '"') if ident.startswith('"') else ident


def quote(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def main() -> int:
    src, cols_path, dst = sys.argv[1:4]
    managed: dict[str, list[str]] = {}
    with open(cols_path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            name, _, cols = line.partition("\t")
            managed[name] = cols.split(",") if cols else []

    changes = 0
    with open(src, encoding="utf-8", newline="") as fin, open(dst, "w", encoding="utf-8", newline="") as fout:
        mode = "pass"      # pass | skip | filter
        keep_idx: list[int] = []
        skipped_rows = 0
        for line in fin:
            if mode != "pass":
                if line.rstrip("\r\n") == "\\.":
                    if mode == "skip":
                        print(f"    пропущено строк: {skipped_rows}")
                    else:
                        fout.write(line)
                    mode = "pass"
                    continue
                if mode == "skip":
                    skipped_rows += 1
                    continue
                fields = line.rstrip("\n").split("\t")
                fout.write("\t".join(fields[i] for i in keep_idx) + "\n")
                continue

            sv = SETVAL_RE.match(line.rstrip("\r\n"))
            if sv:
                schema, seq = unquote(sv["schema"]), unquote(sv["seq"])
                if schema in SKIP_SCHEMAS or (schema in MANAGED_SCHEMAS and f"seq:{schema}.{seq}" not in managed):
                    print(f"  skip sequence {schema}.{seq}: нет на этом сервере или не переносится")
                    changes += 1
                    fout.write("-- " + line)
                    continue
                fout.write(line)
                continue

            m = COPY_RE.match(line.rstrip("\r\n"))
            if not m:
                fout.write(line)
                continue
            schema, table = unquote(m["schema"]), unquote(m["table"])
            full = f"{schema}.{table}"
            cols = [a or b.lower() for a, b in COL_RE.findall(m["cols"])]
            cols = [c.replace('""', '"') for c in cols]

            reason = None
            if schema in SKIP_SCHEMAS:
                reason = "служебная схема старого проекта (расписания, секреты, очереди) — не переносится"
            elif full in SKIP_TABLES:
                reason = "журнал миграций сервиса — на новом сервере свой"
            elif schema in MANAGED_SCHEMAS and full not in managed:
                reason = "такой таблицы нет в версии Supabase на этом сервере"
            if reason:
                print(f"  skip {full}: {reason}")
                changes += 1
                mode, skipped_rows = "skip", 0
                continue

            if schema in MANAGED_SCHEMAS:
                existing = set(managed[full])
                missing = [c for c in cols if c not in existing]
                if missing:
                    keep_idx = [i for i, c in enumerate(cols) if c in existing]
                    kept = [cols[i] for i in keep_idx]
                    print(f"  trim {full}: убраны колонки, которых нет на этом сервере: {', '.join(missing)}")
                    changes += 1
                    fout.write(f"COPY {quote(schema)}.{quote(table)} ({', '.join(quote(c) for c in kept)}) FROM stdin;\n")
                    mode = "filter"
                    continue
            fout.write(line)
        if mode != "pass":
            print("ОШИБКА: файл данных оборван внутри блока COPY", file=sys.stderr)
            return 2
    print(f"  изменений: {changes}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
