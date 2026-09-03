// AI prompt + response parsing for the "Стратегия" mode (see StrategyPanel.tsx). One
// generateChat call does the whole analysis — there's no dedicated backend function for this,
// same "orchestrate an existing API call with a carefully-shaped prompt" approach OneLaunchPanel
// uses for its own AI steps. The AI is only ever asked for hypotheses (component scores, copy,
// CPC ranges as ranges); every number that must be trustworthy (overall score, funnel volumes,
// forecast) is computed client-side in strategyCompute.ts from what the AI returns here.

import { parseSuggestions } from './chatSuggestions';
import { genId } from './strategyCompute';
import {
  STRATEGY_GOAL_LABELS,
  primaryOffer,
  type AudienceSegment,
  type Offer,
  type StrategyAction,
  type StrategyActionType,
  type StrategyBrief,
  type StrategyData,
} from './strategyTypes';

export function buildStrategyPrompt(brief: StrategyBrief): string {
  const goalLabel = STRATEGY_GOAL_LABELS[brief.goal].ru;
  const photoLine = brief.photo
    ? 'К сообщению приложено фото товара/продукта — проанализируй его и используй как основной источник понимания продукта.'
    : '';
  const optionalLines = [
    brief.websiteUrl ? `— Сайт: ${brief.websiteUrl}` : '',
    brief.competitors ? `— Известные конкуренты: ${brief.competitors}` : '',
    brief.knownAudience ? `— Уже известная аудитория: ${brief.knownAudience}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    `Ты — AI Marketing Strategist. На основе брифа ниже построй полную маркетинговую стратегию и ` +
    `верни её СТРОГО как валидный JSON без markdown-разметки, без пояснений до или после. Если ` +
    `данных недостаточно для точного числа — дай реалистичную гипотезу, а не выдумывай ложную точность.\n\n` +
    `Бриф:\n` +
    `— Цель: ${goalLabel}\n` +
    `— Рынок: ${brief.market}\n` +
    `— Срок: ${brief.durationMonths} мес.\n` +
    `— Бюджет: ${brief.budget} ${brief.currency}\n` +
    `— Описание продукта/бизнеса: ${brief.productDescription}\n` +
    `${optionalLines}\n` +
    `${photoLine}\n\n` +
    `Верни JSON строго по такой схеме (без лишних полей, все текстовые поля на русском языке, ` +
    `конкретно под этот продукт и рынок, без общих фраз):\n` +
    `{\n` +
    `  "title": "короткое название стратегии, 2-4 слова",\n` +
    `  "goalSummary": "1 предложение — измеримая цель, например 'Увеличить платные конверсии на 25% за 3 месяца'",\n` +
    `  "positioning": {\n` +
    `    "primaryStatement": "1-2 предложения основного позиционирования",\n` +
    `    "valueProposition": "1 предложение ценностного предложения",\n` +
    `    "reasonsToBelieve": ["причина верить 1", "причина верить 2"],\n` +
    `    "differentiators": ["отличие 1", "отличие 2"],\n` +
    `    "tone": "например: уверенный, экспертный",\n` +
    `    "alternatives": [{"label": "Рациональный|Эмоциональный|Технологичный", "statement": "1-2 предложения"}] (2-3 шт.),\n` +
    `    "confidence": 0-100\n` +
    `  },\n` +
    `  "offers": [{"text": "1-2 предложения — суть оффера", "angle": "короткий угол подачи", ` +
    `"targetSegmentName": "имя сегмента из audience", "funnelStage": "awareness|consideration|conversion", ` +
    `"score": 0-100, "isPrimary": true|false}] (3-5 офферов, ровно один isPrimary: true),\n` +
    `  "scoreBreakdown": {"audience": 0-100, "positioning": 0-100, "offer": 0-100, "channels": 0-100, ` +
    `"content": 0-100, "funnel": 0-100, "retention": 0-100, "measurement": 0-100},\n` +
    `  "audience": [{"name": "название сегмента", "potential": "High|Medium|Low", ` +
    `"description": "1 предложение", "mainJob": "главная задача / JTBD", "painPoints": ["боль 1", "боль 2"], ` +
    `"purchaseTriggers": ["триггер 1", "триггер 2"], "objections": ["возражение 1"], ` +
    `"recommendedMessage": "1 предложение", "confidence": 0-100}] (2-5 сегментов),\n` +
    `  "competitors": ["конкурент 1", "конкурент 2"] (0-3, только если есть реальные основания, иначе []),\n` +
    `  "channels": [{"name": "название канала", "percent": 0-100, "rationale": "1 предложение почему этот канал", ` +
    `"confidence": 0-100, "cpcRange": {"min": число, "max": число} (только если можешь дать реалистичный диапазон ` +
    `CPC в валюте ${brief.currency}, иначе не включай поле)}] (3-5 каналов, сумма percent = 100, ` +
    `распредели бюджет ${brief.budget} ${brief.currency} по проценту),\n` +
    `  "contentMatrix": [{"format": "название формата контента", "stages": ["awareness","consideration","conversion"] ` +
    `(подмножество), "audienceName": "имя сегмента из audience", "objective": "1 предложение цель", ` +
    `"hook": "1 предложение хук", "message": "1 предложение сообщение", "cta": "короткий CTA", ` +
    `"recommendedAssets": ["video","image","copy"] (подмножество), "priority": "high|medium|low"}] (4-6 форматов),\n` +
    `  "funnel": [{"label": "название стадии", "volume": число, "conversionToNext": 0-100}] ` +
    `(4 стадии воронки от охвата до покупок/целевого действия, реалистичные числа под бюджет и ` +
    `рынок, у последней стадии conversionToNext не указывай),\n` +
    `  "journey": [{"stage": "discover|interest|research|try|buy|return", "customerThought": "мысль клиента", ` +
    `"message": "1 предложение", "channel": "канал", "content": "формат контента", "cta": "CTA"}] ` +
    `(ровно 6 объектов, по одному на каждый stage в этом порядке),\n` +
    `  "kpis": [{"label": "название метрики", "target": "целевое значение", "unit": "единица"}] (2-4 шт.),\n` +
    `  "risks": [{"title": "короткий заголовок", "description": "1 предложение", "evidence": "почему AI так считает", ` +
    `"affectedEntities": ["Channels", "Retention"]}] (2-3 штуки),\n` +
    `  "opportunities": [{"title": "короткий заголовок", "description": "1 предложение", "evidence": "почему", ` +
    `"affectedEntities": ["Channels"]}] (2-3 штуки),\n` +
    `  "plan": [{"day": "ПН 03", "title": "конкретная задача на день", "tag": "стадия воронки · сегмент аудитории", ` +
    `"type": "generate|score|compare|manual|review"}] (5-7 задач на первую неделю),\n` +
    `  "topInsight": {"title": "короткий заголовок главной рекомендации", "description": "1-2 предложения, что и ` +
    `почему стоит сделать в первую очередь"},\n` +
    `  "assumptions": [{"field": "что это за допущение", "value": "значение", "confidenceLabel": "например: гипотеза AI"}] (0-3 шт.)\n` +
    `}`
  );
}

// Same defensive extraction evaluate-creative's Edge Function uses server-side (find the first
// "{" and the last "}"), applied client-side here since this call goes through the general
// generate-chat function (mode 'text'), whose system prompt may append its own
// ```oneflow-suggestions fenced block after the JSON — parseSuggestions strips that first.
function extractJson(raw: string): unknown {
  const { cleanedText } = parseSuggestions(raw);
  const start = cleanedText.indexOf('{');
  const end = cleanedText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI response had no JSON object');
  }
  return JSON.parse(cleanedText.slice(start, end + 1));
}

// The AI returns a loosely-typed shape (names instead of ids, optional fields). This assigns
// client-side ids, resolves name references, and fills in the bookkeeping fields (status,
// history, done) that only make sense once the strategy actually exists in app state — schema
// validation in the spec's sense (§15: "проходит валидацию перед записью в Strategy").
export function parseStrategyResponse(raw: string): StrategyData {
  const parsed = extractJson(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  const audience: AudienceSegment[] = (parsed.audience ?? []).map((a: any) => ({
    id: genId('aud'),
    name: a.name ?? '',
    potential: a.potential ?? 'Medium',
    description: a.description ?? '',
    mainJob: a.mainJob ?? '',
    painPoints: a.painPoints ?? [],
    purchaseTriggers: a.purchaseTriggers ?? [],
    objections: a.objections ?? [],
    recommendedMessage: a.recommendedMessage ?? '',
    confidence: a.confidence ?? 60,
    sourceType: 'ai_assumption',
  }));
  const findAudienceId = (name: string | undefined) => audience.find((a) => a.name === name)?.id;

  const offersRaw = parsed.offers ?? [];
  const hasPrimary = offersRaw.some((o: any) => o.isPrimary);
  const offers = offersRaw.map((o: any, i: number) => ({
    id: genId('off'),
    text: o.text ?? '',
    angle: o.angle ?? '',
    targetSegmentId: findAudienceId(o.targetSegmentName),
    funnelStage: o.funnelStage ?? 'conversion',
    score: o.score ?? 70,
    isPrimary: hasPrimary ? !!o.isPrimary : i === 0,
  }));

  const channels = (parsed.channels ?? []).map((c: any) => ({
    id: genId('ch'),
    name: c.name ?? '',
    percent: c.percent ?? 0,
    rationale: c.rationale ?? '',
    confidence: c.confidence ?? 60,
    cpcRange: c.cpcRange && c.cpcRange.min > 0 ? { min: c.cpcRange.min, max: c.cpcRange.max } : undefined,
  }));

  const contentMatrix = (parsed.contentMatrix ?? []).map((row: any) => ({
    id: genId('cm'),
    format: row.format ?? '',
    stages: row.stages ?? [],
    audienceId: findAudienceId(row.audienceName),
    objective: row.objective ?? '',
    hook: row.hook ?? '',
    message: row.message ?? '',
    cta: row.cta ?? '',
    recommendedAssets: row.recommendedAssets ?? [],
    priority: row.priority ?? 'medium',
    status: 'planned' as const,
    scoredCount: 0,
  }));

  const funnel = (parsed.funnel ?? []).map((s: any) => ({
    id: genId('fun'),
    label: s.label ?? '',
    volume: s.volume ?? 0,
    conversionToNext: s.conversionToNext,
    assumptionSource: 'ai_assumption' as const,
    confidence: 60,
  }));

  const toInsight = (i: any) => ({
    id: genId('ins'),
    title: i.title ?? '',
    description: i.description ?? '',
    evidence: i.evidence ?? '',
    affectedEntities: i.affectedEntities ?? [],
    status: 'active' as const,
  });

  const plan = (parsed.plan ?? []).map((p: any) => ({
    id: genId('task'),
    day: p.day ?? '',
    title: p.title ?? '',
    tag: p.tag ?? '',
    type: p.type ?? 'generate',
    done: false,
  }));

  const positioning = {
    primaryStatement: parsed.positioning?.primaryStatement ?? '',
    valueProposition: parsed.positioning?.valueProposition ?? '',
    reasonsToBelieve: parsed.positioning?.reasonsToBelieve ?? [],
    differentiators: parsed.positioning?.differentiators ?? [],
    tone: parsed.positioning?.tone ?? '',
    alternatives: (parsed.positioning?.alternatives ?? []).map((a: any) => ({
      id: genId('pos'),
      label: a.label ?? '',
      statement: a.statement ?? '',
    })),
    confidence: parsed.positioning?.confidence ?? 60,
  };

  return {
    title: parsed.title ?? '',
    goalSummary: parsed.goalSummary ?? '',
    positioning,
    offers,
    scoreBreakdown: {
      audience: 60,
      positioning: 60,
      offer: 60,
      channels: 60,
      content: 60,
      funnel: 60,
      retention: 60,
      measurement: 60,
      ...parsed.scoreBreakdown,
    },
    audience,
    competitors: parsed.competitors ?? [],
    channels,
    contentMatrix,
    funnel,
    journey: parsed.journey ?? [],
    kpis: (parsed.kpis ?? []).map((k: any) => ({ id: genId('kpi'), ...k })),
    risks: (parsed.risks ?? []).map(toInsight),
    opportunities: (parsed.opportunities ?? []).map(toInsight),
    plan,
    topInsight: parsed.topInsight ?? { title: '', description: '' },
    assumptions: (parsed.assumptions ?? []).map((a: any) => ({ id: genId('assum'), ...a })),
    history: [{ id: genId('hist'), timestamp: Date.now(), type: 'generate', description: 'Стратегия создана' }],
  };
}

// Feeds "Create from Strategy" (spec section 52) — the prompt that ends up on the imageGen
// node created by App.tsx's handleCreateFromStrategy (which reuses buildBusinessPresetNodesEdges,
// same Prompt→Image-input→Image-gen chain shape as the "Для бизнеса" tiles). Untranslated
// English on purpose, same convention as businessPresets.ts — this text goes straight to the
// image model, never shown as UI copy.
export function buildStrategyWorkflowPrompt(
  data: StrategyData,
  audienceName: string | undefined,
  format: string
): string {
  const segment = data.audience.find((a) => a.name === audienceName);
  const audienceLine = segment
    ? `Target audience: ${segment.name} — ${segment.description}`
    : 'Target audience: as described below.';
  const offer = primaryOffer(data.offers);
  return (
    `Transform the uploaded product photo into a premium "${format}" marketing creative. ` +
    `${audienceLine}\n` +
    `Positioning: ${data.positioning.primaryStatement}\n` +
    `Offer: ${offer?.text ?? ''}\n\n` +
    `Preserve the exact product shown in the reference photo. Professional studio lighting, ` +
    `clean composition, photorealistic, high resolution. No text, no logos, no watermarks — ` +
    `pure photography only.`
  );
}

export function buildStrategyChatSystemContext(data: StrategyData, brief: StrategyBrief): string {
  return (
    `Контекст текущей маркетинговой стратегии (JSON): ${JSON.stringify({ brief, data })}\n\n` +
    `Отвечай на вопросы пользователя об этой стратегии кратко и по делу, на русском языке, ` +
    `опираясь на приведённые данные.`
  );
}

const ACTION_TYPES: StrategyActionType[] = [
  'reallocate_budget',
  'set_primary_positioning',
  'set_primary_offer',
  'update_funnel_rate',
  'apply_risk',
  'apply_opportunity',
  'dismiss_insight',
];

// Structured-action contract per spec §20. The Assistant either explains (plain text) or
// proposes a change (ONLY as this exact JSON shape, referencing real ids from the current
// strategy) — free text is never parsed into a mutation.
export function buildAssistantActionSystemPrompt(data: StrategyData, brief: StrategyBrief): string {
  const channelIds = data.channels.map((c) => `${c.id} (${c.name})`).join(', ');
  const offerIds = data.offers.map((o) => `${o.id} (${o.text.slice(0, 30)}...)`).join(', ');
  const positioningAltIds = data.positioning.alternatives.map((a) => `${a.id} (${a.label})`).join(', ');
  const funnelIds = data.funnel.map((s) => `${s.id} (${s.label})`).join(', ');
  return (
    `${buildStrategyChatSystemContext(data, brief)}\n\n` +
    `Доступные id для действий:\n` +
    `— каналы: ${channelIds}\n` +
    `— офферы: ${offerIds}\n` +
    `— варианты позиционирования: ${positioningAltIds || 'нет альтернатив'}\n` +
    `— стадии воронки: ${funnelIds}\n\n` +
    `Если запрос пользователя явно предполагает ИЗМЕНЕНИЕ стратегии (перераспределить бюджет, ` +
    `сменить позиционирование/оффер, изменить конверсию воронки) — ответь ТОЛЬКО валидным JSON ` +
    `без markdown, строго такой формы (используй только реальные id из списков выше):\n` +
    `{"type": "${ACTION_TYPES.join('|')}", "rationale": "1 предложение почему", ` +
    `"channelChanges": [{"channelId": "...", "allocation": 0-100}], "positioningAlternativeId": "...", ` +
    `"offerId": "...", "funnelStageId": "...", "newRate": 0-100}\n` +
    `(включай только поля, релевантные выбранному type). Если пользователь просто спрашивает или ` +
    `просит объяснение — отвечай обычным текстом на русском языке, без JSON.`
  );
}

// Offer Engine "Generate alternatives" action (spec §8) — asks for 3 fresh offers distinct from
// the ones already on the strategy, so re-running it doesn't just repeat the same angle.
export function buildOfferAlternativesPrompt(data: StrategyData, brief: StrategyBrief): string {
  const existing = data.offers.map((o) => `— ${o.text} (угол: ${o.angle})`).join('\n');
  return (
    `${buildStrategyChatSystemContext(data, brief)}\n\n` +
    `Предложи 3 новых оффера для этой стратегии, СУЩЕСТВЕННО отличающихся по углу подачи от уже ` +
    `существующих:\n${existing}\n\n` +
    `Верни СТРОГО валидный JSON без markdown:\n` +
    `{"offers": [{"text": "1-2 предложения", "angle": "короткий угол подачи", ` +
    `"targetSegmentName": "имя сегмента из audience", "funnelStage": "awareness|consideration|conversion", ` +
    `"score": 0-100}]} (ровно 3 оффера)`
  );
}

export function parseOfferAlternatives(raw: string, audience: AudienceSegment[]): Offer[] {
  const parsed = extractJson(raw) as { offers?: any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const findAudienceId = (name: string | undefined) => audience.find((a) => a.name === name)?.id;
  return (parsed.offers ?? []).map((o: any) => ({
    id: genId('off'),
    text: o.text ?? '',
    angle: o.angle ?? '',
    targetSegmentId: findAudienceId(o.targetSegmentName),
    funnelStage: o.funnelStage ?? 'conversion',
    score: o.score ?? 70,
    isPrimary: false,
  }));
}

export function tryParseAssistantAction(raw: string): StrategyAction | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.type === 'string' && (ACTION_TYPES as string[]).includes(obj.type)) {
      return obj as StrategyAction;
    }
  } catch {
    // Not JSON — treat as a plain-text answer.
  }
  return null;
}
