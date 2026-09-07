import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { ASPECT_RATIOS, modelShortName } from '../types';
import { IconImage, IconVideo, IconClose, IconCopy, IconFlow, IconSparkles } from './Icons';
import { getCatalog, PAGE_SIZE, makeLaunch, resolveModel, supportedModels, safeMediaUrl, safeSourceUrl,
  type TrendPrompt, type TrendLaunch, type CatalogPage } from '../trends/catalog';

type Props = { active: boolean; demo: boolean; storageScope: string;
  onUse: (request: TrendLaunch) => void; onNodes: (request: TrendLaunch) => void };

function Preview({ item, large = false, active = true }: { item: TrendPrompt; large?: boolean; active?: boolean }) {
  const t = useT().trends;
  const [failed, setFailed] = useState(false);
  const poster = safeMediaUrl(item.thumbnail_url);
  const video = safeMediaUrl(item.video_url);
  if (!failed && large && video && active) return <video controls preload="metadata" poster={poster} src={video} onError={() => setFailed(true)} />;
  if (!failed && poster) return <img src={poster} alt={item.title} loading="lazy" onError={() => setFailed(true)} />;
  return <p className="trends-placeholder">{item.kind === 'video' ? <IconVideo size={28} /> : <IconImage size={28} />}{failed ? t.previewError : t.noPreview}</p>;
}

function Details({ item, onClose, onUse, onNodes }: { item: TrendPrompt; onClose: () => void;
  onUse: Props['onUse']; onNodes: Props['onNodes'] }) {
  const t = useT().trends;
  const dialog = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState(item.prompt);
  const [model, setModel] = useState(resolveModel(item) ?? '');
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopyStatus(t.copied); }
    catch { setCopyStatus(t.copyError); }
  };
  const launch = (target: Props['onUse']) => { target(makeLaunch(item, prompt, model)); onClose(); };
  const source = safeSourceUrl(item.source_url);
  return <dialog ref={dialog} className="trends-dialog" aria-labelledby="trend-detail-title" onCancel={onClose}
    onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header className="trends-detail-header"><h2 id="trend-detail-title">{item.title}</h2><button autoFocus onClick={onClose} aria-label={t.close}><IconClose /></button></header>
    <section className="trends-detail-layout">
      <figure className="trends-detail-preview"><Preview item={item} large /></figure>
      <section className="trends-detail-copy">
        {item.description && <p>{item.description}</p>}
        <p className="trends-meta">{item.model} · {item.categories.join(' / ')}</p>
        {item.author && <p className="trends-meta">{t.author}: {item.author}</p>}
        {source && <a href={source} target="_blank" rel="noopener noreferrer">{t.source} ↗</a>}
        {item.license && <p className="trends-meta">{t.license}: {safeSourceUrl(item.license_url)
          ? <a href={safeSourceUrl(item.license_url)} target="_blank" rel="noopener noreferrer">{item.license}</a> : item.license}</p>}
        {item.popularity !== null && <p className="trends-meta">{t.popularity}: {item.popularity.toLocaleString()}</p>}
        <label className="trends-field">{t.prompt}<textarea value={prompt} onChange={e => { setPrompt(e.target.value); setCopyStatus(''); }} rows={12} /></label>
        <label className="trends-field">{t.model}<select value={model} onChange={e => setModel(e.target.value)}>
          <option value="" disabled>{t.chooseModel}</option>
          {supportedModels(item.kind).map(m => <option key={m.value} value={m.value}>{modelShortName(m.label)}</option>)}
        </select></label>
        {!resolveModel(item) && <p className="trends-meta">{t.unsupported}</p>}
        {item.aspect_ratio && <p className="trends-meta">{t.ratio}: {item.aspect_ratio}
          {!ASPECT_RATIOS.some(r => r === item.aspect_ratio) && ` — ${t.ratioFallback}`}</p>}
        <p className="trends-meta">{t.references}</p>
        <footer className="trends-actions">
          <button onClick={() => void copy()} disabled={!prompt.trim()}><IconCopy />{t.copy}</button>
          <button onClick={() => launch(onNodes)} disabled={!model || !prompt.trim()}><IconFlow />{t.nodes}</button>
          <button className="trends-primary" onClick={() => launch(onUse)} disabled={!model || !prompt.trim()}><IconSparkles />{t.generate}</button>
        </footer>
        <p role="status" className="trends-meta">{copyStatus}</p>
      </section>
    </section>
  </dialog>;
}

export default function TrendsPanel({ active, demo, storageScope, onUse, onNodes }: Props) {
  const t = useT().trends;
  const storageKey = `oneflow-trends-saved:${storageScope}`;
  const [saved, setSaved] = useState<string[]>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; }
    catch { return []; }
  });
  const [favoriteError, setFavoriteError] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [model, setModel] = useState('');
  const [category, setCategory] = useState('');
  const [collection, setCollection] = useState('');
  const [sort, setSort] = useState('newest');
  const [onlySaved, setOnlySaved] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<TrendPrompt | null>(null);
  const cacheKey = useRef('');
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(query.trim()); setOffset(0); }, 250); return () => clearTimeout(timer); }, [query]);
  const idsKey = onlySaved ? JSON.stringify(saved) : 'null';
  useEffect(() => {
    if (!active) return;
    const key = JSON.stringify([demo, search, kind, model, category, collection, sort, offset, idsKey, retry]);
    if (cacheKey.current === key) return;
    const controller = new AbortController();
    setLoading(true); setError(false);
    getCatalog({ query: search, kind, model, category, collection, sort, offset, ids: JSON.parse(idsKey) }, demo, controller.signal)
      .then(result => { if (!controller.signal.aborted) {
        if (offset > 0 && offset >= result.total) { setOffset(0); return; }
        setPage(result); cacheKey.current = key;
      } })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, demo, search, kind, model, category, collection, sort, offset, idsKey, retry]);
  const favorite = (id: string) => {
    const next = saved.includes(id) ? saved.filter(v => v !== id) : [...saved, id];
    setSaved(next); setFavoriteError(false);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setFavoriteError(true); }
  };
  const reset = () => { setQuery(''); setSearch(''); setKind(''); setModel(''); setCategory(''); setCollection(''); setOnlySaved(false); setOffset(0); setSort('newest'); };
  const select = (setter: (value: string) => void, value: string) => { setter(value); setOffset(0); };
  // Uses the existing ONEFLOW frame/tokens per HANDOFF.md. No global UI reset or new library.
  return <section className="trends-panel" hidden={!active} aria-label={t.heading}>
    <header className="trends-toolbar">
      <h1>{t.heading}</h1>
      <input type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={e => setQuery(e.target.value)} />
      <button aria-pressed={onlySaved} onClick={() => { setOnlySaved(v => !v); setOffset(0); }}>☆ {t.saved} ({saved.length})</button>
    </header>
    <section className="trends-filters" aria-label={t.categories}>
      <nav className="trends-kind" aria-label={t.all}>
        {[['', t.all], ['image', t.image], ['video', t.video]].map(([value, label]) =>
          <button key={value} aria-pressed={kind === value} onClick={() => select(setKind, value)}>{label}</button>)}
      </nav>
      <select aria-label={t.models} value={model} onChange={e => select(setModel, e.target.value)}><option value="">{t.models}</option>{page?.facets.models.map(v => <option key={v}>{v}</option>)}</select>
      <select aria-label={t.categories} value={category} onChange={e => select(setCategory, e.target.value)}><option value="">{t.categories}</option>{page?.facets.categories.map(v => <option key={v}>{v}</option>)}</select>
      <select aria-label={t.collections} value={collection} onChange={e => select(setCollection, e.target.value)}><option value="">{t.collections}</option>{page?.facets.collections.map(v => <option key={v}>{v}</option>)}</select>
      <select aria-label={t.newest} value={sort} onChange={e => select(setSort, e.target.value)}><option value="newest">{t.newest}</option><option value="popular">{t.popular}</option></select>
    </section>
    <section className="trends-scroll" aria-busy={loading}>
      {demo && <p className="trends-notice">{t.demo}</p>}
      {favoriteError && <p role="status">{t.favoriteError}</p>}
      {loading ? <p role="status" className="trends-state">{t.loading}</p> : error ? <section className="trends-state" role="alert"><p>{t.error}</p><button onClick={() => setRetry(v => v + 1)}>{t.retry}</button></section> : page && <>
        <p className="trends-meta" role="status">{t.results(page.total)}</p>
        {!page.items.length && <section className="trends-state"><p>{t.empty}</p><button onClick={reset}>{t.reset}</button></section>}
        <section className="trends-grid">
          {page.items.map(item => <article className="trends-card" key={item.id}>
            <button className="trends-card-open" onClick={() => setSelected(item)} aria-label={`${t.details}: ${item.title}`}>
              <figure><Preview item={item} active={active} /></figure>
              <h2>{item.title}</h2><p className="trends-meta">{item.kind === 'video' ? <IconVideo /> : <IconImage />}{item.model}</p>
            </button>
            <footer><p className="trends-meta">{item.categories.slice(0, 2).join(' / ')}</p><button className="trends-save" aria-pressed={saved.includes(item.id)} aria-label={saved.includes(item.id) ? t.unsave : t.save} onClick={() => favorite(item.id)}>{saved.includes(item.id) ? '★' : '☆'}</button></footer>
          </article>)}
        </section>
        {page.total > PAGE_SIZE && <nav className="trends-pagination" aria-label={t.next}>
          <button disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - PAGE_SIZE))}>{t.previous}</button>
          <p>{t.page(Math.floor(offset / PAGE_SIZE) + 1, Math.ceil(page.total / PAGE_SIZE))}</p>
          <button disabled={offset + PAGE_SIZE >= page.total} onClick={() => setOffset(v => v + PAGE_SIZE)}>{t.next}</button>
        </nav>}
      </>}
    </section>
    {active && selected && <Details key={selected.id} item={selected} onClose={() => setSelected(null)} onUse={onUse} onNodes={onNodes} />}
  </section>;
}
