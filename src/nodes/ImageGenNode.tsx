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
import {
  ASPECT_RATIOS,
  IMAGE_MODEL_META,
  IMAGE_MODELS,
  IMAGE_REFERENCE_SLOTS,
  IMAGE_SAVE_FORMATS,
  IMAGE_VARIANT_COUNTS,
  modelShortName,
} from '../types';
import type { PromptNodeData } from './PromptNode';
import { convertImageFormat } from '../imageAdapt';
import { useGenerationCounter } from '../store/generationCounter';
import { useProjectId } from '../store/projectContext';
import { useSubscription } from '../store/subscriptionContext';
import { formatGenerationError } from '../errorMessages';
import { IconSparkles, IconDownload } from '../components/Icons';
import { useT } from '../i18n';

type OutputsHolder = Record<string, unknown> & { outputs?: string[] };

// GPT Image 2's "resolution" options are really quality tiers with translatable names; the
// 1K/2K/4K tiers on the Nano Banana models are unit labels that stay as-is.
const QUALITY_LABEL_KEYS: Record<
  string,
  'qualityAuto' | 'qualityLow' | 'qualityMedium' | 'qualityHigh'
> = {
  auto: 'qualityAuto',
  low: 'qualityLow',
  medium: 'qualityMedium',
  high: 'qualityHigh',
};

export interface ImageGenNodeData extends Record<string, unknown> {
  model: string;
  manualPrompt: string;
  aspectRatio: string;
  resolution: string;
  variantCount: number;
  saveFormat: 'png' | 'jpeg' | 'webp';
  status: 'idle' | 'loading' | 'error' | 'done';
  error?: string;
  outputs: string[];
}

function ImageGenNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const { updateNodeData, getNode } = useReactFlow();
  const nodeData = data as ImageGenNodeData;
  const [saving, setSaving] = useState(false);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const incrementGenerations = useGenerationCounter((s) => s.increment);
  const projectId = useProjectId();
  const subscription = useSubscription();
  const modelMeta = IMAGE_MODEL_META[nodeData.model];

  const handleModelChange = (model: string) => {
    const meta = IMAGE_MODEL_META[model];
    const resolution = meta?.resolutions.some((r) => r.value === nodeData.resolution)
      ? nodeData.resolution
      : (meta?.resolutions[0]?.value ?? '');
    updateNodeData(id, { model, resolution });
  };

  const promptConnections = useNodeConnections({ handleType: 'target', handleId: 'prompt' });
  const sourceId = promptConnections[0]?.source;
  const sourceData = useNodesData(sourceId ?? '');
  const connectedPrompt = sourceId ? ((sourceData?.data as PromptNodeData)?.value ?? '') : '';
  const effectivePrompt = connectedPrompt || nodeData.manualPrompt || '';

  const allTargetConnections = useNodeConnections({ handleType: 'target' });
  const refConnections = allTargetConnections.filter((c) => c.targetHandle?.startsWith('ref-'));
  const refSourceIds = refConnections.map((c) => c.source);
  const refSourcesData = useNodesData(refSourceIds);
  const referenceImages = Array.from({ length: IMAGE_REFERENCE_SLOTS }, (_, i) => {
    const conn = refConnections.find((c) => c.targetHandle === `ref-${i}`);
    if (!conn) return null;
    const dataIndex = refSourceIds.indexOf(conn.source);
    const nodeOutputs = (refSourcesData[dataIndex]?.data as OutputsHolder | undefined)?.outputs;
    return nodeOutputs?.[0] ?? null;
  });
  const connectedRefCount = referenceImages.filter(Boolean).length;

  const handleGenerate = async () => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    if (!effectivePrompt.trim()) {
      updateNodeData(id, { status: 'error', error: t.nodes.common.emptyPromptError });
      return;
    }
    const variantCount = nodeData.variantCount || 1;
    updateNodeData(id, { status: 'loading', error: undefined });
    const outputs: string[] = [];
    try {
      const images = referenceImages.filter((url): url is string => Boolean(url));
      for (let i = 0; i < variantCount; i++) {
        setGenProgress({ done: i, total: variantCount });
        const result = await window.api.generateImage({
          model: nodeData.model,
          prompt: effectivePrompt,
          aspectRatio: nodeData.aspectRatio,
          resolution: nodeData.resolution || undefined,
          images: images.length > 0 ? images : undefined,
          projectId,
          category: 'image',
        });
        outputs.push(...result);
        incrementGenerations();
        updateNodeData(id, { outputs: [...outputs] });
      }
      updateNodeData(id, { status: 'done', outputs });
    } catch (err) {
      updateNodeData(id, { status: 'error', error: formatGenerationError(err), outputs });
    } finally {
      setGenProgress(null);
    }
  };

  const handleSave = async (url: string, index: number) => {
    setSaving(true);
    try {
      const format = nodeData.saveFormat || 'png';
      const dataUrl = await window.api.fetchImageAsDataUrl(url);
      const converted = format === 'png' ? dataUrl : await convertImageFormat(dataUrl, format);
      const suffix = nodeData.outputs.length > 1 ? `-${index + 1}` : '';
      await window.api.saveFile(converted, `image-${id}${suffix}.${format === 'jpeg' ? 'jpg' : format}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node node-image node-resizable">
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={260}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <div className="node-header">
        <IconSparkles /> {t.nodes.imageGen.header}
      </div>
      <div className="node-body">
        <Handle type="target" position={Position.Left} id="prompt" style={{ top: 40 }} />

        <label className="field-label">{t.nodes.common.model}</label>
        <select
          className="node-select nodrag"
          value={nodeData.model}
          onChange={(e) => handleModelChange(e.target.value)}
        >
          {IMAGE_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {modelShortName(
                m.value === 'google/nano-banana-2' ? t.nodes.modelMeta.nanoBanana2Editing : m.label
              )}
            </option>
          ))}
        </select>

        {!sourceId && (
          <>
            <label className="field-label">{t.nodes.common.promptNoConnection}</label>
            <textarea
              className="node-textarea small nodrag"
              placeholder={t.nodes.common.promptPlaceholder}
              value={nodeData.manualPrompt}
              onChange={(e) => updateNodeData(id, { manualPrompt: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </>
        )}
        {sourceId && (
          <div className="connected-hint">
            {t.nodes.common.promptConnected(connectedPrompt || t.nodes.common.promptEmpty)}
          </div>
        )}

        <label className="field-label">{t.nodes.common.aspectRatio}</label>
        <select
          className="node-select nodrag"
          value={nodeData.aspectRatio}
          onChange={(e) => updateNodeData(id, { aspectRatio: e.target.value })}
        >
          {ASPECT_RATIOS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        {modelMeta && (
          <>
            <label className="field-label">{t.nodes.common.resolution}</label>
            <select
              className="node-select nodrag"
              value={nodeData.resolution}
              onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
              disabled={modelMeta.resolutions.length <= 1}
            >
              {modelMeta.resolutions.map((r) => (
                <option key={r.value} value={r.value}>
                  {QUALITY_LABEL_KEYS[r.value]
                    ? t.nodes.modelMeta[QUALITY_LABEL_KEYS[r.value]]
                    : r.label}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="field-label">{t.nodes.imageGen.variantCount}</label>
        <select
          className="node-select nodrag"
          value={nodeData.variantCount || 1}
          onChange={(e) => updateNodeData(id, { variantCount: Number(e.target.value) })}
        >
          {IMAGE_VARIANT_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <label className="field-label">
          {t.nodes.imageGen.referencePhotos(connectedRefCount, IMAGE_REFERENCE_SLOTS)}
        </label>
        <div className="ref-slots">
          {referenceImages.map((url, i) => (
            <div key={i} className="ref-slot-row">
              <Handle
                type="target"
                position={Position.Left}
                id={`ref-${i}`}
                className="ref-slot-handle"
                isValidConnection={(conn) =>
                  ['imageGen', 'imageInput'].includes(getNode(conn.source)?.type ?? '')
                }
                title={t.nodes.imageGen.photoLabel(i + 1)}
              />
              <span className="ref-slot-label">{t.nodes.imageGen.photoLabel(i + 1)}</span>
              {url && <img src={url} alt={t.nodes.imageGen.photoLabel(i + 1)} className="ref-slot-thumb" />}
            </div>
          ))}
        </div>

        <label className="field-label">{t.nodes.imageGen.saveFormat}</label>
        <select
          className="node-select nodrag"
          value={nodeData.saveFormat}
          onChange={(e) => updateNodeData(id, { saveFormat: e.target.value })}
        >
          {IMAGE_SAVE_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={nodeData.status === 'loading'}
        >
          <IconSparkles />{' '}
          {genProgress
            ? t.nodes.imageGen.generatingProgress(genProgress.done + 1, genProgress.total)
            : nodeData.status === 'loading'
              ? t.nodes.common.generating
              : t.nodes.common.generate}
        </button>

        {nodeData.status === 'error' && <div className="error-text">{nodeData.error}</div>}

        {nodeData.status === 'done' && nodeData.outputs?.length > 0 && (
          <div className="preview-area">
            {nodeData.outputs.map((url, i) => (
              <div key={i} className="preview-item">
                <div className="preview-media-wrap">
                  <img src={url} alt="generated" className="preview-image" />
                  <button
                    className="preview-download-btn"
                    disabled={saving}
                    onClick={() => handleSave(url, i)}
                    title={t.nodes.common.save}
                  >
                    <IconDownload size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Handle type="source" position={Position.Right} id="image" />
      </div>
    </div>
  );
}

export default memo(ImageGenNode);
