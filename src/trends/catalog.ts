import { ASPECT_RATIOS, IMAGE_MODELS, VIDEO_MODELS, IMAGE_MODEL_META, VIDEO_MODEL_META, modelShortName } from '../types';

export interface TrendPrompt {
  id: string;
  title: string;
  description: string;
  prompt: string;
  kind: 'image' | 'video';
  model: string;
  categories: string[];
  collections: string[];
  thumbnail_url: string | null;
  video_url: string | null;
  source_url: string | null;
  author: string;
  published_at: string | null;
  imported_at: string;
  popularity: number | null;
  aspect_ratio: string | null;
  license: string | null;
  license_url: string | null;
  source_repo: string | null;
  source_commit: string | null;
}
export interface TrendLaunch {
  id: string;
  kind: 'image' | 'video';
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
}
export function supportedModels(kind: 'image' | 'video') {
  return kind === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
}
export function resolveModel(item: TrendPrompt): string | undefined {
  return supportedModels(item.kind).find(m => m.value === item.model || modelShortName(m.label).toLowerCase() === item.model.toLowerCase())?.value;
}
export function makeLaunch(item: TrendPrompt, prompt: string, model: string): TrendLaunch {
  if (!supportedModels(item.kind).some(m => m.value === model)) throw new Error('Unsupported model');
  return {
    id: crypto.randomUUID(), kind: item.kind, prompt, model,
    aspectRatio: ASPECT_RATIOS.some(r => r === item.aspect_ratio) ? item.aspect_ratio! : item.kind === 'video' ? '16:9' : '1:1',
    resolution: item.kind === 'image' ? IMAGE_MODEL_META[model].resolutions[0].value : VIDEO_MODEL_META[model].resolutions[0],
  };
}
export function safeMediaUrl(value: string | null): string | undefined {
  if (!value) return;
  if ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('./')) return value;
  try { const u = new URL(value); if (u.protocol === 'https:') return u.href; } catch { /* invalid URL */ }
}
export function safeSourceUrl(value: string | null): string | undefined {
  if (!value) return;
  try { const u = new URL(value); if (u.protocol === 'https:') return u.href; } catch { /* invalid URL */ }
}
export interface CatalogQuery {
  query: string; kind: string; model: string; category: string; collection: string;
  sort: string; offset: number; ids: string[] | null;
}
export interface CatalogPage {
  items: TrendPrompt[]; total: number;
  facets: { models: string[]; categories: string[]; collections: string[] };
}
export const PAGE_SIZE = 36;

// Original demo prompts; supplied ONEFLOW assets are visual references, not generated results.
const demos = [
  ['demo-electronics', 'Studio / Electronics', 'Product', 'Product studio', 'image', 'Nano Banana Pro', 'electronics/01.jpg', 'Create a premium studio product photograph of the uploaded device. Preserve its exact geometry, branding and controls. Use a clean background, soft key light and a subtle grounded shadow. Do not invent product features or add text.'],
  ['demo-fashion', 'Soft light / Kidswear', 'Fashion', 'Product studio', 'image', 'Nano Banana Pro', 'premium/01-body.jpg', 'Photograph the uploaded baby garment for a premium product catalog. Keep its exact fabric, seams, color and print. Use a warm neutral studio setting with soft window light, clear fabric detail and a clean composition. No added claims or text.'],
  ['demo-toy', 'Playful / Product hero', 'Toys', 'Product studio', 'image', 'GPT Image 2', 'premium/04-pyramid.jpg', 'Create a playful editorial product photograph of the uploaded toy. Keep every part, material and color unchanged. Arrange a few simple geometric props around it, leaving clear space for a headline. Soft shadows, precise composition, no generated text.'],
  ['demo-portrait', 'Cinematic / Portrait', 'Portrait', 'Cinematic', 'image', 'GPT Image 2', null, 'Create a cinematic portrait from the uploaded photograph. Preserve the person’s identity and facial proportions. Three-quarter close-up, soft side light, restrained colors, natural skin texture, shallow depth of field and subtle 35 mm film grain.'],
  ['demo-video', 'Macro / Product reveal', 'Product', 'Cinematic', 'video', 'Seedance 2.5', null, 'Use the uploaded product image as the first frame. 0–3 seconds: slow macro camera move over the material. 3–6 seconds: smoothly widen to reveal the whole product. 6–8 seconds: settle into a clean hero shot. Preserve product geometry and branding throughout. Natural motion, no music, no added text.'],
  ['demo-action', 'Orbit / Character', 'Cinematic', 'Cinematic', 'video', 'Seedance 2.0', null, 'Start from the supplied character reference. Over 8 seconds, move the camera slowly from a frontal medium shot into a close three-quarter view while the character turns toward a distant light. Preserve identity, costume and spatial continuity. Natural speed, subtle handheld movement, no dialogue or music.'],
] as const;
export const DEMO_PROMPTS: TrendPrompt[] = demos.map(([id, title, category, collection, kind, model, asset, prompt]) => ({
  id, title, description: '', prompt, kind, model, categories: [category], collections: [collection],
  thumbnail_url: asset ? `${import.meta.env.BASE_URL}onelaunch-templates/${asset}` : null,
  video_url: null, source_url: null, author: 'ONEFLOW', published_at: null,
  imported_at: '2026-09-07T00:00:00Z', popularity: null, aspect_ratio: kind === 'video' ? '16:9' : '1:1',
  license: null, license_url: null, source_repo: null, source_commit: null,
}));
export async function getCatalog(query: CatalogQuery, demo: boolean, signal: AbortSignal): Promise<CatalogPage> {
  if (demo) {
    const values = (key: 'model' | 'categories' | 'collections') => [...new Set(DEMO_PROMPTS.flatMap(p => p[key]))].sort();
    const items = DEMO_PROMPTS.filter(p =>
      (!query.kind || p.kind === query.kind) && (!query.model || p.model === query.model) &&
      (!query.category || p.categories.includes(query.category)) && (!query.collection || p.collections.includes(query.collection)) &&
      (query.ids === null || query.ids.includes(p.id)) &&
      `${p.title} ${p.description} ${p.prompt} ${p.categories.join(' ')}`.toLowerCase().includes(query.query.toLowerCase()));
    return { items: items.slice(query.offset, query.offset + PAGE_SIZE), total: items.length,
      facets: { models: values('model'), categories: values('categories'), collections: values('collections') } };
  }
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error('Catalog configuration missing');
  const response = await fetch(`${base}/rest/v1/rpc/search_trends`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ p_query: query.query, p_kind: query.kind, p_model: query.model,
      p_category: query.category, p_collection: query.collection, p_sort: query.sort,
      p_offset: query.offset, p_limit: PAGE_SIZE, p_ids: query.ids }),
  });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data?.items) || !data?.facets || typeof data.total !== 'number') throw new Error('Invalid catalog response');
  return data as CatalogPage;
}
