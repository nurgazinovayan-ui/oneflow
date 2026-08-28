import { useLanguageStore, ru, en } from './i18n';

// Electron IPC wraps rejections as "Error invoking remote method 'x': Error: <message>",
// and Replicate's own safety-filter rejections read as raw English stack traces — both are
// confusing to show directly in the node UI, so translate/clean them up here. Reads the
// language store directly (via getState(), not the useT() hook) since this is a plain
// function called from event handlers, not a component.
export function formatGenerationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const t = useLanguageStore.getState().language === 'en' ? en : ru;

  if (/rate.?limit|high demand|currently unavailable/i.test(raw)) {
    return t.errors.modelOverloaded;
  }

  if (/flagged as sensitive|content policy|moderation|nsfw/i.test(raw)) {
    return t.errors.contentFlagged;
  }

  if (/API key is not set/i.test(raw)) {
    return t.errors.apiKeyMissing;
  }

  return (
    raw
      .replace(/^Error invoking remote method '[^']*':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim() || raw
  );
}
