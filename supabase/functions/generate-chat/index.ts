// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-chat" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: REPLICATE_API_KEY (Edge Functions → generate-chat → Secrets).

import Replicate from 'npm:replicate';

const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY') ?? '';

// The web build is served from a different origin than *.supabase.co, so every browser call
// here is cross-origin and triggers a CORS preflight (OPTIONS) first — without these headers
// on both the preflight and the real response, the browser blocks the request before it ever
// reaches this function.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shared by both chat system prompts below — teaches the model an optional second fenced
// block for quick-reply chips the UI renders as clickable buttons (see src/chatSuggestions.ts).
// Kept deliberately "use sparingly" so it doesn't turn every reply into a wall of buttons.
const SUGGESTIONS_INSTRUCTIONS =
  '\n\nИногда, когда это реально ускорит диалог (ты предлагаешь несколько вариантов на выбор, ' +
  'или задаёшь уточняющий вопрос с очевидными короткими ответами), можешь добавить в самом конце ' +
  'ответа (после любого другого спецблока, если он есть) fenced-блок кода с языком ' +
  'oneflow-suggestions, содержащий JSON-массив из 2-4 коротких вариантов быстрого ответа ' +
  'пользователя на его языке, например:\n' +
  '```oneflow-suggestions\n' +
  '["Да, делай так", "Покажи другой вариант", "Нет, не нужно"]\n' +
  '```\n' +
  'Используй это не в каждом ответе, а только когда варианты действительно короткие и уместные.';

const NODE_ASSISTANT_SYSTEM_PROMPT =
  'Ты — дружелюбный ИИ-ассистент внутри веб-приложения ONEFLOW — нод-редактора для ' +
  'генерации фото и видео через различные нейросети (Replicate). Отвечай кратко, по делу, ' +
  'на языке пользователя (по умолчанию на русском).\n\n' +
  'У тебя есть возможность самому создавать цепочки нод на холсте пользователя. Делай это ' +
  'ТОЛЬКО когда пользователь явно просит построить/создать/собрать ноды или цепочку ' +
  '(например: "собери цепочку для генерации видео из фото", "добавь ноду адаптации под Kaspi"). ' +
  'Для этого в конце своего ответа добавь один fenced-блок кода с языком oneflow-actions, ' +
  'содержащий JSON-объект вида {"actions": [...]}. Каждый элемент actions — это один из:\n' +
  '  {"type":"addNode","refId":"n1","nodeType":"prompt","data":{"value":"..."}}\n' +
  '  {"type":"addNode","refId":"n2","nodeType":"imageGen","data":{"model":"google/nano-banana-pro","aspectRatio":"1:1"}}\n' +
  '  {"type":"connect","from":"n1","to":"n2","targetHandle":"prompt"}\n' +
  'Допустимые nodeType и их data: "prompt" (data.value — текст промпта), ' +
  '"imageGen" (data.model, data.manualPrompt, data.aspectRatio), ' +
  '"videoGen" (data.model, data.manualPrompt, data.aspectRatio, data.duration, data.resolution), ' +
  '"adapt" (data.note), "imageInput" (data.manualUrl — URL картинки, если есть, иначе не указывай). ' +
  'refId — твой временный локальный id узла внутри этого JSON, нужен только для connect, ' +
  'в самом приложении узлам присваиваются другие настоящие id. ' +
  'Допустимые targetHandle для connect: у imageGen — "prompt" (источник: prompt) или ' +
  '"ref-0".."ref-6" (источник: imageGen/imageInput, до 7 референс-фото по порядку подключения); ' +
  'у videoGen — "prompt" (источник: prompt) или "image" (источник: imageGen/imageInput); ' +
  'у adapt — "image" (источник: imageGen/imageInput). ' +
  'У adapt нет выходного гнезда — из него нельзя тянуть connect. У prompt/imageGen/imageInput/videoGen ' +
  'есть ровно один источник (output), поэтому в connect достаточно указать from/to/targetHandle. ' +
  'Перед JSON-блоком коротко на русском объясни, что ты сейчас добавишь. Никогда не включай этот ' +
  'блок, если пользователь не просил явно что-то создать/добавить/собрать на холсте. Если в ответе ' +
  'есть и oneflow-suggestions, и oneflow-actions — блок oneflow-actions должен идти самым последним.' +
  SUGGESTIONS_INSTRUCTIONS;

// The general-purpose chat behind "Работа с текстом" — deliberately NOT the node-building
// assistant above: it never emits oneflow-actions, and redirects the user to the canvas's own
// ИИ ассистент if they ask it to build something there.
// Teaches the text-work chat an optional third fenced block, alongside oneflow-suggestions —
// structured content the client turns into a real .docx/.pptx client-side (see
// src/deliverables.ts), never binary output from the model itself.
const DOCUMENT_INSTRUCTIONS =
  '\n\nЕсли пользователь явно просит подготовить документ (например: договор, отчёт, статью, ' +
  'бриф, письмо) или презентацию — после краткого текстового ответа добавь fenced-блок кода с ' +
  'языком oneflow-document, содержащий JSON-объект одного из двух видов:\n' +
  'Документ: {"kind":"document","title":"...","sections":[{"heading":"...",' +
  '"paragraphs":["..."],"bullets":["..."]}]} — heading/paragraphs/bullets в каждом section ' +
  'необязательны, используй что уместно.\n' +
  'Презентация: {"kind":"presentation","title":"...","slides":[{"title":"...",' +
  '"bullets":["..."],"notes":"..."}]} — notes необязательны (заметки докладчика).\n' +
  'Заголовок и весь текст внутри — на языке пользователя, содержательные и готовые к ' +
  'использованию (не заглушки/placeholder). Не включай этот блок, если пользователь не просил ' +
  'именно документ или презентацию — обычные ответы (заголовки, идеи, короткие тексты) ' +
  'оформляй просто как обычный текст.';

const TEXT_CHAT_SYSTEM_PROMPT =
  'Ты — полноценный ИИ-ассистент общего назначения внутри раздела «Работа с текстом» веб-' +
  'приложения ONEFLOW (программа для создания рекламных фото/видео под ad-платформы: BYYD, ' +
  'Discovery, GDN, Kaspi, РСЯ). Помогай с любыми текстовыми задачами: заголовки и описания для ' +
  'рекламы, копирайтинг, редактура, перевод, мозговой штурм идей для кампаний, а также обычные ' +
  'вопросы — как полноценный ChatGPT. Отвечай подробно и по делу, форматируй markdown\'ом ' +
  '(списки, выделение), когда это уместно, на языке пользователя (по умолчанию на русском).\n\n' +
  'Ты НЕ создаёшь и не редактируешь ноды на холсте — этим занимается отдельный ассистент. Если ' +
  'пользователь просит построить цепочку нод или что-то на холсте, вежливо объясни, что для ' +
  'этого нужно использовать кнопку «ИИ ассистент» на самом холсте, и не пытайся выполнить это сам.' +
  DOCUMENT_INSTRUCTIONS +
  SUGGESTIONS_INSTRUCTIONS;

function normalizeChatOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(String).join('');
  return String(output);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const body: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      images?: string[];
      mode?: 'assistant' | 'text';
    } = await req.json();
    const { messages, images, mode } = body;
    const transcript =
      messages
        .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.content}`)
        .join('\n\n') + '\n\nАссистент:';
    const input: Record<string, unknown> = {
      prompt: transcript,
      system_prompt: mode === 'text' ? TEXT_CHAT_SYSTEM_PROMPT : NODE_ASSISTANT_SYSTEM_PROMPT,
    };
    // Field name for vision input on this model isn't published in an exact
    // machine-readable schema by Replicate; "image_input" matches the pattern used by the
    // other multi-image Replicate models already wired in this app.
    if (images?.length) input.image_input = images;
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run('openai/gpt-5.6-terra', { input });
    return new Response(JSON.stringify(normalizeChatOutput(output)), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
