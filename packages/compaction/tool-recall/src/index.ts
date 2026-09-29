/**
 * Model-facing history_read and history_search recall tools over compacted session logs.
 * @module @deepseek-ai/dsh-tool-recall
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  Config,
  DEFAULT_READ_BUDGET_CHARS,
  DEFAULT_SEARCH_LIMIT,
  type HistorySearchMatch,
} from './types.ts'
import { RecallError } from './errors.ts'
import {
  findCompletedCheckpoints,
  getShadowedMessages,
  resolveCheckpoint,
} from './transcript.ts'

export type * from './types.ts'
export { Config } from './types.ts'
export * from './errors.ts'
export * from './transcript.ts'

/** Cordis plugin name. */
export const name = 'tool-recall'

/** Required capability services. */
export const inject = ['tools', 'systemPrompt']

const PROMPT_TEXT =
  'When context has been compacted, earlier conversation history is preserved in checkpoints indicated by footer markers. '
  + 'Use `history_read` to retrieve the original messages of any checkpoint when exact details, commands, code snippets, or user instructions are needed. '
  + 'Use `history_search` to find specific keywords or error strings across all compacted history.'

/**
 * Register `history_read` and `history_search` tools along with their system prompt guidance.
 * @param ctx - registrant Cordis context.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const readBudget = config.readBudgetChars ?? DEFAULT_READ_BUDGET_CHARS
  const defaultLimit = config.searchLimit ?? DEFAULT_SEARCH_LIMIT

  ctx.systemPrompt.section({
    name: 'tool:recall',
    order: ctx.systemPrompt.getSectionOrder('TOOL_RECALL'),
    text: PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'history_read',
    description:
      'Retrieve the full transcript of original messages shadowed by a compaction checkpoint. '
      + 'Output includes original user prompts, assistant turns, and tool results, paginated when long. '
      + 'Provide the checkpoint ID (e.g. "c42") found in checkpoint footers.',
    parameters: {
      checkpoint: {
        type: 'string',
        required: true,
        description: 'The checkpoint ID (e.g. "c42") whose shadowed span to retrieve.',
      },
      offset: {
        type: 'integer',
        description: '0-based message offset for paginating long transcripts.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          checkpoint: { type: 'string', required: true },
          transcript: { type: 'string', required: true },
          nextOffset: { type: 'integer' },
          totalMessages: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.transcript + (value.nextOffset !== undefined ? `\n\n[Continuation cursor: offset=${value.nextOffset}]` : ''),
      }],
    },
    execute(args, exec) {
      if (!exec.agent) {
        throw new RecallError('history_read requires an owning agent session', 'NON_AGENT_CALLER')
      }
      const offset = args.offset ?? 0
      if (offset < 0) {
        throw new RecallError('offset must be a non-negative integer', 'INVALID_OFFSET')
      }
      const session = exec.agent.session
      const resolved = resolveCheckpoint(session, args.checkpoint)
      const allMessages = getShadowedMessages(session, resolved)

      if (offset >= allMessages.length) {
        return Promise.resolve({
          checkpoint: resolved.id,
          transcript: '(no further messages in this checkpoint span)',
          totalMessages: allMessages.length,
        })
      }

      const paged: string[] = []
      let accumulatedChars = 0
      let nextOffset: number | undefined

      for (let i = offset; i < allMessages.length; i++) {
        // oxlint-disable-next-line typescript/no-non-null-assertion
        const msg = allMessages[i]!
        const msgLen = msg.length + 2 // +2 for newlines
        // Always include at least one message even if it exceeds the budget alone
        if (paged.length > 0 && accumulatedChars + msgLen > readBudget) {
          nextOffset = i
          break
        }
        paged.push(msg)
        accumulatedChars += msgLen
      }

      return Promise.resolve({
        checkpoint: resolved.id,
        transcript: paged.join('\n\n'),
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        totalMessages: allMessages.length,
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `Read history checkpoint ${args.checkpoint}`,
      kind: 'other',
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'history_search',
    description:
      'Search across all compacted history spans for exact keywords, error strings, configuration flags, or paths. '
      + 'Performs a case-insensitive literal scan and returns matching snippets tagged with checkpoint IDs.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'The literal string to search for across shadowed conversation spans.',
      },
      checkpoint: {
        type: 'string',
        description: 'Optional specific checkpoint ID to restrict the search to.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum matching occurrences to return (defaults to 25).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                checkpoint: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
              },
            },
          },
          scanned: { type: 'integer', required: true },
          matched: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const lines: string[] = []
        lines.push(`Found ${value.matched} match(es) across ${value.scanned} checkpoint(s)${value.truncated ? ' (results truncated)' : ''}:`)
        for (const match of value.matches) {
          lines.push(`[${match.checkpoint}] ${match.snippet}`)
        }
        if (value.hint) {
          lines.push(`\nHint: ${value.hint}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute(args, exec) {
      if (!exec.agent) {
        throw new RecallError('history_search requires an owning agent session', 'NON_AGENT_CALLER')
      }
      const query = args.query.trim()
      if (query.length === 0) {
        throw new RecallError('search query must be a non-empty string', 'INVALID_ARGUMENT')
      }
      const session = exec.agent.session
      const limit = args.limit ?? defaultLimit
      const checkpoints = args.checkpoint !== undefined
        ? [resolveCheckpoint(session, args.checkpoint)]
        : findCompletedCheckpoints(session)

      const matches: HistorySearchMatch[] = []
      let totalMatched = 0
      const queryLower = query.toLowerCase()

      for (const checkpoint of checkpoints) {
        const messages = getShadowedMessages(session, checkpoint)
        for (const message of messages) {
          const lines = message.split('\n')
          for (const line of lines) {
            if (line.toLowerCase().includes(queryLower)) {
              totalMatched++
              if (matches.length < limit) {
                matches.push({
                  checkpoint: checkpoint.id,
                  snippet: line.trim(),
                })
              }
            }
          }
        }
      }

      const truncated = totalMatched > matches.length
      const hint = totalMatched === 0
        ? 'Zero matches found. Note: history_search performs a literal case-insensitive scan. If searching for semantic concepts or paraphrased text, use `history_read` with a plausible checkpoint ID to inspect the transcript directly.'
        : undefined

      return Promise.resolve({
        matches,
        scanned: checkpoints.length,
        matched: totalMatched,
        truncated,
        ...(hint ? { hint } : {}),
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `Search history for "${args.query}"`,
      kind: 'other',
      rawInput: args,
    }),
  }))
}
