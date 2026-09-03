// AI prompt + response parsing for the "Стратегия" mode (see StrategyPanel.tsx). One
// generateChat call does the whole analysis — there's no dedicated backend function for this,
// same "orchestrate an existing API call with a carefully-shaped prompt" approach OneLaunchPanel
// uses for its own AI steps.

import { parseSuggestions } from './chatSuggestions';
import { STRATEGY_GOAL_LABELS, type StrategyBrief, type StrategyData } from './strategyTypes';

export function buildStrategyPrompt(brief: StrategyBrief): string {
  const goalLabel = STRATEGY_GOAL_LABELS[brief.goal].ru;
  const photoLine = brief.photo
    ? 'К сообщению приложено фото товара/продукта — проанализируй его и используй как основной источник понимания продукта.'
    : '';
  return (
    `Ты — маркетинговый стратег. На основе брифа ниже построй полную маркетинговую стратегию и ` +
    `верни её СТРОГО как валидный JSON без markdown-разметки, без пояснений до или после.\n\n` +
    `Бриф:\n` +
    `— Цель: ${goalLabel}\n` +
    `— Рынок: ${brief.market}\n` +
    `— Срок: ${brief.durationMonths} мес.\n` +
    `— Бюджет: ${brief.budget} ${brief.currency}\n` +
    `— Описание продукта/бизнеса: ${brief.productDescription}\n` +
    `${photoLine}\n\n` +
    `Верни JSON строго по такой схеме (без лишних полей):\n` +
    `{\n` +
    `  "title": "короткое название стратегии, 2-4 слова",\n` +
    `  "positioning": "1-2 предложения позиционирования",\n` +
    `  "offer": "1-2 предложения — суть оффера",\n` +
    `  "score": {"overall": 0-100, "audience": 0-100, "positioning": 0-100, "offer": 0-100, ` +
    `"channels": 0-100, "content": 0-100, "retention": 0-100},\n` +
    `  "audience": [{"name": "название сегмента", "potential": "High|Medium|Low", ` +
    `"description": "1 предложение", "painPoints": ["боль 1", "боль 2"]}] (2-3 сегмента),\n` +
    `  "channels": [{"name": "название канала", "percent": 0-100}] (3-5 каналов, сумма ` +
    `percent = 100, распредели бюджет ${brief.budget} ${brief.currency} по проценту),\n` +
    `  "risks": [{"title": "короткий заголовок", "description": "1 предложение"}] (2-3 штуки),\n` +
    `  "opportunities": [{"title": "короткий заголовок", "description": "1 предложение"}] ` +
    `(2-3 штуки),\n` +
    `  "contentMatrix": [{"format": "название формата контента", "stages": ["awareness", ` +
    `"consideration", "conversion"]}] (4-6 форматов, у каждого свой набор из этих трёх стадий, ` +
    `не обязательно все три),\n` +
    `  "funnel": [{"label": "название стадии", "value": число, "conversionToNext": 0-100}] ` +
    `(4 стадии воронки от охвата до покупок/целевого действия, реалистичные числа под бюджет и ` +
    `рынок, у последней стадии conversionToNext не указывай),\n` +
    `  "plan": [{"day": "ПН 03", "title": "конкретная задача на день", "tag": "стадия воронки · ` +
    `сегмент аудитории"}] (5-7 задач на первую неделю),\n` +
    `  "topInsight": {"title": "короткий заголовок главной рекомендации", "description": "1-2 ` +
    `предложения, что и почему стоит сделать в первую очередь"}\n` +
    `}\n\n` +
    `Все текстовые поля — на русском языке, конкретно под этот продукт и рынок, без общих фраз.`
  );
}

// Same defensive extraction evaluate-creative's Edge Function uses server-side (find the first
// "{" and the last "}"), applied client-side here since this call goes through the general
// generate-chat function (mode 'text'), whose system prompt may append its own
// ```oneflow-suggestions fenced block after the JSON — parseSuggestions strips that first.
export function parseStrategyResponse(raw: string): StrategyData {
  const { cleanedText } = parseSuggestions(raw);
  const start = cleanedText.indexOf('{');
  const end = cleanedText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI response had no JSON object');
  }
  const parsed = JSON.parse(cleanedText.slice(start, end + 1));
  return parsed as StrategyData;
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
  return (
    `Transform the uploaded product photo into a premium "${format}" marketing creative. ` +
    `${audienceLine}\n` +
    `Positioning: ${data.positioning}\n` +
    `Offer: ${data.offer}\n\n` +
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
