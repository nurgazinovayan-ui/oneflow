// The models Copywrite offers, all through the server's OpenRouter key. supabase/functions/
// generate-chat keeps the same list (COPYWRITE_MODELS) and refuses anything else; a reply is billed
// at the price OpenRouter reports for it. The edge test checks the two lists match.

export interface CopywriteModel {
  id: string;
  label: string;
  vendor: 'ChatGPT' | 'Claude';
}

export const COPYWRITE_MODELS: CopywriteModel[] = [
  { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', vendor: 'ChatGPT' },
  { id: 'openai/gpt-6.1-sol-pro', label: 'GPT-6.1 Sol Pro', vendor: 'ChatGPT' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', vendor: 'Claude' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', vendor: 'Claude' },
];

export const DEFAULT_COPYWRITE_MODEL = COPYWRITE_MODELS[0].id;

const STORAGE_KEY = 'oneflow-copywrite-model';

/** The person's last choice, or the default when there is none (or it is no longer offered). */
export function loadCopywriteModel(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && COPYWRITE_MODELS.some((m) => m.id === saved)) return saved;
  } catch {
    // storage unavailable — the default for this session
  }
  return DEFAULT_COPYWRITE_MODEL;
}

export function saveCopywriteModel(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // storage unavailable — the choice lasts until the page is reloaded
  }
}

export const copywriteModelLabel = (id: string | undefined): string | undefined => COPYWRITE_MODELS.find((m) => m.id === id)?.label;
