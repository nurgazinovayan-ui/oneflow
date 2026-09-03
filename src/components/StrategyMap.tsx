import { useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import { IconTarget, IconRocket, IconGauge } from './Icons';
import type { AudienceSegment, ChannelAllocation, StrategyData } from '../strategyTypes';
import { primaryOffer } from '../strategyTypes';
import { useT, type Translations } from '../i18n';

interface StrategyMapProps {
  data: StrategyData;
  onOpenAudience: (segment: AudienceSegment) => void;
  onOpenChannel: (channel: ChannelAllocation) => void;
  onOpenOffer: () => void;
}

type MapNodeKind = 'audience' | 'offer' | 'positioning' | 'channel';

interface MapNodeData {
  kind: MapNodeKind;
  title: string;
  lines: string[];
  footer?: string;
  onClick?: () => void;
  [key: string]: unknown;
}

const KIND_ICON: Record<MapNodeKind, typeof IconTarget> = {
  audience: IconTarget,
  offer: IconRocket,
  positioning: IconGauge,
  channel: IconTarget,
};

function StrategyMapNodeRenderer({ data }: NodeProps) {
  const d = data as unknown as MapNodeData;
  const Icon = KIND_ICON[d.kind];
  return (
    <button type="button" className={`strategy-map-node strategy-map-node-${d.kind}`} onClick={d.onClick}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="strategy-map-node-header">
        <Icon size={14} />
        <span>{d.title}</span>
      </div>
      <div className="strategy-map-node-lines">
        {d.lines.slice(0, 3).map((line, i) => (
          <div key={i} className="strategy-map-node-line">
            {line}
          </div>
        ))}
      </div>
      {d.footer && <div className="strategy-map-node-footer">{d.footer}</div>}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </button>
  );
}

const mapNodeTypes = { strategyNode: StrategyMapNodeRenderer };

function buildMapNodesEdges(
  t: Translations,
  data: StrategyData,
  onOpenAudience: (s: AudienceSegment) => void,
  onOpenChannel: (c: ChannelAllocation) => void,
  onOpenOffer: () => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: 'audience',
    type: 'strategyNode',
    position: { x: 40, y: 160 },
    data: {
      kind: 'audience',
      title: t.strategy.mapAudienceTitle,
      lines: data.audience.map((a) => a.name),
      footer: `${data.audience.length} ${t.strategy.segmentsUnit}`,
      onClick: () => data.audience[0] && onOpenAudience(data.audience[0]),
    },
  });

  nodes.push({
    id: 'positioning',
    type: 'strategyNode',
    position: { x: 360, y: 20 },
    data: {
      kind: 'positioning',
      title: t.strategy.mapPositioningTitle,
      lines: [data.positioning.primaryStatement],
      onClick: onOpenOffer,
    },
  });

  const offer = primaryOffer(data.offers);
  nodes.push({
    id: 'offer',
    type: 'strategyNode',
    position: { x: 360, y: 220 },
    data: {
      kind: 'offer',
      title: t.strategy.mapOfferTitle,
      lines: [offer?.text ?? ''],
      onClick: onOpenOffer,
    },
  });

  edges.push({ id: 'e-audience-offer', source: 'audience', target: 'offer' });
  edges.push({ id: 'e-positioning-offer', source: 'positioning', target: 'offer' });

  data.channels.forEach((channel, i) => {
    const id = `channel-${channel.id}`;
    nodes.push({
      id,
      type: 'strategyNode',
      position: { x: 680, y: 20 + i * 130 },
      data: {
        kind: 'channel',
        title: channel.name,
        lines: [`${channel.percent}% ${t.strategy.budgetUnit}`],
        onClick: () => onOpenChannel(channel),
      },
    });
    edges.push({ id: `e-offer-${id}`, source: 'offer', target: id });
  });

  return { nodes, edges };
}

// Strategy Map's own <ReactFlow> instance, wrapped in its own <ReactFlowProvider> — App.tsx
// already wraps everything in one ReactFlowProvider for the main Nodes canvas, and two
// sibling <ReactFlow> instances can't safely share a single provider's store (they'd fight
// over the same internal viewport/selection state), so this needs an isolated provider scope.
export default function StrategyMap({ data, onOpenAudience, onOpenChannel, onOpenOffer }: StrategyMapProps) {
  const t = useT();
  const initial = useMemo(
    () => buildMapNodesEdges(t, data, onOpenAudience, onOpenChannel, onOpenOffer),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );
  const [nodes, , onNodesChange] = useNodesState(initial.nodes);
  const [edges, , onEdgesChange] = useEdgesState(initial.edges);

  return (
    <div className="strategy-map-wrap">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={mapNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          colorMode="light"
          nodesConnectable={false}
          className="strategy-map-flow"
        >
          <Background gap={20} className="strategy-map-dotgrid" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
