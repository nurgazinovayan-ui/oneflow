// Parses the optional ```oneflow-suggestions fenced JSON block the assistant can emit at the
// end of a reply (see the system prompts in electron/main.ts / supabase/functions/generate-chat)
// so the chat UI can render quick-reply chips instead of making the user retype an obvious
// follow-up. Shared by AiAssistantPanel and TextWorkPanel.

const SUGGESTIONS_BLOCK_RE = /```oneflow-suggestions\s*([\s\S]*?)```/i;

export interface ParsedSuggestions {
  cleanedText: string;
  suggestions: string[] | null;
}

export function parseSuggestions(text: string): ParsedSuggestions {
  const match = SUGGESTIONS_BLOCK_RE.exec(text);
  if (!match) return { cleanedText: text, suggestions: null };

  const cleanedText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return { cleanedText, suggestions: null };
    const suggestions = parsed
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .slice(0, 4);
    return { cleanedText, suggestions: suggestions.length > 0 ? suggestions : null };
  } catch {
    return { cleanedText, suggestions: null };
  }
}
