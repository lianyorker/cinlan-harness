/** Test-only preset whose scoped prompt proves the saved composition was mounted. */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'automation-integration-preset'
export const inject = ['systemPrompt']

/** Mount a deterministic model-visible preset marker. @param ctx - preset scope. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'automation-fixture', order: 0, text: 'Automation integration preset. Use only the supplied task.' })
}
