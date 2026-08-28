// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "generate-video" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed: REPLICATE_API_KEY (Edge Functions → generate-video → Secrets).

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

function buildVideoInput(
  model: string,
  prompt: string,
  image: string | undefined,
  aspectRatio: string,
  duration: number,
  resolution: string
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt };
  if (image) input.image = image;
  const isImageToVideo = Boolean(image);

  if (model.startsWith('bytedance/seedance')) {
    if (!isImageToVideo) {
      input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
    }
    input.duration = Math.round(duration);
    input.resolution = resolution;
    return input;
  }
  if (model === 'kwaivgi/kling-v3-video') {
    if (!isImageToVideo) {
      input.aspect_ratio = mapToSupportedRatio(aspectRatio, ['16:9', '9:16', '1:1']);
    }
    input.duration = Math.round(duration);
    input.mode = resolution === '1080p' ? 'pro' : 'standard';
    return input;
  }
  input.duration = Math.round(duration);
  return input;
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
    const { model, prompt, image, aspectRatio, duration, resolution } = params;
    const input = buildVideoInput(model, prompt, image, aspectRatio, duration, resolution);
    const replicate = new Replicate({ auth: REPLICATE_API_KEY });
    const output = await replicate.run(model, { input });
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
