import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { IconDocument } from '../components/Icons';
import { useT } from '../i18n';

export interface PromptNodeData extends Record<string, unknown> {
  value: string;
}

function PromptNode({ id, data, selected }: NodeProps) {
  const t = useT();
  const { updateNodeData } = useReactFlow();
  const value = (data as PromptNodeData).value ?? '';

  return (
    <div className="node node-prompt node-resizable">
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={140}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <div className="node-header">
        <IconDocument /> {t.nodes.prompt.header}
      </div>
      <div className="node-body">
        <textarea
          className="node-textarea nodrag"
          placeholder={t.nodes.prompt.placeholder}
          value={value}
          onChange={(e) => updateNodeData(id, { value: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <Handle type="source" position={Position.Right} id="text" />
    </div>
  );
}

export default memo(PromptNode);
