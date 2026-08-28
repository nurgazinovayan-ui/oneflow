// Parses the optional ```oneflow-actions fenced JSON block the AI assistant can emit at the
// end of a reply (see ASSISTANT_SYSTEM_PROMPT in electron/main.ts for the schema it's taught)
// so the assistant can build node chains on the canvas on request.

import { ASPECT_RATIOS, IMAGE_MODELS, VIDEO_MODELS } from './types';

export type AssistantNodeType = 'prompt' | 'imageGen' | 'videoGen' | 'adapt' | 'imageInput';

export interface AssistantAddNodeAction {
  type: 'addNode';
  refId: string;
  nodeType: AssistantNodeType;
  data?: Record<string, unknown>;
}

export interface AssistantConnectAction {
  type: 'connect';
  from: string;
  to: string;
  targetHandle?: string;
}

export type AssistantAction = AssistantAddNodeAction | AssistantConnectAction;

const ACTIONS_BLOCK_RE = /```oneflow-actions\s*([\s\S]*?)```/i;

const VALID_NODE_TYPES: AssistantNodeType[] = [
  'prompt',
  'imageGen',
  'videoGen',
  'adapt',
  'imageInput',
];

function isAddNodeAction(value: unknown): value is AssistantAddNodeAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'addNode' &&
    typeof v.refId === 'string' &&
    typeof v.nodeType === 'string' &&
    VALID_NODE_TYPES.includes(v.nodeType as AssistantNodeType) &&
    (v.data === undefined || (typeof v.data === 'object' && v.data !== null))
  );
}

const IMAGE_MODEL_VALUES = new Set<string>(IMAGE_MODELS.map((m) => m.value));
const VIDEO_MODEL_VALUES = new Set<string>(VIDEO_MODELS.map((m) => m.value));
const ASPECT_RATIO_VALUES = new Set<string>(ASPECT_RATIOS);

interface FieldSpec {
  key: string;
  validate: (v: unknown) => boolean;
}

const isNonEmptyString = (v: unknown) => typeof v === 'string';

// Only these fields, with these exact types, may come from the LLM — anything else (in
// particular status/outputs/results/formats, which node components assume are always
// well-formed) must only ever come from buildDefaultNodeData, never from assistant JSON.
const FIELD_SPECS: Record<AssistantNodeType, FieldSpec[]> = {
  prompt: [{ key: 'value', validate: isNonEmptyString }],
  imageGen: [
    { key: 'model', validate: (v) => typeof v === 'string' && IMAGE_MODEL_VALUES.has(v) },
    { key: 'manualPrompt', validate: isNonEmptyString },
    { key: 'aspectRatio', validate: (v) => typeof v === 'string' && ASPECT_RATIO_VALUES.has(v) },
  ],
  videoGen: [
    { key: 'model', validate: (v) => typeof v === 'string' && VIDEO_MODEL_VALUES.has(v) },
    { key: 'manualPrompt', validate: isNonEmptyString },
    { key: 'aspectRatio', validate: (v) => typeof v === 'string' && ASPECT_RATIO_VALUES.has(v) },
    { key: 'duration', validate: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 },
    { key: 'resolution', validate: isNonEmptyString },
  ],
  adapt: [{ key: 'note', validate: isNonEmptyString }],
  imageInput: [{ key: 'manualUrl', validate: isNonEmptyString }],
};

export function sanitizeNodeData(
  nodeType: AssistantNodeType,
  data: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!data) return {};
  const result: Record<string, unknown> = {};
  for (const spec of FIELD_SPECS[nodeType]) {
    const value = data[spec.key];
    if (value !== undefined && spec.validate(value)) {
      result[spec.key] = value;
    }
  }
  return result;
}

function isConnectAction(value: unknown): value is AssistantConnectAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'connect' &&
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    (v.targetHandle === undefined || typeof v.targetHandle === 'string')
  );
}

export interface ParsedAssistantReply {
  cleanedText: string;
  actions: AssistantAction[] | null;
}

export function parseAssistantReply(text: string): ParsedAssistantReply {
  const match = ACTIONS_BLOCK_RE.exec(text);
  if (!match) return { cleanedText: text, actions: null };

  const cleanedText = text.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1]) as { actions?: unknown };
    if (!Array.isArray(parsed.actions)) return { cleanedText, actions: null };
    const actions = parsed.actions
      .filter((a): a is AssistantAction => isAddNodeAction(a) || isConnectAction(a))
      .map((a) =>
        a.type === 'addNode' ? { ...a, data: sanitizeNodeData(a.nodeType, a.data) } : a
      );
    return { cleanedText, actions: actions.length > 0 ? actions : null };
  } catch {
    return { cleanedText, actions: null };
  }
}
