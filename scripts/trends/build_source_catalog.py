#!/usr/bin/env python3
"""Parse the 3 authorized GitHub prompt-collection repos (already shallow-cloned locally)
into raw records matching import_catalog.py's extended schema. Reads only local files —
no network access, no YouMind scraping. Python 3.10+, standard library only.
"""
import json
import re
import sys
from pathlib import Path

IMG_RE = re.compile(r'<img\s+src="([^"]+)"')
VIDEO_RE = re.compile(r'<video\s+src="([^"]+)"')


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', s or '').strip()


def code_fence(block: str) -> str:
    m = re.search(r'```[a-zA-Z0-9_]*\n(.*?)```', block, re.S)
    return m.group(1).strip() if m else ''


# ---------- YouMind mirrors (nano-banana-pro, gpt-image-2) ----------

def parse_youmind(repo_dir: Path, repo_slug: str, commit: str, model_value: str, license_pair):
    text = (repo_dir / 'README.md').read_text(encoding='utf-8')
    lines = text.split('\n')
    # Locate the two catalog sections by their H2 headings.
    h2 = [(i, l) for i, l in enumerate(lines) if l.startswith('## ')]
    def section_bounds(marker):
        for idx, (i, l) in enumerate(h2):
            if marker in l:
                start = i
                end = h2[idx + 1][0] if idx + 1 < len(h2) else len(lines)
                return start, end
        return None
    sections = []
    fb = section_bounds('Featured Prompts')
    if fb:
        sections.append(('Featured', *fb))
    ab = section_bounds('All Prompts')
    if ab:
        sections.append(('All', *ab))

    records = []
    for collection, start, end in sections:
        block = '\n'.join(lines[start:end])
        entries = list(re.finditer(r'^### No\. (\d+): (.+)$', block, re.M))
        for idx, m in enumerate(entries):
            entry_start = m.end()
            entry_end = entries[idx + 1].start() if idx + 1 < len(entries) else len(block)
            body = block[entry_start:entry_end]
            raw_title = clean(m.group(2))
            category = None
            title = raw_title
            if ' - ' in raw_title:
                cat, rest = raw_title.split(' - ', 1)
                if len(cat) < 60:
                    category, title = clean(cat), clean(rest)

            desc_m = re.search(r'####\s*📖\s*Description\s*\n+(.*?)(?=\n####|\Z)', body, re.S)
            description = clean(desc_m.group(1)) if desc_m else ''

            prompt_m = re.search(r'####\s*📝\s*Prompt\s*\n+(.*?)(?=\n####|\Z)', body, re.S)
            prompt = code_fence(prompt_m.group(1)) if prompt_m else ''
            if not prompt:
                continue

            images_m = re.search(r'####\s*🖼️.*?Images?\s*\n+(.*?)(?=\n####|\Z)', body, re.S)
            images = IMG_RE.findall(images_m.group(1)) if images_m else []
            thumbnail = images[0] if images else None

            details_m = re.search(r'####\s*📌\s*Details\s*\n+(.*?)(?=\n####|\Z|\n---)', body, re.S)
            details = details_m.group(1) if details_m else ''
            author_m = re.search(r'\*\*Author:\*\*\s*\[([^\]]+)\]\(([^)]+)\)', details)
            author = clean(author_m.group(1)) if author_m else ''
            source_m = re.search(r'\*\*Source:\*\*\s*\[[^\]]*\]\(([^)]+)\)', details)
            source_url = source_m.group(1).strip() if source_m else None
            pub_m = re.search(r'\*\*Published:\*\*\s*([^\n]+)', details)
            published_raw = clean(pub_m.group(1)) if pub_m else ''
            published_at = parse_english_date(published_raw)

            stable_id = f'{repo_slug}-{collection.lower()}-{m.group(1)}'
            records.append(dict(
                id=stable_id, title=title, description=description, prompt=prompt,
                kind='image', model=model_value,
                categories=[category] if category else [],
                collections=[collection], thumbnail_url=thumbnail, video_url=None,
                source_url=source_url, author=author, published_at=published_at,
                license=license_pair[0], license_url=license_pair[1],
                source_repo=f'https://github.com/{repo_slug}', source_commit=commit,
            ))
    return records


MONTHS = {m: i for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July',
     'August', 'September', 'October', 'November', 'December'], 1)}


def parse_english_date(raw: str):
    m = re.match(r'([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})', raw)
    if not m or m.group(1) not in MONTHS:
        return None
    month, day, year = MONTHS[m.group(1)], int(m.group(2)), int(m.group(3))
    return f'{year:04d}-{month:02d}-{day:02d}T00:00:00+00:00'


# ---------- Seedance ----------

def parse_seedance(repo_dir: Path, repo_slug: str, commit: str):
    text = (repo_dir / 'README.md').read_text(encoding='utf-8')
    lines = text.split('\n')
    h2 = [(i, clean(re.sub(r'[^\x00-\x7F]', ' ', l[3:]))) for i, l in enumerate(lines) if l.startswith('## ')]
    cases = list(re.finditer(r'^### Case (\d+): \[([^\]]+)\]\(([^)]+)\) \(by \[@([^\]]+)\]\(([^)]+)\)\)$', text, re.M))
    images_dir = repo_dir / 'public' / 'seedance_2_prompt_images'
    available_images = {p.name for p in images_dir.glob('*.jpg')} if images_dir.exists() else set()

    records = []
    for idx, m in enumerate(cases):
        case_no = int(m.group(1))
        title = clean(m.group(2))
        source_url = m.group(3).strip()
        author = clean(m.group(4))
        body_start = m.end()
        body_end = cases[idx + 1].start() if idx + 1 < len(cases) else len(text)
        body = text[body_start:body_end]

        # Category = nearest preceding H2 heading.
        line_no = text[:m.start()].count('\n')
        category = None
        for i, name in h2:
            if i <= line_no:
                category = name
            else:
                break

        video_m = VIDEO_RE.search(body)
        video_url = video_m.group(1).strip() if video_m else None

        prompt_m = re.search(r'\*\*Prompt:\*\*\s*\n+(.*?)(?=\n###|\n##|\Z)', body, re.S)
        prompt = code_fence(prompt_m.group(1)) if prompt_m else ''
        if not prompt:
            continue

        # Only self-repo relative image references (./public/...) are trustworthy;
        # cross-repo raw.githubusercontent.com links point at an un-authorized 4th repo.
        thumbnail = None
        local_img_m = re.search(r'src="\./public/seedance_2_prompt_images/([^"]+)"', body)
        if local_img_m and local_img_m.group(1) in available_images:
            thumbnail = f'https://raw.githubusercontent.com/{repo_slug}/{commit}/public/seedance_2_prompt_images/{local_img_m.group(1)}'

        # Explicit per-case version signal: title + prompt body only, never the repo-wide marketing prose.
        scan_text = title + '\n' + prompt
        model_value = ''
        if re.search(r'Seedance\s*2\.0\b', scan_text):
            model_value = 'bytedance/seedance-2.0'
        elif re.search(r'Seedance\s*2\.5\b', scan_text):
            model_value = 'bytedance/seedance-2.5'

        cat_slug = re.sub(r'[^a-z0-9]+', '-', (category or 'uncategorized').lower()).strip('-')
        records.append(dict(
            id=f'{repo_slug}-{cat_slug}-case-{case_no}', title=title, description='', prompt=prompt,
            kind='video', model=model_value,
            categories=[category] if category else [], collections=[],
            thumbnail_url=thumbnail, video_url=video_url,
            source_url=source_url, author=author, published_at=None,
            license=None, license_url=None,
            source_repo=f'https://github.com/{repo_slug}', source_commit=commit,
        ))
    return records


def main():
    """Usage: build_source_catalog.py <dir with the 3 shallow clones> <output.json> [sources.json]

    Clone the 3 authorized repos first, e.g.:
      git clone --depth 1 https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts <dir>/nano-banana-pro
      git clone --depth 1 https://github.com/YouMind-OpenLab/awesome-gpt-image-2 <dir>/gpt-image-2
      git clone --depth 1 https://github.com/EvoLinkAI/awesome-seedance-2.5-prompts <dir>/seedance-2.5
    Re-running against fresh clones picks up new commits automatically; update sources.json's
    pinned commit/license fields to match (re-check the seedance license contradiction each time).
    """
    base = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    sources_path = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).parent / 'sources.json'
    sources = json.loads(sources_path.read_text())

    nb, gi, sd = sources['nano-banana-pro'], sources['gpt-image-2'], sources['seedance-2.5']
    records = []
    records += parse_youmind(base / 'nano-banana-pro', nb['repo'], nb['commit'],
                              'google/nano-banana-pro', (nb['license'], nb['license_url']))
    records += parse_youmind(base / 'gpt-image-2', gi['repo'], gi['commit'],
                              'openai/gpt-image-2', (gi['license'], gi['license_url']))
    records += parse_seedance(base / 'seedance-2.5', sd['repo'], sd['commit'])

    out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    by_source = {}
    for r in records:
        by_source[r['source_repo']] = by_source.get(r['source_repo'], 0) + 1
    print(f'Wrote {len(records)} raw records to {out_path}')
    for k, v in by_source.items():
        print(f'  {k}: {v}')
    versioned = sum(1 for r in records if r['model'])
    print(f'Seedance/YouMind entries with a resolved model value: {versioned}/{len(records)}')


if __name__ == '__main__':
    main()
