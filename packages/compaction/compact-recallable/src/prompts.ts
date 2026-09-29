/**
 * Summarization instructions and preambles for index stubs and state checkpoint.
 *
 * @module @deepseek-ai/dsh-compact-recallable/prompts
 */

/** Preamble attached to the active working-memory state checkpoint. */
export const STATE_CHECKPOINT_PREAMBLE =
  'This is an automatically generated working-memory checkpoint condensing earlier conversation history. '
  + 'Treat the captured context as established background and build on it without restating it. '
  + 'Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/** Prompt delivered to summarize the mutable state checkpoint. */
export const STATE_SUMMARIZATION_INSTRUCTION = [
  'You are now acting as the state compaction engine for this AI coding assistant.',
  'Condense the conversation into a structured working-memory checkpoint that lets another model continue the work with zero loss of essential context.',
  'Apply the merge-don\'t-restate rule: merge new progress and decisions into the prior state, mark completed tasks, update changing files, and keep still-active constraints.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where exact wording matters]",
  '',
  '## Key Technical Concepts & Decisions',
  '- [architectural patterns, frameworks, decisions and their non-obvious rationale]',
  '',
  '## Files and Code Modifications',
  '- [exact paths, what changed, key exports or signatures]',
  '',
  '## Errors and Fixes',
  '- [concrete error strings and exact resolutions]',
  '',
  '## Current State & Next Steps',
  '- [precisely what is in progress and the immediate next action]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, and configuration keys.',
  '- Capture user corrections and feedback faithfully.',
  '- Do NOT mention this summarization request or that context was compacted.',
  '- Do NOT append any footer; system code composes checkpoint footers.',
].join('\n')

/** Prompt delivered to produce a frozen index stub. */
export const INDEX_STUB_INSTRUCTION = [
  'You are creating a frozen index stub (~100–200 tokens) for this conversation chunk.',
  'An index stub serves as a permanent search and recall card for this specific historical span.',
  '',
  'Output EXACTLY:',
  '1. Two or three terse sentences summarizing the actions taken and results achieved in this chunk.',
  '2. A single line starting with "Keywords: " listing distinctive literal anchors (error strings, commands, file paths, identifiers, config flags) separated by semicolons.',
  '',
  'Rules:',
  '- Do NOT use markdown headers or bullet lists.',
  '- Focus on what is distinctive to this chunk; do not repeat earlier index directory entries.',
  '- Do NOT append any footer; system code composes checkpoint footers.',
].join('\n')
