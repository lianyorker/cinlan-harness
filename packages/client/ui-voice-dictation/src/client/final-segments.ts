/** Spacing between a completed transcript and the current composer draft. */
const WORD = /^[\p{L}\p{N}]$/u
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u
const NO_SPACE_BEFORE = /^[,.;:!?%。，、！？；：）)\]}]$/u
const NO_SPACE_AFTER = /^[([{（《「『]$/u
const SPACE_AFTER = /^[,.;:!?%]$/u

/**
 * Prefix a separating space for adjacent words or a word after Latin punctuation.
 * Existing whitespace, CJK edges, closing punctuation, and opening brackets need no added space.
 * @param text - completed transcript, retained verbatim.
 * @param draft - current draft, retained verbatim by the caller.
 * @returns transcript with at most one prefixed space.
 */
export function formatFinalTranscriptSegment(text: string, draft: string): string {
  if (draft === '' || text === '' || /\s$/.test(draft) || /^\s/.test(text)) return text
  const previous = Array.from(draft).at(-1) as string
  const next = Array.from(text)[0] as string
  if (CJK.test(previous) || CJK.test(next) || NO_SPACE_BEFORE.test(next) || NO_SPACE_AFTER.test(previous)) return text
  return (WORD.test(previous) || SPACE_AFTER.test(previous)) && WORD.test(next) ? ` ${text}` : text
}
