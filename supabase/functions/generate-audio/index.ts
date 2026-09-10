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
// No per-user billing here — every generation is funded by the single shared
// OPENROUTER_API_KEY, topped up directly at openrouter.ai. Requires the generation_log table
// — see the SQL comment in admin-list-generations/index.ts — for admin usage history only.

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

async function logGeneration(
  userId: string,
  email: string,
  model: string,
  category: string,
  costUsd: number
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('generation_log')
    .insert({ user_id: userId, email, model, category, cost_usd: costUsd });
  if (error) console.error('Failed to log generation', error);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = caller.id;

    const body: AudioBody = await req.json();
    const costUsd = AUDIO_PRICE_USD[body.mode === 'speech' ? 'speech' : 'music'];

    const isSpeech = body.mode === 'speech';
    const model = isSpeech ? SPEECH_MODEL : MUSIC_MODEL;
    const { url, realCostUsd } = isSpeech ? await generateSpeech(body) : await generateMusic(body);

    void logGeneration(callerId, caller.email, model, 'audio', realCostUsd ?? costUsd);

    return new Response(JSON.stringify({ url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
