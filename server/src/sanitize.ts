// C0/C1 control characters, zero-width characters and bidi overrides/isolates.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Removes control/invisible characters and angle brackets, collapses whitespace.
 * Stripping `<` and `>` also guarantees user text can never reproduce the prompt delimiters.
 */
export function sanitizeText(input: string): string {
  return input.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

/** Truncates to at most `max` UTF-16 code units without splitting a surrogate pair. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  let cut = input.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}
