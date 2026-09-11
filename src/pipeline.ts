// Reads what an upstream node would generate with, without being that node.
//
// "Запустить пайплайн" on a video node runs the image node in front of it and then itself. The
// image node resolves its own prompt and reference photos through React Flow hooks, which only
// work inside that component — so the runner resolves the same inputs imperatively from the
// graph instead, and the two must agree on what a node's inputs are.

import type { Edge, Node } from '@xyflow/react';
import { IMAGE_REFERENCE_SLOTS } from './types';
import type { ImageGenNodeData } from './nodes/ImageGenNode';
import type { PromptNodeData } from './nodes/PromptNode';

export interface ImageGenRequest {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  images?: string[];
}

type OutputsHolder = { outputs?: string[] };

// Mirrors ImageGenNode: a connected prompt node wins over the node's own typed prompt, and
// reference photos are taken in slot order, skipping empty slots.
export function resolveImageGenRequest(
  node: Node,
  edges: Edge[],
  getNode: (id: string) => Node | undefined
): ImageGenRequest {
  const data = node.data as ImageGenNodeData;
  const incoming = edges.filter((e) => e.target === node.id);

  const promptEdge = incoming.find((e) => e.targetHandle === 'prompt');
  const promptNode = promptEdge ? getNode(promptEdge.source) : undefined;
  const connectedPrompt = promptNode ? ((promptNode.data as PromptNodeData)?.value ?? '') : '';

  const images = Array.from({ length: IMAGE_REFERENCE_SLOTS }, (_, i) => {
    const edge = incoming.find((e) => e.targetHandle === `ref-${i}`);
    const source = edge ? getNode(edge.source) : undefined;
    return (source?.data as OutputsHolder | undefined)?.outputs?.[0] ?? null;
  }).filter((url): url is string => Boolean(url));

  return {
    model: data.model,
    prompt: connectedPrompt || data.manualPrompt || '',
    aspectRatio: data.aspectRatio,
    resolution: data.resolution || undefined,
    images: images.length > 0 ? images : undefined,
  };
}

// The video step takes exactly one photo (VideoGenNode reads outputs[0]), so a node set to make
// several variants would silently have all but one thrown away. Checked before anything is
// generated, so a misconfigured run costs nothing.
export function imageGenVariantCount(node: Node): number {
  return (node.data as ImageGenNodeData).variantCount || 1;
}
