// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-audio" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: OPENROUTER_API_KEY (Edge Functions → generate-audio → Secrets;
// openrouter.ai/settings/keys).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are normally already set automatically.
//
// Backs the "Музыка и аудио" panel's two modes (see src/components/MusicAudioPanel.tsx):
// speech uses OpenRouter's dedicated TTS endpoint (POST /api/v1/audio/speech, OpenAI-Audio-
// compatible — returns raw MP3 bytes, not JSON). Music generation has no dedicated endpoint on
// OpenRouter — it goes through google/lyria-3-pro-preview via the chat completions endpoint
// with modalities:["text","audio"], returning base64 audio in choices[0].message.audio.data.
// That response shape (and whether Lyria expects prompt+lyrics folded into one text message, as
// done below) is not confirmed against a live call — if OpenRouter rejects the request or
// returns something buildAudioInput/extractMusicAudio below doesn't expect, its error message
// or the raw response shape names the fix needed (mirror any change in electron/main.ts's copy
// for the desktop build).
//
// Every call is funded by the single shared OPENROUTER_API_KEY, but each user may only spend their
// own monthly allowance: the spend guard below reserves the cost before the provider call and
// settles it into generation_log afterwards. Requires supabase/migrations/
// 202610010001_generation_guard.sql (and the generation_log table — see admin-list-generations).

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// google/lyria-3-pro-preview publishes a flat $0.08/song rate on OpenRouter, used directly for
// music. Speech bills per token, not per call — kept in sync by hand with AUDIO_PRICE_USD in
// src/types.ts.
const AUDIO_PRICE_USD: Record<'music' | 'speech', number> = { music: 0.08, speech: 0.02 };

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

const MUSIC_MODEL = 'google/lyria-3-pro-preview';
const SPEECH_MODEL = 'google/gemini-3.1-flash-tts-preview';

interface AudioBody {
  mode?: 'music' | 'speech';
  prompt?: string;
  lyrics?: string;
  format?: string;
  text?: string;
  voice?: string;
  language?: string;
}

// Base64-encodes raw bytes without blowing the call stack on a large buffer (String.fromCharCode
// with a giant spread arg fails on multi-MB audio) — chunked conversion.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// The speech endpoint returns raw audio bytes, not JSON — OpenRouter has no cost field to read
// off a binary response here (getting the real number would need a follow-up call to
// /api/v1/generation using the X-Generation-Id response header), so this keeps using
// AUDIO_PRICE_USD.speech's flat estimate. realCostUsd is still returned (always null) so the
// caller has one shape to deal with for both modes.
async function generateSpeech(body: AudioBody): Promise<{ url: string; realCostUsd: number | null }> {
  // Gemini's native TTS takes a delivery-style instruction alongside the phrase itself
  // (e.g. "say cheerfully: ..."); folding the style prompt into the text field is the most
  // schema-agnostic way to pass both, regardless of whether this endpoint also exposes a
  // separate style field.
  const text = body.prompt ? `${body.prompt}: ${body.text ?? ''}` : (body.text ?? '');
  const res = await fetch(OPENROUTER_SPEECH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      input: text,
      voice: body.voice,
      language: body.language,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter speech error ${res.status}: ${await res.text()}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { url: `data:audio/mpeg;base64,${bytesToBase64(bytes)}`, realCostUsd: null };
}

async function generateMusic(body: AudioBody): Promise<{ url: string; realCostUsd: number | null }> {
  const prompt = [body.prompt, body.lyrics ? `Lyrics:\n${body.lyrics}` : null].filter(Boolean).join('\n\n');
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MUSIC_MODEL,
      modalities: ['text', 'audio'],
      messages: [{ role: 'user', content: prompt }],
      // Opts into OpenRouter reporting the ACTUAL dollar cost of this call in data.usage.cost,
      // preferred over AUDIO_PRICE_USD.music's flat estimate.
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter music error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const audio = data.choices?.[0]?.message?.audio;
  if (!audio?.data) throw new Error('OpenRouter music response had no audio data.');
  const mediaType = typeof audio.format === 'string' ? `audio/${audio.format}` : 'audio/wav';
  const realCostUsd = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
  return { url: `data:${mediaType};base64,${audio.data}`, realCostUsd };
}

// ---- Spend guard (security audit C-1/M-1). The same block is pasted into every paid function
// (they deploy as single files, no shared imports). Before a paid provider call the estimated cost
// is reserved against the caller's monthly allowance — who may spend what is decided in ONE place,
// supabase/migrations/202610010001_generation_guard.sql. After the call the reservation is settled
// with the real cost (that writes generation_log, once) or released if the call failed.
class GuardError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
const GUARD_ERRORS: Record<string, [number, string]> = {
  email_not_confirmed: [403, 'Подтвердите email, чтобы пользоваться генерацией.'],
  quota_exceeded: [402, 'Лимит генераций на этот месяц исчерпан.'],
  too_many_jobs: [429, 'Слишком много генераций одновременно — дождитесь завершения.'],
  job_too_expensive: [400, 'Запрос слишком дорогой для одной генерации.'],
};
const badRequest = (message: string) => new GuardError(400, 'bad_request', message);

async function reserveSpend(userId: string, model: string, category: string, amountUsd: number): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('reserve_generation', {
    p_user: userId,
    p_model: model,
    p_category: category,
    p_amount: Math.max(0, Number(amountUsd) || 0),
  });
  if (error) {
    const code = Object.keys(GUARD_ERRORS).find((k) => (error.message ?? '').includes(k));
    if (code) throw new GuardError(GUARD_ERRORS[code][0], code, GUARD_ERRORS[code][1]);
    throw error;
  }
  return data as string;
}

async function settleSpend(reservation: string | null, email: string, costUsd: number): Promise<void> {
  if (!reservation) return;
  const { error } = await supabaseAdmin.rpc('settle_generation', { p_reservation: reservation, p_email: email, p_cost: costUsd });
  if (error) console.error('settle_generation failed', error);
}

// Releases an unsettled reservation and turns any error into a response without internal details
// (audit L-2) — the details go to the function's logs instead.
async function failResponse(err: unknown, reservation: string | null, message: string): Promise<Response> {
  if (reservation) {
    const { error } = await supabaseAdmin.rpc('release_generation', { p_reservation: reservation });
    if (error) console.error('release_generation failed', error);
  }
  if (err instanceof GuardError) return jsonResponse({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return jsonResponse({ error: message }, 500);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Reference images: https URLs or image data URLs only, bounded in size.
const MAX_IMAGE_REF_CHARS = 12_000_000;
const isImageRef = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_IMAGE_REF_CHARS && (v.startsWith('https://') || v.startsWith('data:image/'));
const clipText = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
// ---- end of spend guard

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let reservation: string | null = null;
  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: 'Not authenticated.' }, 401);
    const params = await req.json().catch(() => null);
    if (!params || typeof params !== 'object') throw badRequest('Bad request.');

    const isSpeech = params.mode === 'speech';
    const body: AudioBody = {
      mode: isSpeech ? 'speech' : 'music',
      prompt: clipText(params.prompt, 2000),
      lyrics: clipText(params.lyrics, 4000),
      format: clipText(params.format, 10) || undefined,
      text: clipText(params.text, 2000),
      voice: clipText(params.voice, 60) || undefined,
      language: clipText(params.language, 20) || undefined,
    };
    const model = isSpeech ? SPEECH_MODEL : MUSIC_MODEL;
    const costUsd = AUDIO_PRICE_USD[isSpeech ? 'speech' : 'music'];
    reservation = await reserveSpend(caller.id, model, 'audio', costUsd);

    const { url, realCostUsd } = isSpeech ? await generateSpeech(body) : await generateMusic(body);

    await settleSpend(reservation, caller.email, realCostUsd ?? costUsd);
    reservation = null;
    return jsonResponse({ url });
  } catch (err) {
    return failResponse(err, reservation, 'Не удалось сгенерировать аудио. Попробуйте ещё раз.');
  }
});
