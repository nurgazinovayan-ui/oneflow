import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconClose, IconDownload, IconPause, IconPlay, IconPlus, IconRegenerate, IconVideo } from './Icons';
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
  type MotionStoryboard,
  type MotionVariant,
} from '../motion/types';

interface MotionEnginePanelProps {
  active: boolean;
  authEmail: string | null;
}

interface RenderedVideo {
  id: string;
  variantId: string;
  url: string;
  ext: 'mp4' | 'webm';
  codec: string;
  width: number;
  height: number;
  fps: number;
}

const EMPTY: MotionState = {
  brief: '',
  duration: 15,
  aspect: '16:9',
  quality: '1080',
  fps: 30,
  assets: [],
  materialIds: [],
  variants: [],
  selectedId: null,
};

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const fmtUsd = (v: number) => `$${v.toFixed(v < 1 ? 3 : 2)}`;

// Web-only (see App.tsx). Materials + brief → Claude Opus 5.5 storyboard (motion-storyboard Edge
// Function) → static board → preview / render to video in the browser (src/motion). Every
// variant is kept (IndexedDB, per account) and any of them can be rendered at any size.
export default function MotionEnginePanel({ active, authEmail }: MotionEnginePanelProps) {
  const t = useT();
  const tm = t.motion;
  const account = `motion:${authEmail ?? 'anon'}`;
  const [state, setState] = useState<MotionState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [sources, setSources] = useState<Record<string, MotionSource>>({});
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [renderAspect, setRenderAspect] = useState<string | null>(null);
  const [supported, setSupported] = useState<Record<string, boolean>>({});
  const [rendering, setRendering] = useState<{ progress: number; abort: AbortController } | null>(null);
  const [renders, setRenders] = useState<RenderedVideo[]>([]);
  const [playing, setPlaying] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const releases = useRef<Record<string, () => void>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const [previewTime, setPreviewTime] = useState(0);

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
    if (!generating) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500);
    return () => clearInterval(id);
  }, [generating]);

  const update = (patch: Partial<MotionState>) => setState((s) => ({ ...s, ...patch }));
  const assetById = useMemo(() => new Map(state.assets.map((a) => [a.id, a])), [state.assets]);
  const materials = state.materialIds.map((id) => assetById.get(id)).filter((a): a is MotionAsset => Boolean(a));
  const variant = state.variants.find((v) => v.id === state.selectedId) ?? state.variants[state.variants.length - 1] ?? null;
  const aspect = renderAspect ?? variant?.aspect ?? state.aspect;
  const quality = MOTION_QUALITIES.find((q) => q.id === state.quality) ?? MOTION_QUALITIES[1];
  const size = frameSize(aspect, quality.short);
  const variantSources: MotionSources = useMemo(
    () => (variant ? variant.assetIds.map((id) => sources[id] ?? null) : []),
    [variant, sources]
  );

  useEffect(() => setRenderAspect(null), [variant?.id]);

  // which render sizes this browser can encode
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      MOTION_QUALITIES.flatMap((q) =>
        MOTION_FPS.map(async (fps) => {
          const s = frameSize(aspect, q.short);
          return [`${q.id}@${fps}`, (await canEncodeMp4(s.width, s.height, fps)) || canRecordWebm()] as const;
        })
      )
    ).then((pairs) => !cancelled && setSupported(Object.fromEntries(pairs)));
    return () => {
      cancelled = true;
    };
  }, [aspect]);

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

  const generate = async () => {
    if (!state.brief.trim() && !materials.length) {
      setError(tm.errorNoInput);
      return;
    }
    setError('');
    setGenerating(true);
    try {
      const assets = [];
      for (const a of materials) {
        const src = sources[a.id] ?? (await loadSource(a)).source;
        assets.push({ kind: a.kind, name: a.name, duration: a.duration, frames: await framesForModel(a, src) });
      }
      const { storyboard, costUsd } = await window.api.createMotionStoryboard({
        brief: state.brief.trim(),
        duration: state.duration,
        aspect: state.aspect,
        assets,
        previous: state.variants.map((v) => `${v.storyboard.title}: ${v.storyboard.concept}`),
      });
      const v: MotionVariant = {
        id: newId(),
        createdAt: new Date().toISOString(),
        storyboard,
        aspect: state.aspect,
        assetIds: materials.map((a) => a.id),
        costUsd,
      };
      setState((s) => ({ ...s, variants: [...s.variants, v], selectedId: v.id }));
    } catch (e) {
      setError(formatGenerationError(e));
    } finally {
      setGenerating(false);
    }
  };

  const deleteVariant = (id: string) =>
    setState((s) => pruneAssets({ ...s, variants: s.variants.filter((v) => v.id !== id), selectedId: s.selectedId === id ? null : s.selectedId }));

  // ---- preview player (same renderer as the export, played against the wall clock)
  const playRef = useRef(0);
  const stopPreview = useCallback(() => {
    playRef.current++;
    setPlaying(false);
  }, []);
  const startPreview = async () => {
    if (!variant || !previewCanvas.current) return;
    const token = ++playRef.current;
    setPlaying(true);
    const cv = previewCanvas.current;
    const ctx = cv.getContext('2d')!;
    const board = variant.storyboard;
    const t0 = performance.now();
    while (playRef.current === token) {
      const tt = (performance.now() - t0) / 1000;
      if (tt >= board.duration) break;
      await prepareFrame(board, variantSources, tt);
      if (playRef.current !== token) return;
      drawFrame(ctx, cv.width, cv.height, board, variantSources, tt);
      setPreviewTime(tt);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (playRef.current === token) setPlaying(false);
  };
  useEffect(() => {
    if (!active) stopPreview();
  }, [active, stopPreview]);
  useEffect(stopPreview, [variant?.id, aspect, stopPreview]);

  // idle preview frame: first moment of the board
  const previewSize = useMemo(() => frameSize(aspect, 540), [aspect]);
  useEffect(() => {
    const cv = previewCanvas.current;
    if (!cv || !variant || playing) return;
    const ctx = cv.getContext('2d')!;
    const board = variant.storyboard;
    const tt = Math.min(board.duration - 0.01, board.scenes[0] ? Math.min(board.scenes[0].dur * 0.6, 1.2) : 0);
    queueDraw(async () => {
      await prepareFrame(board, variantSources, tt);
      drawFrame(ctx, cv.width, cv.height, board, variantSources, tt);
    });
    setPreviewTime(0);
  }, [variant, variantSources, previewSize, playing, fontsReady]);

  // ---- render
  const render = async () => {
    if (!variant || rendering) return;
    stopPreview();
    setError('');
    const abort = new AbortController();
    setRendering({ progress: 0, abort });
    // own <video> elements for the export, so nothing else on the panel can seek them mid-render
    const own = await Promise.all(variant.assetIds.map((id) => {
      const a = assetById.get(id);
      return a ? loadSource(a).catch(() => null) : Promise.resolve(null);
    }));
    try {
      const { blob, ext, codec } = await renderVideo({
        board: variant.storyboard,
        sources: own.map((o) => o?.source ?? null),
        width: size.width,
        height: size.height,
        fps: state.fps,
        signal: abort.signal,
        onProgress: (p) => setRendering((r) => (r ? { ...r, progress: p } : r)),
      });
      const url = URL.createObjectURL(blob);
      setRenders((list) => [{ id: newId(), variantId: variant.id, url, ext, codec, width: size.width, height: size.height, fps: state.fps }, ...list]);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      own.forEach((o) => o?.release());
      setRendering(null);
    }
  };

  const download = (r: RenderedVideo) => {
    const a = document.createElement('a');
    a.href = r.url;
    a.download = `oneflow-motion-${r.width}x${r.height}.${r.ext}`;
    a.click();
  };

  const variantRenders = renders.filter((r) => r.variantId === variant?.id);
  const hasVariants = state.variants.length > 0;
  const qualityOk = (q: string, fps: number) => supported[`${q}@${fps}`] !== false;

  return (
    <div className={`motion-panel ${active ? '' : 'motion-hidden'}`}>
      <div className="motion-layout">
        <div className="motion-side">
          <span className="field-label">{tm.materials}</span>
          <div
            className="motion-assets"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles(e.dataTransfer.files);
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

          <span className="field-label">{tm.brief}</span>
          <textarea
            className="node-textarea motion-brief"
            value={state.brief}
            onChange={(e) => update({ brief: e.target.value })}
            placeholder={tm.briefPlaceholder}
            maxLength={4000}
          />

          <span className="field-label">{tm.duration}</span>
          <div className="musicaudio-genre-grid">
            {MOTION_DURATIONS.map((d) => (
              <button key={d} type="button" className={`musicaudio-genre-btn ${state.duration === d ? 'active' : ''}`} onClick={() => update({ duration: d })}>
                {tm.seconds(d)}
              </button>
            ))}
          </div>

          <span className="field-label">{tm.aspect}</span>
          <div className="musicaudio-genre-grid">
            {MOTION_ASPECTS.map((a) => (
              <button key={a} type="button" className={`musicaudio-genre-btn ${state.aspect === a ? 'active' : ''}`} onClick={() => update({ aspect: a })}>
                <AspectIcon aspect={a} /> {a}
              </button>
            ))}
          </div>

          <button className="generate-btn motion-generate-btn" onClick={generate} disabled={generating || !loaded}>
            {generating ? tm.generating(fmtTime(elapsed)) : hasVariants ? tm.moreVariant : tm.makeBoard}
          </button>
          <span className="motion-hint">{tm.costHint}</span>
          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="motion-main">
          {(hasVariants || generating) && (
            <div className="motion-variants" role="tablist" aria-label={tm.variants}>
              {state.variants.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={variant?.id === v.id}
                  className={`motion-variant-chip ${variant?.id === v.id ? 'active' : ''}`}
                  onClick={() => update({ selectedId: v.id })}
                >
                  <b>{tm.variantN(i + 1)}</b>
                  <span>{v.storyboard.title}</span>
                </button>
              ))}
              {generating && (
                <span className="motion-variant-chip pending">
                  <b>{tm.variantN(state.variants.length + 1)}</b>
                  <span>{tm.thinking}</span>
                </span>
              )}
            </div>
          )}

          {!variant && !generating && (
            <div className="motion-empty">
              <IconVideo size={22} />
              <b>{tm.emptyTitle}</b>
              <span>{tm.emptyText}</span>
            </div>
          )}
          {!variant && generating && <div className="motion-loading">{tm.generating(fmtTime(elapsed))}</div>}

          {variant && (
            <>
              <div className="motion-head">
                <div>
                  <h3>{variant.storyboard.title}</h3>
                  {variant.storyboard.concept && <p>{variant.storyboard.concept}</p>}
                  <span className="motion-meta">
                    {tm.meta(variant.storyboard.scenes.length, variant.storyboard.duration, variant.aspect)}
                    {variant.costUsd > 0 && ` · ${fmtUsd(variant.costUsd)}`}
                  </span>
                </div>
                <button type="button" className="motion-icon-btn" onClick={() => deleteVariant(variant.id)} title={tm.deleteVariant}>
                  <IconClose size={13} />
                </button>
              </div>

              <div className={`motion-board ${size.height > size.width ? 'portrait' : ''}`}>
                {variant.storyboard.scenes.map((s, i) => (
                  <div key={i} className="motion-scene">
                    <SceneStill board={variant.storyboard} sources={variantSources} index={i} aspect={aspect} fontsReady={fontsReady} />
                    <div className="motion-scene-info">
                      <span className="motion-scene-time">
                        {tm.sceneN(i + 1)} · {s.start.toFixed(1)}–{(s.start + s.dur).toFixed(1)} с
                      </span>
                      <span className="motion-scene-tags">
                        {tm.layoutLabels[s.layout]} · {tm.cameraLabels[s.camera]} · {tm.transitionLabels[s.transition]}
                      </span>
                      {s.note && <span className="motion-scene-note">{s.note}</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="motion-stage">
                <div className="motion-preview" style={{ aspectRatio: `${previewSize.width} / ${previewSize.height}` }}>
                  <canvas ref={previewCanvas} width={previewSize.width} height={previewSize.height} />
                </div>
                <div className="motion-preview-bar">
                  <button type="button" className="motion-play" onClick={() => (playing ? stopPreview() : void startPreview())} disabled={Boolean(rendering)}>
                    {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
                  </button>
                  <span className="motion-time">
                    {fmtTime(previewTime)} / {fmtTime(variant.storyboard.duration)} · {tm.sceneN(sceneIndexAt(variant.storyboard, previewTime) + 1)}
                  </span>
                </div>
              </div>

              <div className="motion-render">
                <div className="motion-render-row">
                  <span className="field-label">{tm.renderAspect}</span>
                  <div className="musicaudio-genre-grid">
                    {MOTION_ASPECTS.map((a) => (
                      <button key={a} type="button" className={`musicaudio-genre-btn ${aspect === a ? 'active' : ''}`} onClick={() => setRenderAspect(a)} disabled={Boolean(rendering)}>
                        <AspectIcon aspect={a} /> {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="motion-render-row">
                  <span className="field-label">{tm.quality}</span>
                  <div className="musicaudio-genre-grid">
                    {MOTION_QUALITIES.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        className={`musicaudio-genre-btn ${state.quality === q.id ? 'active' : ''}`}
                        onClick={() => update({ quality: q.id })}
                        disabled={Boolean(rendering) || !qualityOk(q.id, state.fps)}
                        title={qualityOk(q.id, state.fps) ? '' : tm.notSupported}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="motion-render-row">
                  <span className="field-label">{tm.fps}</span>
                  <div className="musicaudio-genre-grid">
                    {MOTION_FPS.map((f) => (
                      <button key={f} type="button" className={`musicaudio-genre-btn ${state.fps === f ? 'active' : ''}`} onClick={() => update({ fps: f })} disabled={Boolean(rendering)}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                {variant.aspect !== aspect && <span className="motion-hint">{tm.composedFor(variant.aspect)}</span>}

                <div className="motion-actions">
                  {rendering ? (
                    <>
                      <div className="motion-progress" aria-label={tm.rendering(Math.round(rendering.progress * 100))}>
                        <i style={{ width: `${rendering.progress * 100}%` }} />
                      </div>
                      <span className="motion-time">{tm.rendering(Math.round(rendering.progress * 100))}</span>
                      <button type="button" className="motion-secondary" onClick={() => rendering.abort.abort()}>
                        {tm.cancel}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="generate-btn motion-render-btn" onClick={render} disabled={!qualityOk(quality.id, state.fps)}>
                        <IconVideo size={14} /> {tm.render(size.width, size.height)}
                      </button>
                      <button type="button" className="motion-secondary" onClick={generate} disabled={generating}>
                        <IconRegenerate size={13} /> {generating ? tm.thinking : tm.moreVariant}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {variantRenders.length > 0 && (
                <div className="motion-renders">
                  <span className="field-label">{tm.renders}</span>
                  {variantRenders.map((r) => (
                    <div key={r.id} className="motion-rendered">
                      <video src={r.url} controls playsInline style={{ aspectRatio: `${r.width} / ${r.height}` }} />
                      <div className="motion-rendered-bar">
                        <span className="motion-time">
                          {r.width}×{r.height} · {r.fps} fps · {r.ext.toUpperCase()} ({r.codec})
                        </span>
                        <button type="button" className="motion-secondary" onClick={() => download(r)}>
                          <IconDownload size={13} /> {tm.download}
                        </button>
                      </div>
                      {r.ext === 'webm' && <span className="motion-hint">{tm.webmNote}</span>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
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

// Static storyboard frame of one scene, drawn at the chosen render aspect. Videos share their
// <video> element with the preview/export, so their frame is captured once into this canvas.
function SceneStill({ board, sources, index, aspect, fontsReady }: { board: MotionStoryboard; sources: MotionSources; index: number; aspect: string; fontsReady: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = frameSize(aspect, 360);
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
