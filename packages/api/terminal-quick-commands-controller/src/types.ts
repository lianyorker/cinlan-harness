/** Wire requests and results for the terminal quick-commands Remote. */
import type { QuickCommand, QuickCommandDraft, QuickCommandFailure, QuickCommandHostId, QuickCommandId } from '@deepseek-ai/dsh-terminal-quick-commands/types'

export type {
  QuickCommand, QuickCommandDraft, QuickCommandFailure, QuickCommandHostId, QuickCommandHostList, QuickCommandId,
} from '@deepseek-ai/dsh-terminal-quick-commands/types'

/** Request to list one host's commands. */
export interface QuickCommandListRequest {
  readonly hostId: QuickCommandHostId
}

/** Request to save a new command. */
export interface QuickCommandCreateRequest {
  readonly draft: QuickCommandDraft
}

/** Request to replace one command. */
export interface QuickCommandUpdateRequest {
  readonly id: QuickCommandId
  readonly draft: QuickCommandDraft
}

/** Request to delete one command. */
export interface QuickCommandRemoveRequest {
  readonly id: QuickCommandId
}

/** Complete browser-facing result of one quick-command operation. */
export interface QuickCommandWireResult {
  readonly ok: boolean
  readonly reason?: QuickCommandFailure | undefined
  readonly value?: QuickCommand | readonly QuickCommand[] | undefined
  readonly hosts?: readonly QuickCommandHostId[] | undefined
}
