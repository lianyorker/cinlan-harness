import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Error codes the knowledge base reports; route on these, never on messages. */
export type KnowledgeBaseErrorCode =
  | 'INDEX_FOREIGN'          // the index file belongs to another application
  | 'INVALID_CONFIG'         // rejected configuration
  | 'INVALID_SOURCE'         // unknown or unusable source reference
  | 'INVALID_QUERY'          // unusable search request
  | 'NOT_FOUND'              // unknown document or chunk
  | 'CLOSED'                 // service disposed

/**
 * Domain error for the knowledge base. Carries a stable code so tool results
 * and remote callers can branch without parsing the message.
 */
export class KnowledgeBaseError extends HarnessError {
  constructor(message: string, code: KnowledgeBaseErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'KnowledgeBaseError'
  }
}
