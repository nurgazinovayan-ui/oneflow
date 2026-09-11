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
import NodeOptionButtons from '../components/NodeOptionButtons';
import { useGenerationCounter } from '../store/generationCounter';
import { useProjectId } from '../store/projectContext';
import { useSubscription } from '../store/subscriptionContext';
import { formatGenerationError } from '../errorMessages';
import { IconSparkles, IconDownload, IconVideo, IconPlay } from '../components/Icons';
import { imageGenVariantCount, resolveImageGenRequest } from '../pipeline';
import GenerationLoader from '../components/GenerationLoader';
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
  const { updateNodeData, getNode, getEdges } = useReactFlow();
  const nodeData = data as VideoGenNodeData;
  const [saving, setSaving] = useState(false);
  // Pipeline problems are about how the chain is wired, not about a generation that failed, so
  // they live here rather than in the node's own status — flagging one must not wipe the video
  // already sitting in the preview.
  const [pipelineStage, setPipelineStage] = useState<'idle' | 'image' | 'video'>('idle');
  const [pipelineError, setPipelineError] = useState('');
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
  // Only a generated photo has a step to run first — a user's own photo in an imageInput node
  // is already there, so the plain Generate button is the whole chain.
  const canRunPipeline = Boolean(imageSourceId) && getNode(imageSourceId ?? '')?.type === 'imageGen';
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

  // imageOverride is what the pipeline passes: it has just written the photo into the image
  // node, but connectedImage comes from a hook and is still a render behind.
  const runVideo = async (imageOverride?: string): Promise<boolean> => {
    const image = imageOverride || connectedImage;
    if (!effectivePrompt.trim() && !image) {
      updateNodeData(id, { status: 'error', error: t.nodes.videoGen.needPromptOrImageError });
      return false;
    }
    updateNodeData(id, { status: 'loading', error: undefined });
    try {
      // Older saved projects can carry a node from before the duration slider existed — its
      // value would be undefined here, which the server can't forward to OpenRouter as-is.
      const duration = Number.isFinite(nodeData.duration) ? nodeData.duration : (modelMeta.minDuration ?? 5);
      const outputs = await window.api.generateVideo({
        model: nodeData.model,
        prompt: effectivePrompt,
        image: image || undefined,
        aspectRatio: nodeData.aspectRatio,
        duration,
        resolution: nodeData.resolution,
        projectId,
      });
      updateNodeData(id, { status: 'done', outputs });
      incrementGenerations();
      return true;
    } catch (err) {
      updateNodeData(id, { status: 'error', error: formatGenerationError(err) });
      return false;
    }
  };

  const handleGenerate = async () => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    setPipelineError('');
    await runVideo();
  };

  // Generate the photo in the node in front, then the video from that photo, in one click.
  const handleRunPipeline = async () => {
    if (!subscription.active) {
      subscription.requestPayment();
      return;
    }
    const imageNode = imageSourceId ? getNode(imageSourceId) : undefined;
    if (!imageNode) return;

    // Checked before anything is generated: the video step consumes exactly one photo, so a
    // node set to several variants would have all but one silently dropped.
    if (imageGenVariantCount(imageNode) > 1) {
      setPipelineError(t.nodes.videoGen.pipelineOneImageError);
      return;
    }
    const request = resolveImageGenRequest(imageNode, getEdges(), getNode);
    if (!request.prompt.trim()) {
      setPipelineError(t.nodes.videoGen.pipelineImagePromptError);
      return;
    }

    setPipelineError('');
    setPipelineStage('image');
    updateNodeData(imageSourceId!, { status: 'loading', error: undefined });
    let images: string[];
    try {
      images = await window.api.generateImage({ ...request, projectId, category: 'image' });
      updateNodeData(imageSourceId!, { status: 'done', outputs: images });
      incrementGenerations();
    } catch (err) {
      updateNodeData(imageSourceId!, { status: 'error', error: formatGenerationError(err) });
      setPipelineError(t.nodes.videoGen.pipelineImageFailed);
      setPipelineStage('idle');
      return;
    }

    // A single request can still come back with several images; stopping here beats picking one
    // at random after the user has already seen all of them appear.
    if (images.length !== 1) {
      setPipelineError(t.nodes.videoGen.pipelineOneImageError);
      setPipelineStage('idle');
      return;
    }

    setPipelineStage('video');
    await runVideo(images[0]);
    setPipelineStage('idle');
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
          <NodeOptionButtons
            options={ASPECT_RATIOS.map((r) => ({ value: r, label: r }))}
            value={nodeData.aspectRatio}
            onChange={(aspectRatio) => updateNodeData(id, { aspectRatio })}
          />
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
        <NodeOptionButtons
          options={modelMeta.resolutions.map((r) => ({ value: r, label: r }))}
          value={nodeData.resolution}
          onChange={(resolution) => updateNodeData(id, { resolution })}
          disabled={modelMeta.resolutions.length <= 1}
        />

        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={nodeData.status === 'loading' || pipelineStage !== 'idle'}
        >
          <IconSparkles /> {nodeData.status === 'loading' ? t.nodes.common.generating : t.nodes.common.generate}
        </button>

        {canRunPipeline && (
          <button
            className="secondary-btn pipeline-btn"
            onClick={handleRunPipeline}
            title={t.nodes.videoGen.pipelineHint}
            disabled={nodeData.status === 'loading' || pipelineStage !== 'idle'}
          >
            <IconPlay size={13} />
            {pipelineStage === 'image'
              ? t.nodes.videoGen.pipelineImageStage
              : pipelineStage === 'video'
                ? t.nodes.videoGen.pipelineVideoStage
                : t.nodes.videoGen.runPipeline}
          </button>
        )}

        {pipelineError && <div className="error-text">{pipelineError}</div>}

        {nodeData.status === 'error' && <div className="error-text">{nodeData.error}</div>}

        {nodeData.status === 'loading' && (
          <div className="preview-area">
            <GenerationLoader className="preview-loading" />
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

export default memo(VideoGenNode);
