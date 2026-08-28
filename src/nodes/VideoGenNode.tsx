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
import { ASPECT_RATIOS, VIDEO_MODEL_META, VIDEO_MODELS, modelShortName } from '../types';
import type { PromptNodeData } from './PromptNode';
import type { ImageGenNodeData } from './ImageGenNode';
import { useGenerationCounter } from '../store/generationCounter';
import { useProjectId } from '../store/projectContext';
import { useSubscription } from '../store/subscriptionContext';
import { formatGenerationError } from '../errorMessages';
import { IconSparkles, IconDownload, IconVideo } from '../components/Icons';
import { useT } from '../i18n';

export interface VideoGenNodeData extends Record<string, unknown> {
  model: string;
  manualPrompt: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  status: 'idle' | 'loading' | 'error' | 'done';
  error?: string;
  outputs: string[];
}

function VideoGenNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const { updateNodeData, getNode } = useReactFlow();
  const nodeData = data as VideoGenNodeData;
  const [saving, setSaving] = useState(false);
  const incrementGenerations = useGenerationCounter((s) => s.increment);
  const projectId = useProjectId();
  const subscription = useSubscription();
  const modelMeta = VIDEO_MODEL_META[nodeData.model];

  const promptConnections = useNodeConnections({ handleType: 'target', handleId: 'prompt' });
  const promptSourceId = promptConnections[0]?.source;
  const promptSourceData = useNodesData(promptSourceId ?? '');
  const connectedPrompt = promptSourceId
    ? ((promptSourceData?.data as PromptNodeData)?.value ?? '')
    : '';
  const effectivePrompt = connectedPrompt || nodeData.manualPrompt || '';

  const imageConnections = useNodeConnections({ handleType: 'target', handleId: 'image' });
  const imageSourceId = imageConnections[0]?.source;
  const imageSourceData = useNodesData(imageSourceId ?? '');
  const connectedImage = imageSourceId
    ? ((imageSourceData?.data as ImageGenNodeData)?.outputs?.[0] ?? '')
    : '';
  const isImageToVideo = Boolean(connectedImage);

  const handleModelChange = (model: string) => {
    const meta = VIDEO_MODEL_META[model];
    const duration = Math.min(Math.max(nodeData.duration, meta.minDuration ?? 1), meta.maxDuration);
    const resolution = meta.resolutions.includes(nodeData.resolution)
      ? nodeData.resolution
      : meta.resolutions[0];
    updateNodeData(id, { model, duration, resolution });
  };

  const handleGenerate = async () => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    if (!effectivePrompt.trim() && !connectedImage) {
      updateNodeData(id, { status: 'error', error: t.nodes.videoGen.needPromptOrImageError });
      return;
    }
    updateNodeData(id, { status: 'loading', error: undefined });
    try {
      const outputs = await window.api.generateVideo({
        model: nodeData.model,
        prompt: effectivePrompt,
        image: connectedImage || undefined,
        aspectRatio: nodeData.aspectRatio,
        duration: nodeData.duration,
        resolution: nodeData.resolution,
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
      await window.api.saveFile(url, `video-${id}.mp4`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node node-video node-resizable">
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={260}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <div className="node-header">
        <IconVideo /> {t.nodes.videoGen.header}
      </div>
      <div className="node-body">
        <Handle
          type="target"
          position={Position.Left}
          id="prompt"
          style={{ top: 34 }}
          title={t.nodes.videoGen.promptHandleTitle}
          isValidConnection={(conn) => getNode(conn.source)?.type === 'prompt'}
        />
        <Handle
          type="target"
          position={Position.Left}
          id="image"
          style={{ top: 96 }}
          title={t.nodes.common.photoHandleTitle}
          isValidConnection={(conn) =>
            ['imageGen', 'imageInput'].includes(getNode(conn.source)?.type ?? '')
          }
        />

        <label className="field-label">{t.nodes.common.model}</label>
        <select
          className="node-select nodrag"
          value={nodeData.model}
          onChange={(e) => handleModelChange(e.target.value)}
        >
          {VIDEO_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {modelShortName(m.label)}
            </option>
          ))}
        </select>

        {!promptSourceId && (
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
        {promptSourceId && (
          <div className="connected-hint">
            {t.nodes.common.promptConnected(connectedPrompt || t.nodes.common.promptEmpty)}
          </div>
        )}
        <div className="connected-hint">
          {t.nodes.videoGen.imageStatus(
            imageSourceId
              ? connectedImage
                ? t.nodes.common.connected
                : t.nodes.common.awaitingGeneration
              : t.nodes.common.notConnected
          )}
        </div>

        <label className="field-label">{t.nodes.common.aspectRatio}</label>
        {isImageToVideo ? (
          <div className="connected-hint">{t.nodes.videoGen.aspectDeterminedByImage}</div>
        ) : (
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
        )}

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
          disabled={modelMeta.resolutions.length <= 1}
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

export default memo(VideoGenNode);
