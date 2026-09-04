// Defensive coercion for raw AI JSON — the OpenAI Structured-Outputs path already enforces the
// schema strictly, but the Electron mirror only asks nicely, and neither transport is worth
// trusting blindly on the client. Same clamp/default philosophy as evaluate-creative's
// extractJson handling: never let a malformed field crash the UI, never silently invent plausible
// data either — just fall back to an empty/neutral value.

export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function arrOf<T>(v: unknown, mapItem: (item: unknown) => T): T[] {
  return Array.isArray(v) ? v.map(mapItem) : [];
}

export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Resolves an id the model claims against a set of ids we actually issued; falls back safely. */
export function resolveId(claimed: unknown, knownIds: string[], fallback = ''): string {
  return typeof claimed === 'string' && knownIds.includes(claimed) ? claimed : (knownIds[0] ?? fallback);
}
