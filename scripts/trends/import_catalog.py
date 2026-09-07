#!/usr/bin/env python3
"""Normalize an authorized JSON/CSV export, then optionally upsert to Supabase.
No scraping, browser automation or credentials in the output file.
Python 3.10+, standard library only.
"""
import argparse
import csv
import hashlib
import json
import math
import os
import re
from pathlib import Path
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def text(value, limit, required=False):
    if value is None:
        value = ''
    if not isinstance(value, str):
        raise ValueError('Text fields must be strings')
    value = value.strip()
    if (required and not value) or len(value) > limit:
        raise ValueError(f'Invalid text length (max {limit})')
    return value


def url(value):
    value = text(value, 4000)
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Media/source URLs must be HTTPS without credentials')
    return value


def tags(value):
    if value is None or value == '':
        return []
    if isinstance(value, str):
        value = json.loads(value) if value.strip().startswith('[') else value.split('|')
    if not isinstance(value, list) or len(value) > 50:
        raise ValueError('Categories/collections must be lists (max 50)')
    return list(dict.fromkeys(text(v, 120, True) for v in value))


def commit_sha(value):
    value = text(value, 40)
    if not value:
        return None
    if not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('source_commit must be a 40-character lowercase git SHA-1')
    return value


def timestamp(value):
    if not value:
        return None
    value = text(value, 80)
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


def normalize(row):
    if not isinstance(row, dict):
        raise ValueError('Each record must be an object')
    title = text(row.get('title'), 300, True)
    prompt = text(row.get('prompt'), 100000, True)
    kind = row.get('kind', 'image')
    if kind not in ('image', 'video'):
        raise ValueError('kind must be image or video')
    source = url(row.get('source_url'))
    # A source URL gives stable identity when text changes. Without it, provide a stable
    # explicit id for editable records; content hashing is a fallback for one-off exports.
    identity = source or f'{kind}\n{title}\n{prompt}'
    supplied_id = text(row.get('id'), 200)
    ident = supplied_id or 'trend-' + hashlib.sha256(identity.encode()).hexdigest()[:32]
    score = row.get('popularity')
    if score is not None and score != '':
        score = float(score)
        if not math.isfinite(score) or score < 0:
            raise ValueError('popularity must be a finite non-negative number')
    else:
        score = None
    ratio = text(row.get('aspect_ratio'), 20) or None
    if ratio and (len(ratio.split(':')) != 2 or not all(v.isdigit() and int(v) > 0 for v in ratio.split(':'))):
        raise ValueError('aspect_ratio must look like 16:9')
    result = dict(id=ident, title=title, description=text(row.get('description'), 10000), prompt=prompt,
        kind=kind, model=text(row.get('model'), 200), categories=tags(row.get('categories')),
        collections=tags(row.get('collections')), thumbnail_url=url(row.get('thumbnail_url')),
        video_url=url(row.get('video_url')), source_url=source, author=text(row.get('author'), 300),
        published_at=timestamp(row.get('published_at')), popularity=score, aspect_ratio=ratio,
        license=text(row.get('license'), 200) or None, license_url=url(row.get('license_url')),
        source_repo=url(row.get('source_repo')), source_commit=commit_sha(row.get('source_commit')))
    # Let Postgres assign imported_at on first INSERT; do not refresh it on repeat imports.
    if row.get('imported_at'):
        result['imported_at'] = timestamp(row['imported_at'])
    return result


def read_records(path):
    with path.open(encoding='utf-8-sig', newline='') as file:
        if path.suffix.lower() == '.csv':
            return list(csv.DictReader(file))
        data = json.load(file)
        if isinstance(data, dict):
            data = data.get('items')
        if not isinstance(data, list):
            raise ValueError('JSON must be an array or an object with an items array')
        return data


def prepare(records):
    unique = {}
    for i, row in enumerate(records, 1):
        try:
            item = normalize(row)
        except (ValueError, TypeError) as error:
            raise ValueError(f'Record {i}: {error}') from error
        unique[item['id']] = item
    return list(unique.values())


def upload(items):
    base = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not base or not key or urlparse(base).scheme != 'https':
        raise ValueError('Set server-side SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    for start in range(0, len(items), 100):
        batch = items[start:start + 100]
        # Every object has the same fields, except imported_at which is omitted normally.
        # Separate explicit timestamp records to avoid mixed-column PostgREST payloads.
        for group in ([r for r in batch if 'imported_at' not in r], [r for r in batch if 'imported_at' in r]):
            if not group:
                continue
            req = Request(base + '/rest/v1/trend_prompts?on_conflict=id',
                data=json.dumps(group, ensure_ascii=False).encode(), method='POST',
                headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
                         'Prefer': 'resolution=merge-duplicates,return=minimal'})
            try:
                with urlopen(req, timeout=45) as response:
                    if response.status not in (200, 201, 204):
                        raise ValueError(f'Upload failed at batch {start // 100 + 1}')
            except HTTPError as error:
                # Never print server bodies or headers; they can contain private details.
                raise ValueError(f'Upload HTTP {error.code} at batch {start // 100 + 1}; earlier batches may have succeeded. Rerun safely after fixing the cause.') from error
        print(f'Uploaded {min(start + 100, len(items))}/{len(items)}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path, default=Path('trends.normalized.json'))
    parser.add_argument('--upload', action='store_true', help='Write to Supabase using server environment variables')
    args = parser.parse_args()
    records = read_records(args.input)
    items = prepare(records)  # Validate the entire input before making any writes.
    args.output.write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Validated {len(items)} records; removed {len(records) - len(items)} duplicate IDs. Wrote {args.output}')
    if args.upload:
        upload(items)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Import failed: {error}', file=sys.stderr)
        sys.exit(1)
