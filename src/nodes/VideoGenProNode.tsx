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
  VIDEO_MODEL_META,
  VIDEO_PRO_MODEL,
  VIDEO_PRO_REFERENCE_LIMITS,
} from '../types';
import type { PromptNodeData } from './PromptNode';
import { useGenerationCounter } from '../store/generationCounter';
import { useProjectId } from '../store/projectContext';
import { useSubscription } from '../store/subscriptionContext';
import { formatGenerationError } from '../errorMessages';
import { IconSparkles, IconDownload, IconVideo, IconPlus } from '../components/Icons';
import LottieLoader from '../components/LottieLoader';
import { useT, type Translations } from '../i18n';

export interface VideoGenProNodeData extends Record<string, unknown> {
  manualPrompt: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  referenceImages: string[];
  referenceVideos: string[];
  referenceAudios: string[];
  status: 'idle' | 'loading' | 'error' | 'done';
  error?: string;
  outputs: string[];
}

const modelMeta = VIDEO_MODEL_META[VIDEO_PRO_MODEL];

type RefKind = 'referenceImages' | 'referenceVideos' | 'referenceAudios';

function buildRefSections(
  t: Translations
): { key: RefKind; label: string; tag: string; limit: number }[] {
  return [
    { key: 'referenceImages', label: t.nodes.videoGenPro.refImages, tag: 'Image', limit: VIDEO_PRO_REFERENCE_LIMITS.images },
    { key: 'referenceVideos', label: t.nodes.videoGenPro.refVideos, tag: 'Video', limit: VIDEO_PRO_REFERENCE_LIMITS.videos },
    { key: 'referenceAudios', label: t.nodes.videoGenPro.refAudios, tag: 'Audio', limit: VIDEO_PRO_REFERENCE_LIMITS.audios },
  ];
}

function VideoGenProNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const REF_SECTIONS = buildRefSections(t);
  const { updateNodeData } = useReactFlow();
  const nodeData = data as VideoGenProNodeData;
  const [saving, setSaving] = useState(false);
  const [pickingKind, setPickingKind] = useState<RefKind | null>(null);
  const incrementGenerations = useGenerationCounter((s) => s.increment);
  const projectId = useProjectId();
  const subscription = useSubscription();

  const promptConnections = useNodeConnections({ handleType: 'target', handleId: 'prompt' });
  const promptSourceId = promptConnections[0]?.source;
  const promptSourceData = useNodesData(promptSourceId ?? '');
  const connectedPrompt = promptSourceId
    ? ((promptSourceData?.data as PromptNodeData)?.value ?? '')
    : '';
  const effectivePrompt = connectedPrompt || nodeData.manualPrompt || '';

  const insertTag = async (tag: string) => {
    if (promptSourceId) {
      await navigator.clipboard.writeText(tag);
      return;
    }
    const current = nodeData.manualPrompt || '';
    updateNodeData(id, { manualPrompt: current ? `${current} ${tag}` : tag });
  };

  const addReference = async (kind: RefKind) => {
    setPickingKind(kind);
    try {
      const dataUrl =
        kind === 'referenceImages'
          ? await window.api.pickImageFile()
          : await window.api.pickMediaFile(kind === 'referenceVideos' ? 'video' : 'audio');
      if (dataUrl) {
        updateNodeData(id, { [kind]: [...nodeData[kind], dataUrl] });
      }
    } finally {
      setPickingKind(null);
    }
  };

  const removeReference = (kind: RefKind, index: number) => {
    updateNodeData(id, { [kind]: nodeData[kind].filter((_, i) => i !== index) });
  };

  const handleGenerate = async () => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    if (!effectivePrompt.trim()) {
      updateNodeData(id, { status: 'error', error: t.nodes.common.emptyPromptError });
      return;
    }
    updateNodeData(id, { status: 'loading', error: undefined });
    try {
      const outputs = await window.api.generateVideoPro({
        prompt: effectivePrompt,
        aspectRatio: nodeData.aspectRatio,
        duration: nodeData.duration,
        resolution: nodeData.resolution,
        images: nodeData.referenceImages.length ? nodeData.referenceImages : undefined,
        videos: nodeData.referenceVideos.length ? nodeData.referenceVideos : undefined,
        audios: nodeData.referenceAudios.length ? nodeData.referenceAudios : undefined,
        projectId,
      });
      updateNodeData(id, { status: 'done', outputs });
      incrementGenerations();
    } catch (err) {
      updateNodeData(id, { status: 'error', error: formatGenerationError(err) });
    }
  };

  const handleSave = async (url: string) => {
    setSaving(true);
    try {
      await window.api.saveFile(url, `video-pro-${id}.mp4`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node node-video-pro node-resizable">
      <NodeResizer
        isVisible={selected}
        minWidth={300}
        minHeight={300}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <div className="node-header">
        <IconVideo /> {t.nodes.videoGenPro.header}
      </div>
      <div className="node-body">
        <Handle
          type="target"
          position={Position.Left}
          id="prompt"
          style={{ top: 34 }}
          title={t.nodes.videoGen.promptHandleTitle}
        />

        <div className="connected-hint">{t.nodes.videoGenPro.modelLabel}</div>

        {!promptSourceId && (
          <>
            <label className="field-label">{t.nodes.common.promptNoConnection}</label>
            <textarea
              className="node-textarea small nodrag"
              placeholder={t.nodes.videoGenPro.promptPlaceholder}
              value={nodeData.manualPrompt}
              onChange={(e) => updateNodeData(id, { manualPrompt: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </>
        )}
        {promptSourceId && (
          <div className="connected-hint">
            {t.nodes.common.promptConnected(connectedPrompt || t.nodes.common.promptEmpty)}
          </div>
        )}

        {REF_SECTIONS.map((section) => (
          <div key={section.key} className="ref-media-section">
            <div className="ref-media-header">
              <label className="field-label">
                {section.label} ({nodeData[section.key].length}/{section.limit})
              </label>
              <button
                className="ref-media-add-btn"
                onClick={() => addReference(section.key)}
                disabled={
                  pickingKind === section.key || nodeData[section.key].length >= section.limit
                }
                title={t.nodes.videoGenPro.addRefTooltip(section.label)}
              >
                <IconPlus size={12} />
              </button>
            </div>
            {nodeData[section.key].length > 0 && (
              <div className="ref-media-list">
                {nodeData[section.key].map((url, i) => (
                  <div key={i} className="ref-media-item">
                    <button
                      className="ref-media-tag"
                      onClick={() => insertTag(`@${section.tag}${i + 1}`)}
                      title={
                        promptSourceId
                          ? t.nodes.videoGenPro.copyTagTooltip
                          : t.nodes.videoGenPro.insertTagTooltip
                      }
                    >
                      @{section.tag}
                      {i + 1}
                    </button>
                    <button
                      className="ref-media-remove-btn"
                      onClick={() => removeReference(section.key, i)}
                      title={t.nodes.common.remove}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

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

        <label className="field-label">
          {t.nodes.videoGen.duration(nodeData.duration, modelMeta.minDuration ?? 1, modelMeta.maxDuration)}
        </label>
        <input
          type="range"
          className="duration-slider nodrag"
          min={modelMeta.minDuration ?? 1}
          max={modelMeta.maxDuration}
          step={1}
          value={nodeData.duration}
          onChange={(e) => updateNodeData(id, { duration: Number(e.target.value) })}
          onKeyDown={(e) => e.stopPropagation()}
        />

        <label className="field-label">{t.nodes.common.resolution}</label>
        <select
          className="node-select nodrag"
          value={nodeData.resolution}
          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
        >
          {modelMeta.resolutions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={nodeData.status === 'loading'}
        >
          <IconSparkles /> {nodeData.status === 'loading' ? t.nodes.common.generating : t.nodes.common.generate}
        </button>

        {nodeData.status === 'error' && <div className="error-text">{nodeData.error}</div>}

        {nodeData.status === 'loading' && (
          <div className="preview-area">
            <LottieLoader path="/lottie/generating.json" className="preview-loading" />
          </div>
        )}

        {nodeData.status === 'done' && nodeData.outputs?.length > 0 && (
          <div className="preview-area">
            {nodeData.outputs.map((url) => (
              <div key={url} className="preview-item">
                <div className="preview-media-wrap">
                  <video src={url} controls className="preview-video" />
                  <button
                    className="preview-download-btn"
                    disabled={saving}
                    onClick={() => handleSave(url)}
                    title={t.nodes.common.save}
                  >
                    <IconDownload size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Handle type="source" position={Position.Right} id="video" />
      </div>
    </div>
  );
}

export default memo(VideoGenProNode);
