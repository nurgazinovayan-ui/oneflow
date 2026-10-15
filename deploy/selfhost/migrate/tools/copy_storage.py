#!/usr/bin/env python3
"""Copy Storage objects from the old Supabase project to this server, through both Storage APIs.

    copy_storage.py <objects.tsv>

objects.tsv (from the old database): bucket_id<TAB>name<TAB>mimetype<TAB>size<TAB>cache_control
Environment: OLD_URL, OLD_KEY (service_role of the old project), NEW_URL, NEW_KEY (service_role
here). Each object is streamed to a temp file, its size checked, then uploaded with x-upsert (the
database restore already brought the object rows; the upload writes the bytes and refreshes the
row). Prints progress and a per-bucket summary; never prints keys or object contents. Exit code 1
if any object failed.
"""
import collections
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

OLD_URL = os.environ["OLD_URL"].rstrip("/")
OLD_KEY = os.environ["OLD_KEY"]
NEW_URL = os.environ["NEW_URL"].rstrip("/")
NEW_KEY = os.environ["NEW_KEY"]
CHUNK = 1 << 20


def obj_path(bucket: str, name: str) -> str:
    return f"/storage/v1/object/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(name, safe='/')}"


def download(bucket: str, name: str, fh) -> int:
    req = urllib.request.Request(OLD_URL + obj_path(bucket, name),
                                 headers={"Authorization": f"Bearer {OLD_KEY}", "apikey": OLD_KEY})
    total = 0
    with urllib.request.urlopen(req, timeout=300) as r:
        while True:
            chunk = r.read(CHUNK)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
    return total


def upload(bucket: str, name: str, fh, size: int, mimetype: str, cache: str) -> None:
    fh.seek(0)
    headers = {
        "Authorization": f"Bearer {NEW_KEY}", "apikey": NEW_KEY, "x-upsert": "true",
        "Content-Type": mimetype or "application/octet-stream", "Content-Length": str(size),
    }
    if cache:
        headers["cache-control"] = cache if "=" in cache else f"max-age={cache}"
    req = urllib.request.Request(NEW_URL + obj_path(bucket, name), data=fh, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=600) as r:
        r.read()


def main() -> int:
    rows = []
    with open(sys.argv[1], encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2 or not parts[1]:
                continue
            bucket, name = parts[0], parts[1]
            mimetype = parts[2] if len(parts) > 2 else ""
            size = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else -1
            cache = parts[4] if len(parts) > 4 else ""
            rows.append((bucket, name, mimetype, size, cache))

    done = collections.Counter()
    nbytes = collections.Counter()
    failed: list[tuple[str, str, str]] = []
    started = time.time()
    for i, (bucket, name, mimetype, size, cache) in enumerate(rows, 1):
        err = ""
        for attempt in range(3):
            try:
                with tempfile.TemporaryFile(dir=os.environ.get("TMPDIR")) as fh:
                    got = download(bucket, name, fh)
                    if size >= 0 and got != size:
                        raise ValueError(f"размер {got} вместо {size}")
                    upload(bucket, name, fh, got, mimetype, cache)
                done[bucket] += 1
                nbytes[bucket] += got
                err = ""
                break
            except urllib.error.HTTPError as e:
                err = f"HTTP {e.code}"
                if e.code in (400, 401, 403, 404, 413):
                    break
            except Exception as e:  # network trouble: retry
                err = type(e).__name__ + (f": {e}" if isinstance(e, ValueError) else "")
            time.sleep(2 * (attempt + 1))
        if err:
            failed.append((bucket, name, err))
        if i % 25 == 0 or i == len(rows):
            print(f"    {i}/{len(rows)} файлов, {sum(nbytes.values()) / 1e6:.1f} МБ, {time.time() - started:.0f} с", flush=True)

    print("\n    Бакет                      скопировано   МБ")
    for bucket in sorted(set(r[0] for r in rows)):
        print(f"    {bucket:26} {done[bucket]:>10}   {nbytes[bucket] / 1e6:8.1f}")
    if failed:
        print(f"\n    Не скопировано: {len(failed)}")
        for bucket, name, err in failed[:20]:
            print(f"      {bucket}/{name[:60]} — {err}")
        if len(failed) > 20:
            print(f"      … и ещё {len(failed) - 20}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
