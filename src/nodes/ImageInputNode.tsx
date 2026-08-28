import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { IconFolderOpen, IconImage } from '../components/Icons';
import { useT } from '../i18n';

export interface ImageInputNodeData extends Record<string, unknown> {
  outputs: string[];
  manualUrl: string;
  error?: string;
  // Set only by template-generated schemes (see businessPresets.ts / App.tsx) whose prompt
  // requires a user photo to work at all — a plain "add node" Image node stays unhighlighted
  // even when empty, since an empty image input is a normal, expected state there.
  highlightUntilFilled?: boolean;
}

function ImageInputNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const { updateNodeData } = useReactFlow();
  const nodeData = data as ImageInputNodeData;
  const [loading, setLoading] = useState(false);
  const preview = nodeData.outputs?.[0];
  const needsAttachment = Boolean(nodeData.highlightUntilFilled) && !preview;

  const handlePickFile = async () => {
    setLoading(true);
    try {
      const dataUrl = await window.api.pickImageFile();
      if (dataUrl) {
        updateNodeData(id, { outputs: [dataUrl], manualUrl: '', error: undefined });
      }
    } catch (err) {
      updateNodeData(id, { error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleManualUrlChange = (value: string) => {
    updateNodeData(id, { manualUrl: value, outputs: value.trim() ? [value.trim()] : [], error: undefined });
  };

  return (
    <div className={`node node-input node-resizable ${needsAttachment ? 'node-needs-attachment' : ''}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={220}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      {needsAttachment && <div className="node-attach-hint">{t.nodes.imageInput.attachHint}</div>}
      <div className="node-header">
        <IconImage /> {t.nodes.imageInput.header}
      </div>
      <div className="node-body">
        <button className="secondary-btn" onClick={handlePickFile} disabled={loading}>
          <IconFolderOpen /> {loading ? t.nodes.imageInput.loading : t.nodes.imageInput.loadFromDisk}
        </button>

        <label className="field-label">{t.nodes.imageInput.orUrlLabel}</label>
        <input
          className="node-select nodrag"
          placeholder="https://..."
          value={nodeData.manualUrl}
          onChange={(e) => handleManualUrlChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />

        {nodeData.error && <div className="error-text">{nodeData.error}</div>}

        {preview && (
          <div className="preview-area">
            <img src={preview} alt="input" className="preview-image" />
          </div>
        )}

        <Handle type="source" position={Position.Right} id="image" />
      </div>
    </div>
  );
}

export default memo(ImageInputNode);
