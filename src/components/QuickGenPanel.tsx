import { useState } from 'react';
import {
  IconPlus,
  IconChevronRight,
  IconChevronDown,
  IconDownload,
  IconRefresh,
  IconClose,
  IconImage,
  IconVideo,
  IconCopy,
  IconCheck,
} from './Icons';
import DropdownMenu from './DropdownMenu';
import {
  ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_MODEL_META,
  VIDEO_MODELS,
  VIDEO_MODEL_META,
  VIDEO_PRO_MODEL,
  modelShortName,
} from '../types';
import { useGenerationCounter } from '../store/generationCounter';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

type GenKind = 'image' | 'video';
type AttachMode = 'none' | 'startEnd' | 'refImages' | 'videoRef';

interface QuickGenEntry {
  id: string;
  kind: GenKind;
  status: 'loading' | 'done' | 'error';
  aspectRatio: string;
  prompt: string;
  model: string;
  resolution: string;
  duration?: number;
  outputs: string[];
  error?: string;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

interface QuickGenPanelProps {
  active: boolean;
  projectId: string;
  subscriptionActive: boolean;
  onRequestPayment: () => void;
}

let entryIdCounter = 0;
const nextEntryId = () => `qg-${++entryIdCounter}-${Date.now().toString(36)}`;

// GPT Image 2's "resolution" options are quality tiers with translatable names — same mapping
// as ImageGenNode's local QUALITY_LABEL_KEYS, duplicated here rather than exported since it's
// tiny and each node/panel already owns its own resolution-select rendering.
const QUALITY_LABEL_KEYS: Record<string, 'qualityAuto' | 'qualityLow' | 'qualityMedium' | 'qualityHigh'> = {
  auto: 'qualityAuto',
  low: 'qualityLow',
  medium: 'qualityMedium',
  high: 'qualityHigh',
};

function toCssAspectRatio(ratio: string): string {
  return ratio.replace(':', ' / ');
}

export default function QuickGenPanel({
  active,
  projectId,
  subscriptionActive,
  onRequestPayment,
}: QuickGenPanelProps) {
  const t = useT();
  const incrementGenerations = useGenerationCounter((s) => s.increment);
  const [kind, setKind] = useState<GenKind>('image');
  const [model, setModel] = useState<string>(IMAGE_MODELS[0].value);
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [resolution, setResolution] = useState<string>(IMAGE_MODEL_META[IMAGE_MODELS[0].value].resolutions[0].value);
  const [prompt, setPrompt] = useState('');
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachMode, setAttachMode] = useState<AttachMode>('none');
  const [startFrame, setStartFrame] = useState<string | null>(null);
  const [endFrame, setEndFrame] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [videoRef, setVideoRef] = useState<string | null>(null);
  const [entries, setEntries] = useState<QuickGenEntry[]>([]);
  const [openEntry, setOpenEntry] = useState<QuickGenEntry | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const generating = entries.some((e) => e.status === 'loading');

  const resetAttachments = () => {
    setAttachMode('none');
    setStartFrame(null);
    setEndFrame(null);
    setReferenceImages([]);
    setVideoRef(null);
  };

  const handleKindChange = (nextKind: GenKind) => {
    if (nextKind === kind) return;
    setKind(nextKind);
    resetAttachments();
    if (nextKind === 'image') {
      const first = IMAGE_MODELS[0].value;
      setModel(first);
      setResolution(IMAGE_MODEL_META[first].resolutions[0].value);
    } else {
      const first = VIDEO_MODELS[0].value;
      setModel(first);
      setResolution(VIDEO_MODEL_META[first].resolutions[0]);
    }
  };

  const handleModelChange = (nextModel: string) => {
    setModel(nextModel);
    if (kind === 'image') {
      setResolution(IMAGE_MODEL_META[nextModel].resolutions[0].value);
    } else {
      setResolution(VIDEO_MODEL_META[nextModel].resolutions[0]);
      if (attachMode === 'videoRef' && nextModel !== VIDEO_PRO_MODEL) resetAttachments();
    }
  };

  const pickAndSet = async (setter: (dataUrl: string) => void) => {
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) setter(dataUrl);
  };

  const addReferenceImage = async () => {
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) setReferenceImages((prev) => [...prev, dataUrl]);
  };

  const pickVideoRef = async () => {
    const dataUrl = await window.api.pickMediaFile('video');
    if (dataUrl) setVideoRef(dataUrl);
  };

  // Photo mode only ever attaches reference images, so skip the type-choice menu entirely and
  // go straight to the file picker; video mode still has three distinct attach concepts, so it
  // keeps the dropdown.
  const handleAttachClick = () => {
    if (kind === 'image') {
      setAttachMode('refImages');
      void addReferenceImage();
    } else {
      setAttachMenuOpen((v) => !v);
    }
  };

  const handleComposerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleComposerDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));

    if (attachMode === 'videoRef') {
      if (videoFiles[0]) setVideoRef(await readFileAsDataUrl(videoFiles[0]));
      return;
    }
    if (attachMode === 'startEnd') {
      let sf = startFrame;
      let ef = endFrame;
      for (const file of imageFiles) {
        const dataUrl = await readFileAsDataUrl(file);
        if (!sf) {
          sf = dataUrl;
          setStartFrame(dataUrl);
        } else if (!ef) {
          ef = dataUrl;
          setEndFrame(dataUrl);
        }
      }
      return;
    }
    if (imageFiles.length === 0) return;
    const dataUrls = await Promise.all(imageFiles.map(readFileAsDataUrl));
    setAttachMode('refImages');
    setReferenceImages((prev) => [...prev, ...dataUrls]);
  };

  const handleGenerate = async () => {
    if (!subscriptionActive) {
      onRequestPayment();
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed || generating) return;

    const duration =
      kind === 'video'
        ? (() => {
            const meta = VIDEO_MODEL_META[model];
            return Math.min(Math.max(5, meta.minDuration ?? 1), meta.maxDuration);
          })()
        : undefined;

    const entryId = nextEntryId();
    const entry: QuickGenEntry = {
      id: entryId,
      kind,
      status: 'loading',
      aspectRatio,
      prompt: trimmed,
      model,
      resolution,
      duration,
      outputs: [],
    };
    setEntries((prev) => [entry, ...prev]);
    setPrompt('');

    try {
      let outputs: string[];
      if (kind === 'image') {
        const images = [...(startFrame ? [startFrame] : []), ...(endFrame ? [endFrame] : []), ...referenceImages];
        outputs = await window.api.generateImage({
          model,
          prompt: trimmed,
          aspectRatio,
          resolution,
          images: images.length > 0 ? images : undefined,
          projectId,
          category: 'image',
        });
      } else {
        // duration is always set above when kind === 'video'.
        const videoDuration = duration as number;
        if (model === VIDEO_PRO_MODEL) {
          const images = [...(startFrame ? [startFrame] : []), ...(endFrame ? [endFrame] : []), ...referenceImages];
          outputs = await window.api.generateVideoPro({
            prompt: trimmed,
            aspectRatio,
            duration: videoDuration,
            resolution,
            images: images.length > 0 ? images : undefined,
            videos: videoRef ? [videoRef] : undefined,
            projectId,
          });
        } else {
          outputs = await window.api.generateVideo({
            model,
            prompt: trimmed,
            image: startFrame || referenceImages[0] || undefined,
            aspectRatio,
            duration: videoDuration,
            resolution,
            projectId,
          });
        }
      }
      incrementGenerations();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: 'done', outputs } : e)));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: 'error', error: formatGenerationError(err) } : e))
      );
    }
  };

  const handleRegenerate = async (source: QuickGenEntry) => {
    if (!subscriptionActive) {
      onRequestPayment();
      return;
    }
    setOpenEntry(null);
    const entryId = nextEntryId();
    const entry: QuickGenEntry = { ...source, id: entryId, status: 'loading', outputs: [], error: undefined };
    setEntries((prev) => [entry, ...prev]);
    try {
      let outputs: string[];
      if (source.kind === 'image') {
        outputs = await window.api.generateImage({
          model: source.model,
          prompt: source.prompt,
          aspectRatio: source.aspectRatio,
          resolution: source.resolution,
          projectId,
          category: 'image',
        });
      } else {
        const meta = VIDEO_MODEL_META[source.model];
        const duration = Math.min(Math.max(5, meta.minDuration ?? 1), meta.maxDuration);
        outputs =
          source.model === VIDEO_PRO_MODEL
            ? await window.api.generateVideoPro({
                prompt: source.prompt,
                aspectRatio: source.aspectRatio,
                duration,
                resolution: source.resolution,
                projectId,
              })
            : await window.api.generateVideo({
                model: source.model,
                prompt: source.prompt,
                aspectRatio: source.aspectRatio,
                duration,
                resolution: source.resolution,
                projectId,
              });
      }
      incrementGenerations();
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: 'done', outputs } : e)));
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, status: 'error', error: formatGenerationError(err) } : e))
      );
    }
  };

  const handleDownload = async (entry: QuickGenEntry) => {
    const url = entry.outputs[0];
    if (!url) return;
    setDownloading(true);
    try {
      const ext = entry.kind === 'video' ? 'mp4' : 'png';
      await window.api.saveFile(url, `${entry.kind}-${entry.id}.${ext}`);
    } finally {
      setDownloading(false);
    }
  };

  const entryModelLabel = (entry: QuickGenEntry): string => {
    const list = entry.kind === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
    const found = list.find((m) => m.value === entry.model);
    return found ? modelShortName(found.label) : entry.model;
  };

  const copyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1200);
  };

  const modelOptions = kind === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
  const resolutionOptions =
    kind === 'image' ? IMAGE_MODEL_META[model]?.resolutions ?? [] : (VIDEO_MODEL_META[model]?.resolutions ?? []).map((r) => ({ label: r, value: r }));
  const showVideoRefOption = kind === 'video' && model === VIDEO_PRO_MODEL;
  // Empty canvas → composer sits centered like a landing prompt; the moment the first
  // generation is kicked off (an entry exists) it animates down to a bottom-docked bar — see
  // .quick-gen-composer / .quick-gen-composer.docked in App.css for the actual transition.
  const hasStarted = entries.length > 0;

  return (
    <div className={`quick-gen-panel ${active ? '' : 'quick-gen-hidden'}`}>
      <div className="quick-gen-results">
        {entries.map((entry) => (
          <button
            key={entry.id}
            className={`quick-gen-tile ${entry.status}`}
            style={{ aspectRatio: toCssAspectRatio(entry.aspectRatio) }}
            onClick={() => {
              if (entry.status !== 'done') return;
              setPromptCopied(false);
              setOpenEntry(entry);
            }}
            disabled={entry.status !== 'done'}
            title={entry.prompt}
          >
            {entry.status === 'loading' && (
              <div className="quick-gen-tile-spinner">
                <IconRefresh size={13} />
              </div>
            )}
            {entry.status === 'done' &&
              (entry.kind === 'image' ? (
                <img src={entry.outputs[0]} alt="" className="quick-gen-tile-thumb" />
              ) : (
                <video src={entry.outputs[0]} className="quick-gen-tile-thumb" muted />
              ))}
            {entry.status === 'error' && <div className="quick-gen-tile-error">!</div>}
          </button>
        ))}
      </div>

      <div
        className={`quick-gen-composer ${hasStarted ? 'docked' : ''}`}
        onDragOver={handleComposerDragOver}
        onDrop={(e) => void handleComposerDrop(e)}
      >
        <div className="quick-gen-attach-row">
          <button
            className="quick-gen-attach-btn"
            onClick={handleAttachClick}
            title={t.quickGen.attachRefImages}
          >
            <IconPlus size={15} />
          </button>
          {attachMenuOpen && kind === 'video' && (
            <DropdownMenu
              align="left"
              onClose={() => setAttachMenuOpen(false)}
              items={[
                {
                  label: t.quickGen.attachStartEnd,
                  onClick: () => setAttachMode('startEnd'),
                },
                {
                  label: t.quickGen.attachRefImages,
                  onClick: () => setAttachMode('refImages'),
                },
                ...(showVideoRefOption
                  ? [{ label: t.quickGen.attachVideoRef, onClick: () => setAttachMode('videoRef') }]
                  : []),
              ]}
            />
          )}

          {attachMode === 'startEnd' && (
            <div className="quick-gen-attach-chips">
              <button className="quick-gen-attach-chip" onClick={() => pickAndSet(setStartFrame)}>
                {startFrame ? <img src={startFrame} alt="" /> : <IconImage size={14} />}
                <span>{t.quickGen.startFrameLabel}</span>
              </button>
              <button className="quick-gen-attach-chip" onClick={() => pickAndSet(setEndFrame)}>
                {endFrame ? <img src={endFrame} alt="" /> : <IconImage size={14} />}
                <span>{t.quickGen.endFrameLabel}</span>
              </button>
              <button className="quick-gen-attach-close" onClick={resetAttachments}>
                <IconClose size={12} />
              </button>
            </div>
          )}
          {attachMode === 'refImages' && (
            <div className="quick-gen-attach-chips">
              {referenceImages.map((url, i) => (
                <button
                  key={i}
                  className="quick-gen-attach-chip"
                  onClick={() => setReferenceImages((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <img src={url} alt="" />
                </button>
              ))}
              <button className="quick-gen-attach-chip" onClick={addReferenceImage}>
                <IconPlus size={14} />
              </button>
              <button className="quick-gen-attach-close" onClick={resetAttachments}>
                <IconClose size={12} />
              </button>
            </div>
          )}
          {attachMode === 'videoRef' && (
            <div className="quick-gen-attach-chips">
              <button className="quick-gen-attach-chip" onClick={pickVideoRef}>
                {videoRef ? <IconVideo size={14} /> : <IconVideo size={14} />}
                <span>{t.quickGen.attachVideoRef}</span>
              </button>
              <button className="quick-gen-attach-close" onClick={resetAttachments}>
                <IconClose size={12} />
              </button>
            </div>
          )}
        </div>

        <div className="quick-gen-input-row">
          <textarea
            className="quick-gen-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t.quickGen.promptPlaceholder}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {prompt && (
            <button className="quick-gen-clear-btn" onClick={() => setPrompt('')} title={t.nodes.common.remove}>
              <IconClose size={12} />
            </button>
          )}
        </div>

        <div className="quick-gen-controls-row">
          <div className="quick-gen-kind-toggle">
            <button
              className={kind === 'image' ? 'active' : ''}
              onClick={() => handleKindChange('image')}
            >
              {t.quickGen.photoTab}
            </button>
            <button
              className={kind === 'video' ? 'active' : ''}
              onClick={() => handleKindChange('video')}
            >
              {t.quickGen.videoTab}
            </button>
          </div>
          <span className="quick-gen-dot" />
          <div className="quick-gen-pill-select-wrap">
            <select
              className="quick-gen-pill-select"
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {modelOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {modelShortName(m.label)}
                </option>
              ))}
            </select>
            <IconChevronDown size={12} />
          </div>
          <span className="quick-gen-dot" />
          <div className="quick-gen-pill-select-wrap">
            <select
              className="quick-gen-pill-select"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <IconChevronDown size={12} />
          </div>
          <div className="quick-gen-pill-select-wrap">
            <select
              className="quick-gen-pill-select"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              {resolutionOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {QUALITY_LABEL_KEYS[r.value] ? t.nodes.modelMeta[QUALITY_LABEL_KEYS[r.value]] : r.label}
                </option>
              ))}
            </select>
            <IconChevronDown size={12} />
          </div>
          <div className="quick-gen-controls-spacer" />
          <button
            className="quick-gen-generate-btn"
            onClick={() => void handleGenerate()}
            disabled={generating || !prompt.trim()}
          >
            {generating ? t.nodes.common.generating : t.nodes.common.generate}
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>

      {openEntry && (
        <div className="modal-overlay" onClick={() => setOpenEntry(null)}>
          <div className="modal quick-gen-result-modal" onClick={(e) => e.stopPropagation()}>
            {openEntry.kind === 'image' ? (
              <img src={openEntry.outputs[0]} alt="" className="quick-gen-result-media" />
            ) : (
              <video src={openEntry.outputs[0]} className="quick-gen-result-media" controls autoPlay />
            )}
            <div className="quick-gen-result-meta">
              <span>
                {t.nodes.common.model}: {entryModelLabel(openEntry)}
              </span>
              <span>
                {t.nodes.common.resolution}: {openEntry.resolution}
              </span>
              {openEntry.kind === 'video' && openEntry.duration !== undefined && (
                <span>{t.quickGen.durationSeconds(openEntry.duration)}</span>
              )}
            </div>
            <div className="quick-gen-result-prompt">
              <span className="field-label">{t.quickGen.promptLabel}</span>
              <div className="quick-gen-result-prompt-row">
                <p>{openEntry.prompt}</p>
                <button onClick={() => void copyPrompt(openEntry.prompt)} title={t.aiAssistant.copyTooltip}>
                  {promptCopied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => void handleRegenerate(openEntry)}>
                <IconRefresh size={14} /> {t.quickGen.regenerate}
              </button>
              <button className="generate-btn" onClick={() => void handleDownload(openEntry)} disabled={downloading}>
                <IconDownload size={14} /> {t.quickGen.download}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
