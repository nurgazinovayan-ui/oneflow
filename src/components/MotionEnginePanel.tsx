import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconClose, IconDownload, IconPause, IconPlay, IconPlus, IconRegenerate, IconSparkles, IconVideo } from './Icons';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';
import { drawFrame, drawStill, frameSize, prepareFrame, sceneIndexAt, type MotionSource, type MotionSources } from '../motion/render';
import { canEncodeMp4, canRecordWebm, renderVideo } from '../motion/export';
import { fileToAsset, framesForModel, loadSource, newId } from '../motion/media';
import { loadMotionState, saveMotionState, type MotionState } from '../motion/store';
import {
  MOTION_ASPECTS,
  MOTION_DURATIONS,
  MOTION_FPS,
  MOTION_MAX_ASSETS,
  MOTION_QUALITIES,
  type MotionAsset,
  type MotionScene,
  type MotionStoryboard,
  type MotionStyleDirection,
  type MotionVariant,
} from '../motion/types';

interface MotionEnginePanelProps {
  active: boolean;
  authEmail: string | null;
}

// One video in the Рендер column: waits its turn, then renders with the settings it was queued with.
interface RenderJob {
  id: string;
  variantId: string;
  aspect: string;
  width: number;
  height: number;
  fps: number;
  status: 'queued' | 'rendering' | 'error';
  progress: number;
  error?: string;
}

interface RenderedVideo {
  id: string;
  variantId: string;
  title: string;
  url: string;
  ext: 'mp4' | 'webm';
  codec: string;
  aspect: string;
  width: number;
  height: number;
  fps: number;
  size: number;
}

const EMPTY: MotionState = {
  brief: '',
  duration: 15,
  aspect: '16:9',
  renderAspect: '16:9',
  quality: '1080',
  fps: 30,
  assets: [],
  materialIds: [],
  variants: [],
  selectedId: null,
  style: null,
  styleOptions: [],
};

const DRAG_TYPE = 'application/x-oneflow-variant';
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const fmtUsd = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;
const fmtMb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`;

// Web-only (see App.tsx). A pipeline board: Бриф (materials, brief, style) → Раскадровки (every
// Claude Opus 5.5 storyboard, kept per account in IndexedDB) → Рендер (a queue; drop a storyboard
// here or press «В рендер») → Готово (videos to download). Rendering runs in the browser
// (src/motion/export.ts), one job at a time, at any frame and size.
export default function MotionEnginePanel({ active, authEmail }: MotionEnginePanelProps) {
  const t = useT();
  const tm = t.motion;
  const account = `motion:${authEmail ?? 'anon'}`;
  const [state, setState] = useState<MotionState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [sources, setSources] = useState<Record<string, MotionSource>>({});
  const [generating, setGenerating] = useState(false);
  const [styling, setStyling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState<Record<string, boolean>>({});
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [renders, setRenders] = useState<RenderedVideo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const releases = useRef<Record<string, () => void>>({});
  const aborts = useRef<Record<string, AbortController>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- persistence
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void loadMotionState(account).then((s) => {
      if (cancelled) return;
      setState(s ? { ...EMPTY, ...s } : EMPTY);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [account]);
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => void saveMotionState(account, state), 400);
    return () => clearTimeout(id);
  }, [state, loaded, account]);

  useEffect(() => {
    void document.fonts?.load('700 40px "Inter Variable"').finally(() => setFontsReady(true));
  }, []);

  // ---- drawable sources follow the asset library
  useEffect(() => {
    const ids = new Set(state.assets.map((a) => a.id));
    for (const id of Object.keys(releases.current)) {
      if (!ids.has(id)) {
        releases.current[id]();
        delete releases.current[id];
        setSources((s) => {
          const next = { ...s };
          delete next[id];
          return next;
        });
      }
    }
    for (const a of state.assets) {
      if (releases.current[a.id]) continue;
      releases.current[a.id] = () => {};
      void loadSource(a)
        .then(({ source, release }) => {
          releases.current[a.id] = release;
          setSources((s) => ({ ...s, [a.id]: source }));
        })
        .catch(() => undefined);
    }
  }, [state.assets]);
  useEffect(() => () => Object.values(releases.current).forEach((r) => r()), []);
  const rendersRef = useRef<RenderedVideo[]>([]);
  rendersRef.current = renders;
  useEffect(() => () => rendersRef.current.forEach((r) => URL.revokeObjectURL(r.url)), []);

  useEffect(() => {
    if (!generating && !styling) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500);
    return () => clearInterval(id);
  }, [generating, styling]);

  const update = (patch: Partial<MotionState>) => setState((s) => ({ ...s, ...patch }));
  const assetById = useMemo(() => new Map(state.assets.map((a) => [a.id, a])), [state.assets]);
  const materials = state.materialIds.map((id) => assetById.get(id)).filter((a): a is MotionAsset => Boolean(a));
  const materialSources: MotionSources = useMemo(() => state.materialIds.map((id) => sources[id] ?? null), [state.materialIds, sources]);
  const sourcesFor = useCallback((v: MotionVariant): MotionSources => v.assetIds.map((id) => sources[id] ?? null), [sources]);
  const quality = MOTION_QUALITIES.find((q) => q.id === state.quality) ?? MOTION_QUALITIES[1];
  const size = frameSize(state.renderAspect, quality.short);
  const opened = state.variants.find((v) => v.id === openId) ?? null;

  // which render sizes this browser can encode
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      MOTION_QUALITIES.flatMap((q) =>
        MOTION_FPS.map(async (fps) => {
          const s = frameSize(state.renderAspect, q.short);
          return [`${q.id}@${fps}`, (await canEncodeMp4(s.width, s.height, fps)) || canRecordWebm()] as const;
        })
      )
    ).then((pairs) => !cancelled && setSupported(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [state.renderAspect]);
  const qualityOk = (q: string, fps: number) => supported[`${q}@${fps}`] !== false;

  // drop library assets nobody uses any more
  const pruneAssets = (s: MotionState): MotionState => {
    const used = new Set([...s.materialIds, ...s.variants.flatMap((v) => v.assetIds)]);
    return { ...s, assets: s.assets.filter((a) => used.has(a.id)) };
  };

  const addFiles = async (files: FileList | File[]) => {
    setError('');
    const room = MOTION_MAX_ASSETS - materials.length;
    const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/')).slice(0, Math.max(0, room));
    if (!list.length) {
      if (room <= 0) setError(tm.maxAssets(MOTION_MAX_ASSETS));
      return;
    }
    const added: MotionAsset[] = [];
    for (const f of list) {
      try {
        added.push(await fileToAsset(f));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setState((s) => ({ ...s, assets: [...s.assets, ...added], materialIds: [...s.materialIds, ...added.map((a) => a.id)] }));
  };

  const removeMaterial = (id: string) => setState((s) => pruneAssets({ ...s, materialIds: s.materialIds.filter((m) => m !== id) }));

  // what Claude gets to see of the materials: downscaled photos, 3 keyframes per video
  const materialsForModel = async () => {
    const assets = [];
    for (const a of materials) {
      const src = sources[a.id] ?? (await loadSource(a)).source;
      assets.push({ kind: a.kind, name: a.name, duration: a.duration, frames: await framesForModel(a, src) });
    }
    return assets;
  };

  const suggestStyles = async () => {
    if (!state.brief.trim() && !materials.length) {
      setError(tm.errorNoInput);
      return;
    }
    setError('');
    setStyling(true);
    try {
      const { styles } = await window.api.suggestMotionStyles({
        brief: state.brief.trim(),
        duration: state.duration,
        aspect: state.aspect,
        assets: await materialsForModel(),
        previous: state.styleOptions.map((d) => d.name),
      });
      setState((s) => ({ ...s, styleOptions: [...styles, ...s.styleOptions].slice(0, 24) }));
    } catch (e) {
      setError(formatGenerationError(e));
    } finally {
      setStyling(false);
    }
  };

  const generate = async () => {
    if (!state.brief.trim() && !materials.length) {
      setError(tm.errorNoInput);
      return;
    }
    setError('');
    setGenerating(true);
    try {
      const { storyboard, costUsd } = await window.api.createMotionStoryboard({
        brief: state.brief.trim(),
        duration: state.duration,
        aspect: state.aspect,
        assets: await materialsForModel(),
        previous: state.variants.map((v) => `${v.storyboard.title}: ${v.storyboard.concept}`),
        style: state.style,
      });
      const v: MotionVariant = {
        id: newId(),
        createdAt: new Date().toISOString(),
        storyboard,
        aspect: state.aspect,
        assetIds: materials.map((a) => a.id),
        costUsd,
        styleName: state.style?.name,
      };
      setState((s) => ({ ...s, variants: [...s.variants, v], selectedId: v.id }));
    } catch (e) {
      setError(formatGenerationError(e));
    } finally {
      setGenerating(false);
    }
  };

  const deleteVariant = (id: string) => {
    setOpenId((o) => (o === id ? null : o));
    setState((s) => pruneAssets({ ...s, variants: s.variants.filter((v) => v.id !== id), selectedId: s.selectedId === id ? null : s.selectedId }));
  };

  // ---- render queue: one job at a time, each with the settings it was queued with
  const enqueue = (variantId: string) => {
    if (!qualityOk(quality.id, state.fps)) return;
    setError('');
    setJobs((list) => [
      ...list,
      { id: newId(), variantId, aspect: state.renderAspect, width: size.width, height: size.height, fps: state.fps, status: 'queued', progress: 0 },
    ]);
  };

  const running = jobs.find((j) => j.status === 'rendering');
  const nextJob = jobs.find((j) => j.status === 'queued');
  const started = useRef(new Set<string>());
  useEffect(() => {
    if (running || !nextJob || started.current.has(nextJob.id)) return;
    const job = nextJob;
    started.current.add(job.id);
    const variant = state.variants.find((v) => v.id === job.variantId);
    if (!variant) {
      setJobs((list) => list.filter((j) => j.id !== job.id));
      return;
    }
    const abort = new AbortController();
    aborts.current[job.id] = abort;
    setJobs((list) => list.map((j) => (j.id === job.id ? { ...j, status: 'rendering' } : j)));
    void (async () => {
      // own <video> elements for the export, so the board's stills can't seek them mid-render
      const own = await Promise.all(variant.assetIds.map((id) => {
        const a = assetById.get(id);
        return a ? loadSource(a).catch(() => null) : Promise.resolve(null);
      }));
      try {
        const { blob, ext, codec } = await renderVideo({
          board: variant.storyboard,
          sources: own.map((o) => o?.source ?? null),
          width: job.width,
          height: job.height,
          fps: job.fps,
          signal: abort.signal,
          onProgress: (p) => setJobs((list) => list.map((j) => (j.id === job.id ? { ...j, progress: p } : j))),
        });
        const url = URL.createObjectURL(blob);
        setRenders((list) => [
          { id: newId(), variantId: variant.id, title: variant.storyboard.title, url, ext, codec, aspect: job.aspect, width: job.width, height: job.height, fps: job.fps, size: blob.size },
          ...list,
        ]);
        setJobs((list) => list.filter((j) => j.id !== job.id));
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') setJobs((list) => list.filter((j) => j.id !== job.id));
        else setJobs((list) => list.map((j) => (j.id === job.id ? { ...j, status: 'error', error: e instanceof Error ? e.message : String(e) } : j)));
      } finally {
        own.forEach((o) => o?.release());
        delete aborts.current[job.id];
      }
    })();
  }, [running, nextJob, state.variants, assetById]);

  const cancelJob = (id: string) => {
    if (aborts.current[id]) aborts.current[id].abort();
    else setJobs((list) => list.filter((j) => j.id !== id));
  };

  const download = (r: RenderedVideo) => {
    const a = document.createElement('a');
    a.href = r.url;
    a.download = `oneflow-motion-${r.width}x${r.height}.${r.ext}`;
    a.click();
  };
  const removeRender = (id: string) =>
    setRenders((list) => {
      const r = list.find((x) => x.id === id);
      if (r) URL.revokeObjectURL(r.url);
      return list.filter((x) => x.id !== id);
    });

  const variantTitle = (id: string) => {
    const i = state.variants.findIndex((v) => v.id === id);
    return i < 0 ? '' : `${tm.variantN(i + 1)} · ${state.variants[i].storyboard.title}`;
  };

  const renderLabel = `${state.renderAspect} · ${size.width}×${size.height}`;

  return (
    <div className={`motion-panel ${active ? '' : 'motion-hidden'}`}>
      <div className="mk-board">
        {/* ---------------------------------------------------------------- Бриф */}
        <section className="mk-col">
          <header className="mk-col-head">
            <b>{tm.colBrief}</b>
          </header>
          <div className="mk-card">
            <span className="mk-label">{tm.materials}</span>
            <div
              className="motion-assets"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
              }}
            >
              {materials.map((a) => (
                <AssetThumb key={a.id} asset={a} source={sources[a.id]} onRemove={() => removeMaterial(a.id)} removeLabel={tm.removeAsset} />
              ))}
              {materials.length < MOTION_MAX_ASSETS && (
                <button type="button" className="motion-asset-add" onClick={() => fileInput.current?.click()} title={tm.addMaterials}>
                  <IconPlus size={16} />
                  <span>{materials.length ? tm.addMore : tm.addMaterials}</span>
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            <span className="motion-hint">{tm.materialsHint}</span>

            <span className="mk-label">{tm.brief}</span>
            <textarea className="node-textarea motion-brief" value={state.brief} onChange={(e) => update({ brief: e.target.value })} placeholder={tm.briefPlaceholder} maxLength={4000} />

            <span className="mk-label">{tm.duration}</span>
            <div className="mk-chips">
              {MOTION_DURATIONS.map((d) => (
                <button key={d} type="button" className={`mk-chip ${state.duration === d ? 'on' : ''}`} onClick={() => update({ duration: d })}>
                  {tm.seconds(d)}
                </button>
              ))}
            </div>

            <span className="mk-label">{tm.aspect}</span>
            <div className="mk-chips">
              {MOTION_ASPECTS.map((a) => (
                <button key={a} type="button" className={`mk-chip ${state.aspect === a ? 'on' : ''}`} onClick={() => update({ aspect: a })}>
                  <AspectIcon aspect={a} /> {a}
                </button>
              ))}
            </div>
          </div>

          <div className="mk-card">
            <span className="mk-label">{tm.stylesFromClaude}</span>
            <button type="button" className={`mk-style-row ${!state.style ? 'on' : ''}`} onClick={() => update({ style: null })}>
              <span className="mk-style-auto">
                <IconSparkles size={12} />
              </span>
              <span className="mk-style-text">
                <b>{tm.styleAutoShort}</b>
                <small>{tm.styleAuto}</small>
              </span>
            </button>
            {styling && [0, 1].map((k) => <div key={k} className="mk-style-row skeleton" />)}
            {state.styleOptions.map((d) => (
              <StyleRow
                key={d.id}
                d={d}
                chosen={state.style?.id === d.id}
                onPick={() => update({ style: d })}
                sources={materialSources}
                fontsReady={fontsReady}
                meta={`${tm.paceLabels[d.pace]} · ${tm.fontLabels[d.style.font]}${(d.style.fx ?? []).length ? ` · ${(d.style.fx ?? []).map((f) => tm.fxLabels[f]).join(', ')}` : ''}`}
              />
            ))}
            <button type="button" className="motion-secondary mk-wide" onClick={() => void suggestStyles()} disabled={styling || !loaded}>
              <IconSparkles size={13} /> {styling ? tm.suggestingStyles(fmtTime(elapsed)) : state.styleOptions.length ? tm.moreStyles : tm.suggestStyles}
            </button>
          </div>

          <button className="generate-btn mk-wide" onClick={generate} disabled={generating || !loaded}>
            {generating ? tm.generating(fmtTime(elapsed)) : state.variants.length ? tm.moreVariant : tm.makeBoard}
          </button>
          <span className="motion-hint">{tm.costHint}</span>
          {error && <div className="error-text">{error}</div>}
        </section>

        {/* ---------------------------------------------------------------- Раскадровки */}
        <section className="mk-col">
          <header className="mk-col-head">
            <b>{tm.colBoards}</b>
            <i>{state.variants.length}</i>
          </header>
          {!state.variants.length && !generating && <div className="mk-empty">{tm.emptyBoards}</div>}
          {[...state.variants].reverse().map((v) => {
            const i = state.variants.indexOf(v);
            const queuedCount = jobs.filter((j) => j.variantId === v.id).length;
            return (
              <article
                key={v.id}
                className={`mk-card mk-variant ${openId === v.id ? 'open' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, v.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => setOpenId(v.id)}
              >
                <div className="mk-strip">
                  {v.storyboard.scenes.slice(0, 6).map((_, k) => (
                    <SceneStill key={k} board={v.storyboard} sources={sourcesFor(v)} index={k} aspect={v.aspect} fontsReady={fontsReady} short={140} />
                  ))}
                </div>
                <b className="mk-variant-title">
                  {tm.variantN(i + 1)} · {v.storyboard.title}
                </b>
                <div className="mk-tags">
                  <span className="mk-tag blue">{v.styleName ?? tm.styleAutoShort}</span>
                  <span className="mk-tag green">{tm.scenesDur(v.storyboard.scenes.length, v.storyboard.duration)}</span>
                  <span className="mk-tag">{v.aspect}</span>
                  {queuedCount > 0 && <span className="mk-tag orange">{tm.inQueue(queuedCount)}</span>}
                </div>
                <div className="mk-variant-actions">
                  <button
                    type="button"
                    className="motion-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenId(v.id);
                    }}
                  >
                    <IconPlay size={11} /> {tm.open}
                  </button>
                  <button
                    type="button"
                    className="mk-to-render"
                    onClick={(e) => {
                      e.stopPropagation();
                      enqueue(v.id);
                    }}
                    title={renderLabel}
                  >
                    <IconVideo size={13} /> {tm.toRender}
                  </button>
                </div>
              </article>
            );
          })}
          {generating && (
            <div className="mk-card mk-pending">
              <div className="mk-strip">
                {[0, 1, 2, 3, 4].map((k) => (
                  <i key={k} />
                ))}
              </div>
              <b>{tm.variantN(state.variants.length + 1)}</b>
              <span className="motion-hint">{tm.generating(fmtTime(elapsed))}</span>
            </div>
          )}
          {state.variants.length > 0 && !generating && (
            <button type="button" className="mk-add" onClick={generate}>
              <IconRegenerate size={13} /> {tm.addVariant}
            </button>
          )}
        </section>

        {/* ---------------------------------------------------------------- Рендер */}
        <section
          className={`mk-col mk-render-col ${dropActive ? 'drop' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault();
              setDropActive(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(DRAG_TYPE);
            setDropActive(false);
            if (id) {
              e.preventDefault();
              enqueue(id);
            }
          }}
        >
          <header className="mk-col-head">
            <b>{tm.colRender}</b>
            <i>{jobs.length}</i>
          </header>
          <div className="mk-card">
            <span className="mk-label">{tm.renderSettings}</span>
            <span className="mk-sublabel">{tm.renderAspect}</span>
            <div className="mk-chips">
              {MOTION_ASPECTS.map((a) => (
                <button key={a} type="button" className={`mk-chip ${state.renderAspect === a ? 'on' : ''}`} onClick={() => update({ renderAspect: a })}>
                  <AspectIcon aspect={a} /> {a}
                </button>
              ))}
            </div>
            <span className="mk-sublabel">{tm.quality}</span>
            <div className="mk-chips">
              {MOTION_QUALITIES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className={`mk-chip ${state.quality === q.id ? 'on' : ''}`}
                  onClick={() => update({ quality: q.id })}
                  disabled={!qualityOk(q.id, state.fps)}
                  title={qualityOk(q.id, state.fps) ? '' : tm.notSupported}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <span className="mk-sublabel">{tm.fps}</span>
            <div className="mk-chips">
              {MOTION_FPS.map((f) => (
                <button key={f} type="button" className={`mk-chip ${state.fps === f ? 'on' : ''}`} onClick={() => update({ fps: f })}>
                  {f}
                </button>
              ))}
            </div>
            <span className="mk-size">{tm.willRender(size.width, size.height, state.fps)}</span>
          </div>

          {jobs.map((j) => (
            <div key={j.id} className={`mk-card mk-job ${j.status}`}>
              <b>{variantTitle(j.variantId)}</b>
              <span className="motion-hint">
                {j.aspect} · {j.width}×{j.height} · {j.fps} fps
              </span>
              {j.status === 'error' ? (
                <span className="error-text">{j.error}</span>
              ) : (
                <>
                  <div className="motion-progress">
                    <i style={{ width: `${j.progress * 100}%` }} />
                  </div>
                  <span className="mk-job-state">{j.status === 'rendering' ? tm.rendering(Math.round(j.progress * 100)) : tm.queued}</span>
                </>
              )}
              <button type="button" className="motion-secondary" onClick={() => (j.status === 'error' ? setJobs((l) => l.filter((x) => x.id !== j.id)) : cancelJob(j.id))}>
                {j.status === 'error' ? tm.remove : tm.cancel}
              </button>
            </div>
          ))}
          <div className="mk-drop">{tm.dropHere}</div>
        </section>

        {/* ---------------------------------------------------------------- Готово */}
        <section className="mk-col">
          <header className="mk-col-head">
            <b>{tm.colDone}</b>
            <i>{renders.length}</i>
          </header>
          {!renders.length && <div className="mk-empty">{tm.emptyDone}</div>}
          {renders.map((r) => (
            <div key={r.id} className="mk-card mk-done">
              <video src={r.url} controls playsInline style={{ aspectRatio: `${r.width} / ${r.height}` }} />
              <b>{r.title}</b>
              <span className="motion-hint">
                {r.aspect} · {r.width}×{r.height} · {r.fps} fps · {r.ext.toUpperCase()} ({r.codec}) · {fmtMb(r.size)}
              </span>
              {r.ext === 'webm' && <span className="motion-hint">{tm.webmNote}</span>}
              <div className="mk-variant-actions">
                <button type="button" className="mk-download" onClick={() => download(r)}>
                  <IconDownload size={13} /> {tm.download}
                </button>
                <button type="button" className="motion-icon-btn" onClick={() => removeRender(r.id)} title={tm.remove} aria-label={tm.remove}>
                  <IconClose size={11} />
                </button>
              </div>
            </div>
          ))}
          {renders.length > 0 && <span className="motion-hint">{tm.doneHint}</span>}
        </section>
      </div>

      {opened && (
        <VariantDrawer
          key={opened.id}
          variant={opened}
          index={state.variants.indexOf(opened)}
          sources={sourcesFor(opened)}
          aspect={state.renderAspect}
          fontsReady={fontsReady}
          active={active}
          renderLabel={renderLabel}
          canRender={qualityOk(quality.id, state.fps)}
          onRender={() => enqueue(opened.id)}
          onDelete={() => deleteVariant(opened.id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

// Full storyboard of one variant: live preview, every scene at the current render frame, and the
// same «В рендер» as on the card.
function VariantDrawer({ variant, index, sources, aspect, fontsReady, active, renderLabel, canRender, onRender, onDelete, onClose }: {
  variant: MotionVariant;
  index: number;
  sources: MotionSources;
  aspect: string;
  fontsReady: boolean;
  active: boolean;
  renderLabel: string;
  canRender: boolean;
  onRender: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const tm = useT().motion;
  const board = variant.storyboard;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const playRef = useRef(0);
  const previewSize = useMemo(() => frameSize(aspect, 540), [aspect]);

  const stop = useCallback(() => {
    playRef.current++;
    setPlaying(false);
  }, []);
  const play = async () => {
    const cv = canvas.current;
    if (!cv) return;
    const token = ++playRef.current;
    setPlaying(true);
    const ctx = cv.getContext('2d')!;
    const t0 = performance.now();
    while (playRef.current === token) {
      const tt = (performance.now() - t0) / 1000;
      if (tt >= board.duration) break;
      await prepareFrame(board, sources, tt);
      if (playRef.current !== token) return;
      drawFrame(ctx, cv.width, cv.height, board, sources, tt);
      setTime(tt);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (playRef.current === token) setPlaying(false);
  };
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  // idle frame
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || playing) return;
    const ctx = cv.getContext('2d')!;
    const tt = Math.min(board.duration - 0.01, board.scenes[0] ? Math.min(board.scenes[0].dur * 0.6, 1.2) : 0);
    queueDraw(async () => {
      await prepareFrame(board, sources, tt);
      drawFrame(ctx, cv.width, cv.height, board, sources, tt);
    });
  }, [board, sources, previewSize, playing, fontsReady]);

  return (
    <div className="mk-drawer-shade" onClick={onClose}>
      <aside className="mk-drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="mk-drawer-head">
          <div>
            <span className="mk-label">{tm.variantN(index + 1)}{variant.styleName ? ` · ${variant.styleName}` : ''}</span>
            <h3>{board.title}</h3>
            {board.concept && <p>{board.concept}</p>}
            <span className="motion-meta">
              {tm.meta(board.scenes.length, board.duration, variant.aspect)}
              {variant.costUsd > 0 && ` · ${fmtUsd(variant.costUsd)}`}
            </span>
          </div>
          <button type="button" className="motion-icon-btn" onClick={onClose} title={tm.close} aria-label={tm.close}>
            <IconClose size={13} />
          </button>
        </header>

        <div className="motion-preview" style={{ aspectRatio: `${previewSize.width} / ${previewSize.height}` }}>
          <canvas ref={canvas} width={previewSize.width} height={previewSize.height} />
        </div>
        <div className="motion-preview-bar">
          <button type="button" className="motion-play" onClick={() => (playing ? stop() : void play())}>
            {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
          </button>
          <span className="motion-time">
            {fmtTime(time)} / {fmtTime(board.duration)} · {tm.sceneN(sceneIndexAt(board, time) + 1)}
          </span>
        </div>
        {variant.aspect !== aspect && <span className="motion-hint">{tm.composedFor(variant.aspect)}</span>}

        <span className="mk-label">{tm.previewAt(aspect)}</span>
        <div className={`mk-scenes ${frameSize(aspect, 100).height > frameSize(aspect, 100).width ? 'portrait' : ''}`}>
          {board.scenes.map((s: MotionScene, i: number) => (
            <div key={i} className="motion-scene">
              <SceneStill board={board} sources={sources} index={i} aspect={aspect} fontsReady={fontsReady} short={300} />
              <span className="motion-scene-time">
                {tm.sceneN(i + 1)} · {s.start.toFixed(1)}–{(s.start + s.dur).toFixed(1)} с
              </span>
              <span className="motion-scene-tags">
                {tm.layoutLabels[s.layout]} · {tm.cameraLabels[s.camera]} · {tm.transitionLabels[s.transition]}
              </span>
              {s.note && <span className="motion-scene-note">{s.note}</span>}
            </div>
          ))}
        </div>

        <footer className="mk-drawer-foot">
          <button type="button" className="motion-secondary" onClick={onDelete}>
            {tm.deleteVariant}
          </button>
          <button
            type="button"
            className="generate-btn mk-render-now"
            disabled={!canRender}
            onClick={() => {
              onRender();
              onClose();
            }}
          >
            <IconVideo size={14} /> {tm.renderThis(renderLabel)}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function Swatches({ d }: { d: MotionStyleDirection }) {
  return (
    <span className="motion-swatches" aria-hidden="true">
      {[d.style.bg, d.style.ink, d.style.accent].map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

// A proposed style direction as a compact row: example frame built from the user's own materials,
// name, palette and what it means for pace / type / effects. Click = use it for the next storyboards.
function StyleRow({ d, chosen, onPick, sources, fontsReady, meta }: {
  d: MotionStyleDirection;
  chosen: boolean;
  onPick: () => void;
  sources: MotionSources;
  fontsReady: boolean;
  meta: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const board = useMemo<MotionStoryboard>(() => {
    const n = sources.filter(Boolean).length;
    const want = d.layouts.find((l) => (l === 'grid' ? n >= 2 : l === 'text-only' || n > 0)) ?? (n ? 'full' : 'text-only');
    const scene: MotionScene = {
      start: 0,
      dur: 3,
      layout: want,
      asset: want === 'text-only' || !n ? null : 0,
      assets: want === 'grid' ? [0, 1, 2, 3].slice(0, Math.min(4, n)) : [],
      headline: d.sample || d.name,
      sub: '',
      cta: '',
      camera: d.cameras[0] ?? 'static',
      textAnim: d.textAnims[0] ?? 'fade-up',
      transition: 'fade',
      bg: '',
      note: '',
    };
    return { title: d.name, concept: d.description, style: d.style, duration: 3, scenes: [scene] };
  }, [d, sources]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let cancelled = false;
    queueDraw(async () => {
      if (cancelled) return;
      await prepareFrame(board, sources, 1);
      if (!cancelled) drawStill(cv.getContext('2d')!, cv.width, cv.height, board, sources, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [board, sources, fontsReady]);
  return (
    <button type="button" className={`mk-style-row ${chosen ? 'on' : ''}`} onClick={onPick} title={d.description}>
      <canvas ref={ref} width={192} height={108} className="mk-style-thumb" />
      <span className="mk-style-text">
        <b>
          {d.name} <Swatches d={d} />
        </b>
        <small>{meta}</small>
      </span>
    </button>
  );
}

function AspectIcon({ aspect }: { aspect: string }) {
  const [a, b] = aspect.split(':').map(Number);
  const k = 12 / Math.max(a, b);
  return <i className="motion-aspect-icon" style={{ width: Math.max(4, a * k), height: Math.max(4, b * k) }} />;
}

function AssetThumb({ asset, source, onRemove, removeLabel }: { asset: MotionAsset; source?: MotionSource; onRemove: () => void; removeLabel: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !source) return;
    const draw = () => {
      const ctx = cv.getContext('2d')!;
      const k = Math.max(cv.width / source.width, cv.height / source.height);
      ctx.drawImage(source.el, (cv.width - source.width * k) / 2, (cv.height - source.height * k) / 2, source.width * k, source.height * k);
    };
    if (source.video && source.video.readyState < 2) source.video.addEventListener('loadeddata', draw, { once: true });
    else draw();
  }, [source]);
  return (
    <div className="motion-asset" title={asset.name}>
      <canvas ref={ref} width={144} height={144} />
      {asset.kind === 'video' && <span className="motion-asset-badge">{fmtTime(asset.duration ?? 0)}</span>}
      <button type="button" className="motion-asset-remove" onClick={onRemove} title={removeLabel} aria-label={removeLabel}>
        <IconClose size={10} />
      </button>
    </div>
  );
}

// Static storyboard frame of one scene at a given frame shape. Videos share their <video> element
// across the board, so their frame is captured once into this canvas.
function SceneStill({ board, sources, index, aspect, fontsReady, short }: { board: MotionStoryboard; sources: MotionSources; index: number; aspect: string; fontsReady: boolean; short: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = frameSize(aspect, short);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let cancelled = false;
    const s = board.scenes[index];
    const tt = s.start + Math.min(s.dur * 0.5, 1);
    queueDraw(async () => {
      if (cancelled) return;
      await prepareFrame(board, sources, tt);
      if (!cancelled) drawStill(cv.getContext('2d')!, cv.width, cv.height, board, sources, index);
    });
    return () => {
      cancelled = true;
    };
  }, [board, sources, index, size.width, size.height, fontsReady]);
  return <canvas ref={ref} width={size.width} height={size.height} className="motion-still" />;
}

// Stills and the idle preview frame seek shared <video> elements, so they're drawn one after
// another, never in parallel.
let drawQueue: Promise<unknown> = Promise.resolve();
function queueDraw(job: () => Promise<void>) {
  drawQueue = drawQueue.then(job, job);
}
