/** Model-facing search tools over the knowledge base service. */
import type { Context } from '@deepseek-ai/cordis'
import type { KnowledgeHit, KnowledgeDocument } from '@cinlan/knowledge-base'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const name = 'tool-knowledge-search'
export const inject = ['knowledgeBase', 'tools']

/** Tool defaults for result bounding. */
export interface Config {
  /** Maximum results per knowledge_search call (default `20`). */
  readonly maxLimit?: number
}

/** Schemastery validator; supplies the default when the row omits config. */
export const Config: z<Config> = z.object({
  maxLimit: z.number().default(20),
})

function present(title: string, kind: 'read' | 'execute'): GenericCallView {
  return { card: 'generic', title, kind }
}

function renderJson(value: JsonValue): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

export function apply(ctx: Context, config: Config = { maxLimit: 20 }): void {
  const maxLimit = config.maxLimit ?? 20
  if (!Number.isSafeInteger(maxLimit) || maxLimit < 1) {
    throw new Error('maxLimit must be a positive safe integer')
  }

  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: 'Search the knowledge base (indexed local documents) for paragraphs relevant to the query. Chinese and English queries both work; results are ordered by relevance with heading context. Use this before answering questions that may be covered by indexed documents.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query; terms are combined with AND.' },
      limit: { type: 'number', description: `Maximum hits to return (1-${maxLimit}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docId: { type: 'string', required: true },
                ordinal: { type: 'number', required: true },
                text: { type: 'string', required: true },
                heading: { type: 'string', required: true },
                title: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args) {
      const limit = args.limit === undefined ? maxLimit : Math.min(Math.trunc(args.limit), maxLimit)
      if (limit < 1) throw new Error('limit must be at least 1')
      const hits = ctx.knowledgeBase.search(args.query, { limit })
        .map((hit: KnowledgeHit) => ({
          docId: hit.docId,
          ordinal: hit.ordinal,
          text: hit.text,
          heading: hit.heading,
          title: hit.title,
        }))
      return Promise.resolve({ hits } satisfies JsonValue)
    },
    presentCall: args => present(`Search knowledge base: ${args.query}`, 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_list_documents',
    description: 'List every document currently indexed in the knowledge base, with path, title, and index time. Use it to see what the search covers.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          documents: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                docId: { type: 'string', required: true },
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                source: { type: 'string', required: true },
                indexedAt: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute() {
      const documents = ctx.knowledgeBase.listDocuments().map((document: KnowledgeDocument) => ({
        docId: document.docId,
        path: document.path,
        title: document.title,
        source: document.source,
        indexedAt: document.indexedAt,
      }))
      return Promise.resolve({ documents } satisfies JsonValue)
    },
    presentCall: () => present('List indexed knowledge documents', 'read'),
  }))
}
