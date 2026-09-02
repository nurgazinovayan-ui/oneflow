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
import { ASPECT_RATIOS } from '../types';
import type { PromptNodeData } from './PromptNode';
import { useGenerationCounter } from '../store/generationCounter';
import { useProjectId } from '../store/projectContext';
import { useSubscription } from '../store/subscriptionContext';
import { formatGenerationError } from '../errorMessages';
import { IconVector, IconDownload } from '../components/Icons';
import LottieLoader from '../components/LottieLoader';
import { useT } from '../i18n';

export interface VectorGenNodeData extends Record<string, unknown> {
  manualPrompt: string;
  aspectRatio: string;
  status: 'idle' | 'loading' | 'error' | 'done';
  error?: string;
  outputs: string[];
}

function VectorGenNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const { updateNodeData } = useReactFlow();
  const nodeData = data as VectorGenNodeData;
  const [saving, setSaving] = useState(false);
  const incrementGenerations = useGenerationCounter((s) => s.increment);
  const projectId = useProjectId();
  const subscription = useSubscription();

  const promptConnections = useNodeConnections({ handleType: 'target', handleId: 'prompt' });
  const sourceId = promptConnections[0]?.source;
  const sourceData = useNodesData(sourceId ?? '');
  const connectedPrompt = sourceId ? ((sourceData?.data as PromptNodeData)?.value ?? '') : '';
  const effectivePrompt = connectedPrompt || nodeData.manualPrompt || '';

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
      const outputs = await window.api.generateVector({
        prompt: effectivePrompt,
        aspectRatio: nodeData.aspectRatio,
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
      await window.api.saveFile(url, `vector-${id}.svg`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node node-vector node-resizable">
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={220}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <div className="node-header">
        <IconVector /> {t.nodes.vector.header}
      </div>
      <div className="node-body">
        <Handle type="target" position={Position.Left} id="prompt" style={{ top: 40 }} />

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

        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={nodeData.status === 'loading'}
        >
          <IconVector /> {nodeData.status === 'loading' ? t.nodes.common.generating : t.nodes.common.generate}
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
                  <img src={url} alt="generated vector" className="preview-image" />
                  <button
                    className="preview-download-btn"
                    disabled={saving}
                    onClick={() => handleSave(url)}
                    title={t.nodes.vector.saveSvg}
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

export default memo(VectorGenNode);
