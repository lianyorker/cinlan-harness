/** Host routes for recorded turn changes and the static guidance for clickable final-response file references. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerChangesRoutes } from './changes-routes.ts'
import { registerPresentOpen } from './present-open.ts'

/** Services required for the model guidance paired with the browser renderer. */
export const inject = ['systemPrompt', 'connection', 'workspaceChanges', 'sessionQuery', 'sessionController', 'executionBindings']

/** Stable final-response guidance owned by the matching renderer. */
const FILE_REFERENCE_PROMPT = 'When you successfully create or modify files, mention the primary outputs in your final response. '
  + 'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/**
 * Register model guidance for the file-reference renderer shipped by this package.
 * @param ctx - host context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  registerChangesRoutes(ctx)
  registerPresentOpen(ctx)
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: ctx.systemPrompt.getSectionOrder('DELIVERABLE_FILE_REFERENCES'),
    text: FILE_REFERENCE_PROMPT,
  })
}
