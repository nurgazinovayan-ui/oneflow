// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-video-pro" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: REPLICATE_API_KEY (Edge Functions → generate-video-pro → Secrets).
//
// Field names for Seedance 2.5's multimodal reference arrays ("images"/"videos"/"audios")
// aren't published in an exact machine-readable schema by Replicate — if Replicate rejects
// these as unexpected properties, its error message names the actual expected key.

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

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

function mapToSupportedRatio(ratio: string, supported: string[]): string {
  if (supported.includes(ratio)) return ratio;
  const target = ratioValue(ratio);
  let best = supported[0];
  let bestDiff = Infinity;
  for (const candidate of supported) {
    const diff = Math.abs(ratioValue(candidate) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

function normalizeOutput(output: unknown): string[] {
  const toUrl = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const anyItem = item as { url?: unknown };
      if (typeof anyItem.url === 'function') return String((anyItem.url as () => unknown)());
      if (typeof anyItem.url === 'string') return anyItem.url;
    }
    return String(item);
  };
  if (Array.isArray(output)) return output.map(toUrl);
  return [toUrl(output)];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const params = await req.json();
    const { prompt, aspectRatio, duration, resolution, images, videos, audios } = params;
    const input: Record<string, unknown> = {
      prompt,
      aspect_ratio: mapToSupportedRatio(aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']),
      duration: Math.round(duration),
      resolution,
    };
    if (images?.length) input.images = images;
    if (videos?.length) input.videos = videos;
    if (audios?.length) input.audios = audios;
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run('bytedance/seedance-2.5', { input });
    return new Response(JSON.stringify(normalizeOutput(output)), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
