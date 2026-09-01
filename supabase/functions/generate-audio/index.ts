// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-audio" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: REPLICATE_API_KEY (Edge Functions → generate-audio → Secrets).
//
// Backs the "Музыка и аудио" panel's two modes (see src/components/MusicAudioPanel.tsx):
// music (minimax/music-2.5 — style prompt + lyrics) and speech (google/gemini-3.1-flash-tts —
// phrase + delivery-style prompt + voice + language). Exact input field names for both models
// aren't published in an exact machine-readable schema here — if Replicate rejects a field as
// unexpected, its error message names the actual expected key; update buildAudioInput below to
// match (and mirror the same change in electron/main.ts's copy for the desktop build).

import Replicate from 'npm:replicate';

const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MUSIC_MODEL = 'minimax/music-2.5';
const SPEECH_MODEL = 'google/gemini-3.1-flash-tts';

interface AudioBody {
  mode?: 'music' | 'speech';
  prompt?: string;
  lyrics?: string;
  format?: string;
  text?: string;
  voice?: string;
  language?: string;
}

function buildAudioInput(body: AudioBody): { model: string; input: Record<string, unknown> } {
  if (body.mode === 'speech') {
    // Gemini's native TTS takes a delivery-style instruction alongside the phrase itself
    // (e.g. "say cheerfully: ..."); folding the style prompt into the text field is the most
    // schema-agnostic way to pass both, regardless of whether this Replicate wrapper also
    // exposes a separate style field.
    const text = body.prompt ? `${body.prompt}: ${body.text ?? ''}` : (body.text ?? '');
    return {
      model: SPEECH_MODEL,
      input: {
        text,
        voice: body.voice,
        language: body.language,
      },
    };
  }
  // No output-format field exists on this model at all (Replicate rejects `output_format` as
  // an unexpected/extra field — confirmed by the "Prediction input failed validation" error
  // this used to throw on every music generation) — its container format is fixed server-side,
  // not caller-selectable. body.format is still accepted from the client (used client-side to
  // name the downloaded file) but intentionally not forwarded here.
  const input: Record<string, unknown> = {
    prompt: body.prompt ?? '',
    lyrics: body.lyrics ?? '',
  };
  return { model: MUSIC_MODEL, input };
}

function normalizeAudioOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output) && output.length > 0) return normalizeAudioOutput(output[0]);
  if (output && typeof output === 'object') {
    const anyOutput = output as { url?: unknown };
    if (typeof anyOutput.url === 'function') return String((anyOutput.url as () => unknown)());
    if (typeof anyOutput.url === 'string') return anyOutput.url;
  }
  return String(output);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const body: AudioBody = await req.json();
    const { model, input } = buildAudioInput(body);
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run(model, { input });
    return new Response(JSON.stringify({ url: normalizeAudioOutput(output) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
