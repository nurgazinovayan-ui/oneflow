// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "marketing-ai" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENAI_API_KEY (Edge Functions → marketing-ai → Secrets).
// Optional secrets: OPENAI_MODEL_LOW / OPENAI_MODEL_MEDIUM / OPENAI_MODEL_HIGH /
// OPENAI_MODEL_MULTIMODAL — override the default model per complexity tier (spec §96) without a
// redeploy. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// This is the server-side `MarketingAIProvider` from the ONEFLOW Marketing Intelligence Master
// Spec v4 (§80-104): the ONLY place that calls the OpenAI API for Strategy mode. The frontend
// never holds an OpenAI key and never calls OpenAI directly — every request from the client goes
// through here as { task, context }, gets a minimal task-specific prompt (spec §83, never the
// whole project), and gets back Structured-Output JSON validated against a strict JSON Schema
// (spec §87). OpenAI is the reasoning/hypothesis layer only — every exact number (CAC, funnel
// math, forecasts, experiment significance, budget allocation) is computed by ONEFLOW's own
// deterministic code (src/strategy/domain/calculators.ts) from real inputs, never by the model
// (spec §90). This function only ever returns a `StrategyUpdateProposal`-shaped object for
// strategy changes (interpretResults) — it never mutates strategy state itself (spec §98).
//
// Mock mode (spec §100 — must be explicit, never a silent prod fallback): the client can pass
// `mock: true` in the request body, which always serves a fixture regardless of whether
// OPENAI_API_KEY is set. Production calls never set that flag; if OPENAI_API_KEY is missing on
// a real (non-mock) call, this function returns a clear 500 instead of silently guessing.
//
// Model IDs below are defaults only — OpenAI's model lineup moves faster than this codebase.
// Per spec §103, verify current model names/availability against OpenAI's docs at deploy time
// and override via the OPENAI_MODEL_* secrets above rather than editing this file.

import OpenAI from 'npm:openai';
import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const MODEL_LOW = Deno.env.get('OPENAI_MODEL_LOW') || 'gpt-4.1-mini';
const MODEL_MEDIUM = Deno.env.get('OPENAI_MODEL_MEDIUM') || 'gpt-4.1-mini';
const MODEL_HIGH = Deno.env.get('OPENAI_MODEL_HIGH') || 'gpt-4.1';
const MODEL_MULTIMODAL = Deno.env.get('OPENAI_MODEL_MULTIMODAL') || 'gpt-4.1';

const SCHEMA_VERSION = '4.0.0';
const PROMPT_VERSION = '4.0.0';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function getCaller(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// -------------------------------------------------------------------------------------------
// JSON Schema helpers (OpenAI strict Structured Outputs: every property must be listed in
// `required`; use a nullable type array instead of omitting an optional field).
// -------------------------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;
const str = (): JsonSchema => ({ type: 'string' });
const strArr = (): JsonSchema => ({ type: 'array', items: { type: 'string' } });
const bool = (): JsonSchema => ({ type: 'boolean' });
const enumStr = (values: string[]): JsonSchema => ({ type: 'string', enum: values });
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const CONFIDENCE = enumStr(['high', 'medium', 'low']);
const EVIDENCE_TYPE = enumStr(['fact', 'research', 'hypothesis', 'unknown']);

// -------------------------------------------------------------------------------------------
// Shared prompt policy — spec §89. Every task's system prompt is this policy + task instructions.
// -------------------------------------------------------------------------------------------

function buildPromptPolicy(): string {
  return (
    'Ты — маркетинговый аналитик внутри ONEFLOW Marketing Intelligence Engine. Соблюдай строго:\n' +
    '1. Никогда не представляй предположение как факт.\n' +
    '2. Каждый существенный вывод связывай с evidenceIds из переданного контекста; если evidence нет — это hypothesis.\n' +
    '3. Никогда не выдумывай численные метрики эффективности (CAC, CTR, ROAS, конверсии, размер рынка) — их считает код ONEFLOW из реальных данных.\n' +
    '4. Не делай вывод "канал лучше" только на основании общих знаний без evidence.\n' +
    '5. Не советуй scale/pause — это делает GuardrailEngine кода ONEFLOW, не ты.\n' +
    '6. Не выдумывай конкурентные цены, рыночные размеры, customer quotes или campaign results.\n' +
    '7. Для неизвестных полей возвращай пустую строку/пустой массив и добавляй пункт в missingData, а не правдоподобный текст.\n' +
    '8. Отделяй observation → interpretation → hypothesis → action.\n' +
    '9. humanExplanation пиши простым языком, без жаргона, 1-3 предложения.\n' +
    '10. Ты не применяешь изменения к стратегии — только предлагаешь; конечное решение и все точные расчёты — за кодом ONEFLOW.\n' +
    'Отвечай СТРОГО в формате переданной JSON Schema, без markdown и пояснений вне полей схемы.'
  );
}

// -------------------------------------------------------------------------------------------
// Task registry — spec §86 MarketingAIProvider methods, §88 minimal entities, §5/§84 pipeline.
// -------------------------------------------------------------------------------------------

type TaskName =
  | 'understandBusiness'
  | 'analyzeSegments'
  | 'analyzeJTBD'
  | 'proposePositioning'
  | 'proposeOffers'
  | 'analyzeChannels'
  | 'proposeCreativeStrategy'
  | 'designExperiments'
  | 'interpretResults'
  | 'explainRecommendation';

interface MarketingAIContext {
  taskType: TaskName;
  businessSnapshot?: unknown;
  goalSnapshot?: unknown;
  relevantSegments?: unknown;
  relevantOffers?: unknown;
  relevantChannels?: unknown;
  evidence?: unknown;
  metricsSnapshot?: unknown;
  experimentHistory?: unknown;
  missingData?: unknown;
  policyHints?: unknown;
  imageUrl?: string;
  [key: string]: unknown;
}

interface TaskDefinition {
  complexity: 'low' | 'medium' | 'high' | 'multimodal';
  schemaName: string;
  schema: JsonSchema;
  instructions: string;
}

const TASKS: Record<TaskName, TaskDefinition> = {
  understandBusiness: {
    complexity: 'medium',
    schemaName: 'business_understanding',
    schema: obj({
      product: str(),
      category: str(),
      customerProblem: str(),
      value: str(),
      differentiators: strArr(),
      businessModel: str(),
      geography: str(),
      goal: str(),
      solvesTodayVia: str(),
      mainPurchaseRisk: str(),
      ambiguities: strArr(),
      evidenceIds: strArr(),
      missingData: strArr(),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Business Understanding (spec §6). По брифу пользователя и приложенным фактам определи: что продаётся, кому потенциально полезно (goal-контекст), какую работу выполняет продукт, как клиент решает задачу сегодня (solvesTodayVia), ключевые ограничения, модель монетизации (businessModel), география, цель бизнеса (goal), главный риск покупки в глазах клиента (mainPurchaseRisk). Если что-то неоднозначно — добавь в ambiguities, не додумывай.',
  },
  analyzeSegments: {
    complexity: 'medium',
    schemaName: 'segmentation',
    schema: obj({
      segments: arr(
        obj({
          name: str(),
          buyingSituation: str(),
          needFrequency: str(),
          abilityToPay: str(),
          accessibility: str(),
          urgencyTrigger: str(),
          productFit: str(),
          priority: enumStr(['now', 'test', 'later']),
          priorityRationale: str(),
          evidenceIds: strArr(),
          confidence: CONFIDENCE,
          assumptions: strArr(),
        })
      ),
      missingData: strArr(),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Segmentation + ICP (spec §12). Верни 3-5 сегментов на основе реальной ситуации покупки (не декоративные persona). Для каждого: buyingSituation, needFrequency, abilityToPay, accessibility, urgencyTrigger, productFit, и приоритет now/test/later с обоснованием (priorityRationale). Приоритет должен быть обоснован критериями, а не интуицией.',
  },
  analyzeJTBD: {
    complexity: 'medium',
    schemaName: 'jtbd',
    schema: obj({
      jtbd: arr(
        obj({
          segmentId: str(),
          situation: str(),
          motivation: str(),
          desiredOutcome: str(),
          alternativesToday: str(),
          anxieties: str(),
          evidenceIds: strArr(),
        })
      ),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Jobs To Be Done (spec §13). Для каждого сегмента из relevantSegments (используй его реальный id как segmentId) сформулируй: когда [situation], хочет [motivation/progress], чтобы [desiredOutcome], но мешает [anxieties]. alternativesToday — как решает задачу сейчас без продукта.',
  },
  proposePositioning: {
    complexity: 'high',
    schemaName: 'positioning',
    schema: obj({
      directions: arr(
        obj({
          segmentId: str(),
          alternative: str(),
          value: str(),
          reasonToBelieve: str(),
          proofNeeded: str(),
          style: enumStr(['rational', 'outcome', 'technological']),
          evidenceIds: strArr(),
          recommended: bool(),
        })
      ),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Positioning (spec §15). Верни 2-3 направления позиционирования через конкурентную альтернативу, ценность и доказательство — не абстрактные слова "инновационный". Ровно одно направление пометь recommended:true, но НЕ объявляй его "победителем" без эксперимента — это лишь рекомендуемая отправная точка.',
  },
  proposeOffers: {
    complexity: 'high',
    schemaName: 'offer_strategy',
    schema: obj({
      offers: arr(
        obj({
          segmentId: str(),
          motive: enumStr(['speed', 'savings', 'simplicity', 'quality', 'volume', 'risk', 'growth']),
          promise: str(),
          mechanism: str(),
          proof: str(),
          objectionHandled: str(),
          cta: str(),
          evidenceType: EVIDENCE_TYPE,
          confidence: CONFIDENCE,
          experimentNeeded: bool(),
          recommended: bool(),
        })
      ),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Offer Strategy (spec §16). Верни 3-5 offer-гипотез на разных мотивах (speed/savings/simplicity/quality/volume/risk/growth). Оффер — проверяемая гипотеза, не финальная истина; почти всегда experimentNeeded:true. Ровно один recommended:true как отправная точка.',
  },
  analyzeChannels: {
    complexity: 'medium',
    schemaName: 'channel_hypotheses',
    schema: obj({
      channels: arr(
        obj({
          channel: str(),
          role: str(),
          targetSegmentId: str(),
          funnelStage: enumStr(['awareness', 'consideration', 'conversion']),
          contentTypes: strArr(),
          whyTest: str(),
          requiredData: strArr(),
          scaleCriteria: strArr(),
          pauseCriteria: strArr(),
          evidenceIds: strArr(),
          confidence: CONFIDENCE,
        })
      ),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Channel Strategy (spec §18/§68-70). Выбирай каналы по роли и тестируемости, НЕ по псевдоточному распределению бюджета — бюджет считает код. Объясни роль канала и условия теста (whyTest), не придумывай media efficiency. scaleCriteria/pauseCriteria — качественные условия (например "устойчивый CAC ниже цели 2 недели подряд"), не числа "с воздуха".',
  },
  proposeCreativeStrategy: {
    complexity: 'multimodal',
    schemaName: 'creative_strategy',
    schema: obj({
      concepts: arr(
        obj({
          archetype: enumStr([
            'problem_solution',
            'demo',
            'before_after',
            'ugc_testimonial',
            'comparison',
            'objection_handling',
            'offer_led',
            'proof_case',
          ]),
          hook: str(),
          visualFormat: enumStr([
            'ugc',
            'studio',
            'product',
            'lifestyle',
            'demo',
            'text_graphic',
            'animation',
            'catalog',
            'not_observable',
          ]),
          messagingTheme: str(),
          offerId: str(),
          cta: str(),
          persona: str(),
          intentStage: enumStr(['prospecting', 'consideration', 'conversion']),
          variantsToTest: strArr(),
          evidenceIds: strArr(),
        })
      ),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Creative Strategy (spec §20/§71). Предложи 4-6 creative hypotheses (не просто "делайте Reels") с конкретным archetype, hook, visualFormat, messagingTheme, offerId (из relevantOffers), persona (только по наблюдаемым сигналам, иначе пусто), intentStage, и 2-3 variantsToTest на концепт. Если приложено фото товара — учти его в hook/visualFormat.',
  },
  designExperiments: {
    complexity: 'high',
    schemaName: 'experiment_plan',
    schema: obj({
      experiments: arr(
        obj({
          hypothesisId: str(),
          name: str(),
          variable: str(),
          control: str(),
          variants: strArr(),
          audienceId: str(),
          primaryMetric: str(),
          guardrailMetrics: strArr(),
          minDataRule: str(),
          durationRule: str(),
          decisionRule: str(),
        })
      ),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Experiment Plan (spec §23-24). Тестируй одну крупную переменную за раз (variable). Зафиксируй primaryMetric ДО запуска, guardrailMetrics (например activation rate не должен ухудшиться), minDataRule/durationRule (качественное описание условия достаточности, не число "с воздуха" — конкретный порог посчитает код), decisionRule (как отличаем winner/loser/inconclusive).',
  },
  interpretResults: {
    complexity: 'high',
    schemaName: 'learning_result',
    schema: obj({
      whatHappened: str(),
      likelyDrivers: strArr(),
      unsupportedExplanations: strArr(),
      evidenceIds: strArr(),
      confidence: CONFIDENCE,
      strength: enumStr(['strong', 'moderate', 'weak']),
      affectedStrategyPaths: strArr(),
      strategyUpdateProposal: obj({
        changes: arr(obj({ field: str(), before: str(), after: str() })),
        why: str(),
        evidenceIds: strArr(),
        affectedModules: strArr(),
        requiresUserApproval: bool(),
        rollbackLabel: str(),
      }),
      humanExplanation: str(),
    }),
    instructions:
      'Задача: Learning от результата эксперимента (spec §25-26). metricsSnapshot содержит уже посчитанные кодом метрики (lift, значимость) — используй их, не пересчитывай. whatHappened — что показали данные; likelyDrivers — правдоподобные причины; unsupportedExplanations — правдоподобные, но НЕ подтверждённые данными версии (явно отметь их как неподтверждённые). Ты НЕ применяешь изменение — верни strategyUpdateProposal с diff (before/after) и requiresUserApproval:true для любого изменения бюджета/аудитории/приоритетов.',
  },
  explainRecommendation: {
    complexity: 'low',
    schemaName: 'explanation',
    schema: obj({
      whatWeSaw: str(),
      whyItMatters: str(),
      howConfirmed: str(),
      whatToCheckNext: str(),
      whatChangesOnApply: str(),
    }),
    instructions:
      'Задача: простое объяснение поверх уже структурированного результата (spec §99). Пиши коротко, понятным языком, без жаргона. Не добавляй новых фактов сверх того, что есть в контексте.',
  },
};

function modelFor(complexity: TaskDefinition['complexity']): string {
  if (complexity === 'low') return MODEL_LOW;
  if (complexity === 'medium') return MODEL_MEDIUM;
  if (complexity === 'multimodal') return MODEL_MULTIMODAL;
  return MODEL_HIGH;
}

// -------------------------------------------------------------------------------------------
// Mock provider — explicit dev/test fixture, spec §100. Never used unless the client asks for it.
// -------------------------------------------------------------------------------------------

function mockResult(task: TaskName): unknown {
  const base = { humanExplanation: `[MOCK] ${task} — тестовые данные, не результат реального анализа.` };
  switch (task) {
    case 'understandBusiness':
      return {
        product: 'AI-платформа для производства маркетингового контента',
        category: 'Marketing content generation SaaS',
        customerProblem: 'Долго и дорого производить много рекламных материалов вручную',
        value: 'Больше готовых материалов за меньшее время',
        differentiators: ['Генерация из одного фото', 'Много форматов сразу'],
        businessModel: 'Подписка/usage',
        geography: 'Казахстан',
        goal: 'Продажи',
        solvesTodayVia: 'Дизайнер, агентство, несколько AI-сервисов',
        mainPurchaseRisk: 'AI исказит товар или сделает плохой дизайн',
        ambiguities: [],
        evidenceIds: [],
        missingData: ['Данные рекламных кабинетов'],
        ...base,
      };
    case 'analyzeSegments':
      return {
        segments: [
          {
            name: 'Marketplace sellers',
            buyingSituation: 'Нужно быстро выпускать много SKU',
            needFrequency: 'Часто',
            abilityToPay: 'Средняя',
            accessibility: 'Высокая — есть в таргетинге',
            urgencyTrigger: 'Запуск нового сезона/товара',
            productFit: 'Высокий',
            priority: 'now',
            priorityRationale: 'Частая задача, легко демонстрируется визуально',
            evidenceIds: [],
            confidence: 'medium',
            assumptions: ['Оценка на основе общей структуры бизнеса'],
          },
        ],
        missingData: [],
        ...base,
      };
    default:
      return { ...base };
  }
}

// -------------------------------------------------------------------------------------------
// OpenAI call (Responses API + Structured Outputs) — the only place OpenAI is actually called.
// -------------------------------------------------------------------------------------------

async function callOpenAI(task: TaskName, ctx: MarketingAIContext): Promise<{ result: unknown; model: string; latencyMs: number }> {
  const def = TASKS[task];
  const model = modelFor(def.complexity);
  const systemPrompt = `${buildPromptPolicy()}\n\n${def.instructions}`;
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const userContent: Array<{ type: string; text?: string; image_url?: string }> = [
    { type: 'input_text', text: JSON.stringify(ctx) },
  ];
  if (ctx.imageUrl && def.complexity === 'multimodal') {
    userContent.push({ type: 'input_image', image_url: ctx.imageUrl });
  }

  const started = Date.now();
  const response = await client.responses.create({
    model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent as never },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: def.schemaName,
        schema: def.schema,
        strict: true,
      },
    },
  } as never);
  const latencyMs = Date.now() - started;

  const outputText = (response as { output_text?: string }).output_text;
  if (!outputText) {
    throw new Error('OpenAI returned no structured output (refusal or incomplete response)');
  }
  return { result: JSON.parse(outputText), model, latencyMs };
}

function logTelemetry(entry: Record<string, unknown>): void {
  // spec §97 — structured, no secrets, no raw user text.
  console.log(JSON.stringify({ scope: 'marketing-ai', promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, ...entry }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const requestId = crypto.randomUUID();
  try {
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as { task?: TaskName; context?: MarketingAIContext; mock?: boolean };
    const task = body.task;
    if (!task || !TASKS[task]) {
      return new Response(JSON.stringify({ error: `Unknown task "${String(task)}".` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ctx: MarketingAIContext = { taskType: task, ...(body.context ?? {}) };

    if (body.mock === true) {
      logTelemetry({ requestId, task, mock: true, userId: caller.id });
      return new Response(
        JSON.stringify({ result: mockResult(task), schemaVersion: SCHEMA_VERSION, promptVersion: PROMPT_VERSION, mock: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!OPENAI_API_KEY) {
      logTelemetry({ requestId, task, error: 'missing_api_key', userId: caller.id });
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY is not configured on this Edge Function.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let attempt = 0;
    let lastError: unknown;
    while (attempt < 2) {
      attempt++;
      try {
        const { result, model, latencyMs } = await callOpenAI(task, ctx);
        logTelemetry({ requestId, task, model, latencyMs, attempt, validation: 'pass', userId: caller.id });
        return new Response(
          JSON.stringify({ result, schemaVersion: SCHEMA_VERSION, promptVersion: PROMPT_VERSION, model }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        lastError = err;
        logTelemetry({ requestId, task, attempt, validation: 'fail', error: String(err), userId: caller.id });
      }
    }
    // spec §94/§119 — never save a partially-invalid AI output as the active strategy; surface a
    // recoverable error instead of guessing.
    return new Response(JSON.stringify({ error: `AI request failed after retries: ${String(lastError)}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logTelemetry({ requestId, error: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
