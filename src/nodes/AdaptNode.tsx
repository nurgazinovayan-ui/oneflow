import {
  Handle,
  NodeResizer,
  Position,
  useReactFlow,
  useNodeConnections,
  useNodesData,
  type NodeProps,
} from '@xyflow/react';
import { memo, useState } from 'react';
import { convertImageFormat, coverResizeExact } from '../imageAdapt';
import { buildLayeredPsdDataUrl, extractDiffLayer } from '../psdExport';
import { ADAPT_MODEL, ADAPT_SAVE_FORMATS } from '../types';
import type { ImageGenNodeData } from './ImageGenNode';
import { useGenerationCounter } from '../store/generationCounter';
import { useProjectId } from '../store/projectContext';
import { useSubscription } from '../store/subscriptionContext';
import { formatGenerationError } from '../errorMessages';
import {
  IconSparkles,
  IconDownload,
  IconPlus,
  IconCrop,
  IconSave,
  IconRefresh,
} from '../components/Icons';
import LottieLoader from '../components/LottieLoader';
import { useT } from '../i18n';

const BACKGROUND_PLATE_PROMPT =
  'Remove all text, typography, logos, icons and foreground design elements/graphics from ' +
  'this image, leaving only the plain background — seamlessly fill in what was behind them ' +
  'as if they were never there. Keep the background colors, textures, gradients, lighting ' +
  'and overall composition exactly the same — do not add or restyle anything else.';

export interface FormatSpec {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface AdaptNodeData extends Record<string, unknown> {
  formats: FormatSpec[];
  manualImageUrl: string;
  note: string;
  saveFormat: 'png' | 'jpeg' | 'webp' | 'psd';
  status: 'idle' | 'loading' | 'error' | 'done';
  error?: string;
  results: Record<string, string>;
}

function describeShape(width: number, height: number): string {
  const r = width / height;
  if (r > 2.5) return 'очень широкий горизонтальный баннер';
  if (r > 1.3) return 'широкий горизонтальный формат';
  if (r > 0.8) return 'близкий к квадрату формат';
  if (r > 0.4) return 'вертикальный формат';
  return 'очень узкий вертикальный формат';
}

function buildAdaptPrompt(format: FormatSpec, note: string): string {
  const shape = describeShape(format.width, format.height);
  const base =
    `Полностью перекомпонуй макет этого изображения под новый формат «${format.label}» ` +
    `(${format.width}×${format.height} px — это ${shape}). Не просто масштабируй или впиши ` +
    `исходную картинку целиком с полями по краям — заново расставь текст, заголовки, логотип ` +
    `и графические элементы так, чтобы они естественно и полностью заполняли новый холст без ` +
    `пустых пространств. Сохрани иерархию текста (главный заголовок крупнее второстепенного), ` +
    `цветовую схему, стиль и все ключевые элементы, но их размер, положение и взаимное ` +
    `расположение адаптируй под новые пропорции — например, для широкого баннера расположи ` +
    `элементы в ряд по горизонтали, для высокого формата — друг над другом по вертикали.`;
  return note.trim() ? `${base} Дополнительное примечание: ${note.trim()}` : base;
}

function AdaptNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const { updateNodeData, getNode } = useReactFlow();
  const nodeData = data as AdaptNodeData;
  const [saving, setSaving] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const incrementGenerations = useGenerationCounter((s) => s.increment);
  const projectId = useProjectId();
  const subscription = useSubscription();

  const imageConnections = useNodeConnections({ handleType: 'target', handleId: 'image' });
  const sourceId = imageConnections[0]?.source;
  const sourceData = useNodesData(sourceId ?? '');
  const connectedImage = sourceId
    ? ((sourceData?.data as ImageGenNodeData)?.outputs?.[0] ?? '')
    : '';
  const effectiveImage = connectedImage || nodeData.manualImageUrl || '';

  const addFormat = () => {
    const newFormat: FormatSpec = {
      id: `fmt-${Date.now().toString(36)}`,
      label: t.nodes.adapt.newFormatDefaultLabel,
      width: 1080,
      height: 1080,
    };
    updateNodeData(id, { formats: [...nodeData.formats, newFormat] });
  };

  const removeFormat = (formatId: string) => {
    updateNodeData(id, { formats: nodeData.formats.filter((f) => f.id !== formatId) });
  };

  const updateFormat = (formatId: string, patch: Partial<FormatSpec>) => {
    updateNodeData(id, {
      formats: nodeData.formats.map((f) => (f.id === formatId ? { ...f, ...patch } : f)),
    });
  };

  const generateOneFormat = async (format: FormatSpec): Promise<string> => {
    const outputs = await window.api.generateImage({
      model: ADAPT_MODEL,
      prompt: buildAdaptPrompt(format, nodeData.note),
      aspectRatio: `${format.width}:${format.height}`,
      image: effectiveImage,
      width: format.width,
      height: format.height,
      projectId,
      category: 'adapt',
    });
    incrementGenerations();
    // Flux Kontext rounds width/height to the nearest multiple of 32, so the raw
    // output can be off by up to ~16px per side — a final exact-size pass cleans
    // that up without meaningfully cropping any composition.
    const rawDataUrl = await window.api.fetchImageAsDataUrl(outputs[0]);
    return coverResizeExact(rawDataUrl, format.width, format.height);
  };

  const handleApply = async () => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    if (!effectiveImage.trim()) {
      updateNodeData(id, { status: 'error', error: t.nodes.adapt.noInputImageError });
      return;
    }
    if (nodeData.formats.length === 0) {
      updateNodeData(id, { status: 'error', error: t.nodes.adapt.addAtLeastOneFormatError });
      return;
    }
    updateNodeData(id, { status: 'loading', error: undefined });
    const results: Record<string, string> = {};
    try {
      for (const format of nodeData.formats) {
        results[format.id] = await generateOneFormat(format);
        updateNodeData(id, { results: { ...results } });
      }
      updateNodeData(id, { status: 'done' });
    } catch (err) {
      updateNodeData(id, {
        status: 'error',
        error: formatGenerationError(err),
        results: { ...results },
      });
    }
  };

  const handleRegenerate = async (formatId: string) => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    const format = nodeData.formats.find((f) => f.id === formatId);
    if (!format) return;
    if (!effectiveImage.trim()) {
      updateNodeData(id, { error: t.nodes.adapt.noInputImageError });
      return;
    }
    setRegeneratingId(formatId);
    updateNodeData(id, { error: undefined });
    try {
      const result = await generateOneFormat(format);
      updateNodeData(id, { results: { ...nodeData.results, [formatId]: result }, status: 'done' });
    } catch (err) {
      updateNodeData(id, { error: formatGenerationError(err) });
    } finally {
      setRegeneratingId(null);
    }
  };

  const buildSaveArtifact = async (
    formatId: string,
    label: string
  ): Promise<{ name: string; url: string } | null> => {
    const url = nodeData.results[formatId];
    if (!url) return null;
    const format = nodeData.saveFormat || 'png';
    const safeLabel = label.replace(/\s+/g, '_');
    if (format === 'psd') {
      const formatSpec = nodeData.formats.find((f) => f.id === formatId);
      if (!formatSpec) return null;
      const compositeDataUrl = await window.api.fetchImageAsDataUrl(url);
      const bgOutputs = await window.api.generateImage({
        model: ADAPT_MODEL,
        prompt: BACKGROUND_PLATE_PROMPT,
        aspectRatio: `${formatSpec.width}:${formatSpec.height}`,
        image: url,
        width: formatSpec.width,
        height: formatSpec.height,
      });
      incrementGenerations();
      const rawBgDataUrl = await window.api.fetchImageAsDataUrl(bgOutputs[0]);
      const bgDataUrl = await coverResizeExact(rawBgDataUrl, formatSpec.width, formatSpec.height);
      const elementsLayer = await extractDiffLayer(
        compositeDataUrl,
        bgDataUrl,
        formatSpec.width,
        formatSpec.height
      );
      const psdDataUrl = await buildLayeredPsdDataUrl(formatSpec.width, formatSpec.height, [
        { name: t.nodes.adapt.psdLayerBg, dataUrl: bgDataUrl },
        { name: t.nodes.adapt.psdLayerElements, dataUrl: elementsLayer },
      ]);
      return { name: `adapt-${safeLabel}-${id}.psd`, url: psdDataUrl };
    }
    const dataUrl = await window.api.fetchImageAsDataUrl(url);
    const converted = format === 'png' ? dataUrl : await convertImageFormat(dataUrl, format);
    const ext = format === 'jpeg' ? 'jpg' : format;
    return { name: `adapt-${safeLabel}-${id}.${ext}`, url: converted };
  };

  const handleSave = async (formatId: string, label: string) => {
    setSaving(formatId);
    try {
      const artifact = await buildSaveArtifact(formatId, label);
      if (artifact) await window.api.saveFile(artifact.url, artifact.name);
    } finally {
      setSaving(null);
    }
  };

  const handleSaveAll = async () => {
    const readyFormats = nodeData.formats.filter((f) => nodeData.results[f.id]);
    if (readyFormats.length === 0) return;
    setSavingAll(true);
    try {
      const artifacts: { name: string; url: string }[] = [];
      for (const format of readyFormats) {
        const artifact = await buildSaveArtifact(format.id, format.label);
        if (artifact) artifacts.push(artifact);
      }
      if (artifacts.length > 0) await window.api.saveManyFiles(artifacts);
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div className="node node-adapt node-resizable">
      <NodeResizer
        isVisible={selected}
        minWidth={300}
        minHeight={320}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <div className="node-header">
        <IconCrop /> {t.nodes.adapt.header}
      </div>
      <div className="node-body">
        <Handle
          type="target"
          position={Position.Left}
          id="image"
          style={{ top: 40 }}
          title={t.nodes.common.photoHandleTitle}
          isValidConnection={(conn) =>
            ['imageGen', 'imageInput'].includes(getNode(conn.source)?.type ?? '')
          }
        />

        {!sourceId && (
          <>
            <label className="field-label">{t.nodes.adapt.urlLabelNoConn}</label>
            <input
              className="node-select nodrag"
              placeholder={t.nodes.adapt.urlPlaceholder}
              value={nodeData.manualImageUrl}
              onChange={(e) => updateNodeData(id, { manualImageUrl: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </>
        )}
        {sourceId && (
          <div className="connected-hint">
            {t.nodes.adapt.source(
              connectedImage ? t.nodes.common.connected : t.nodes.common.awaitingGeneration
            )}
          </div>
        )}

        <label className="field-label">{t.nodes.adapt.formats}</label>
        <div className="format-list">
          {nodeData.formats.map((f) => (
            <div key={f.id} className="format-row">
              <input
                className="format-label-input nodrag"
                value={f.label}
                onChange={(e) => updateFormat(f.id, { label: e.target.value })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <input
                type="number"
                className="format-dim-input nodrag"
                value={f.width}
                onChange={(e) => updateFormat(f.id, { width: Number(e.target.value) })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span className="format-x">×</span>
              <input
                type="number"
                className="format-dim-input nodrag"
                value={f.height}
                onChange={(e) => updateFormat(f.id, { height: Number(e.target.value) })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                className="format-remove-btn"
                onClick={() => removeFormat(f.id)}
                title={t.nodes.adapt.removeFormatTooltip}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="secondary-btn add-format-btn" onClick={addFormat}>
          <IconPlus size={13} /> {t.nodes.adapt.addFormat}
        </button>

        <label className="field-label">{t.nodes.adapt.note}</label>
        <textarea
          className="node-textarea small nodrag"
          placeholder={t.nodes.adapt.notePlaceholder}
          value={nodeData.note}
          onChange={(e) => updateNodeData(id, { note: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />

        <label className="field-label">{t.nodes.adapt.saveFormat}</label>
        <select
          className="node-select nodrag"
          value={nodeData.saveFormat}
          onChange={(e) => updateNodeData(id, { saveFormat: e.target.value })}
        >
          {ADAPT_SAVE_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.value === 'psd' ? t.nodes.modelMeta.psdSaveFormat : f.label}
            </option>
          ))}
        </select>
        {nodeData.saveFormat === 'psd' && (
          <div className="connected-hint">{t.nodes.adapt.psdHint}</div>
        )}

        <div className="connected-hint">{t.nodes.adapt.perFormatHint}</div>

        <button
          className="generate-btn"
          onClick={handleApply}
          disabled={nodeData.status === 'loading'}
        >
          <IconSparkles /> {nodeData.status === 'loading' ? t.nodes.common.generating : t.nodes.common.generate}
        </button>

        {nodeData.status === 'error' && <div className="error-text">{nodeData.error}</div>}

        {nodeData.status === 'loading' && !nodeData.formats.some((f) => nodeData.results[f.id]) && (
          <div className="preview-area">
            <LottieLoader path="/lottie/generating.json" className="preview-loading" />
          </div>
        )}

        {nodeData.formats.some((f) => nodeData.results[f.id]) && (
          <>
            <button
              className="secondary-btn save-all-btn"
              disabled={savingAll || saving !== null}
              onClick={handleSaveAll}
            >
              <IconSave /> {savingAll ? t.nodes.adapt.savingAll : t.nodes.adapt.saveAll}
            </button>
            <div className="preview-area">
              {nodeData.formats.map((f) => {
                const url = nodeData.results[f.id];
                if (!url) return null;
                return (
                  <div key={f.id} className="preview-item">
                    <div className="format-caption">{t.nodes.adapt.formatCaption(f.label, f.width, f.height)}</div>
                    <div className="preview-media-wrap">
                      <img src={url} alt={f.label} className="preview-image" />
                      <button
                        className="preview-download-btn"
                        disabled={saving === f.id || savingAll || regeneratingId === f.id}
                        onClick={() => handleSave(f.id, f.label)}
                        title={
                          saving === f.id && nodeData.saveFormat === 'psd'
                            ? t.nodes.adapt.preparingPsd
                            : t.nodes.common.save
                        }
                      >
                        <IconDownload size={15} />
                      </button>
                    </div>
                    <div className="preview-item-actions">
                      <button
                        className={`regenerate-btn ${regeneratingId === f.id ? 'spinning' : ''}`}
                        disabled={regeneratingId === f.id || nodeData.status === 'loading'}
                        onClick={() => handleRegenerate(f.id)}
                        title={t.nodes.adapt.regenerateTooltip}
                      >
                        <IconRefresh size={13} /> {t.nodes.adapt.regenerateTooltip}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(AdaptNode);
