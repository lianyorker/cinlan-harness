/** Terminal quick-commands Remote adapter; the carrier authorizes callers. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-terminal-quick-commands'
import type {
  QuickCommandCreateRequest, QuickCommandHostList, QuickCommandListRequest, QuickCommandFailure,
  QuickCommandRemoveRequest, QuickCommandUpdateRequest, QuickCommandWireResult,
} from './types.ts'
export type * from './types.ts'
export type { QuickCommandHostList } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the durable terminal quick-commands Remote. */
    terminalQuickCommandsController: TerminalQuickCommandsController
  }
}

/** Read-write quick-command Remote over the durable per-host store; owns no PTYs. */
export class TerminalQuickCommandsController extends TypertRemoteService {
  static inject = ['typert', 'terminalQuickCommands']

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'terminalQuickCommandsController', { namespace: 'terminalQuickCommands' })
  }

  /**
   * List the commands bound to one execution host.
   * @param request - Host whose commands the caller will run.
   * @returns that host's commands with the addressable host ids; never another host's.
   */
  @Remote('list')
  list(request: QuickCommandListRequest): QuickCommandHostList {
    return this.ctx.terminalQuickCommands.list(request.hostId)
  }

  /**
   * Save a new command for one host.
   * @param request - Host, label, text and optional working directory.
   * @returns the stored command, or the failure reason.
   */
  @Remote('create')
  async create(request: QuickCommandCreateRequest): Promise<QuickCommandWireResult> {
    return wire(await this.ctx.terminalQuickCommands.create(request.draft))
  }

  /**
   * Replace one command's editable fields.
   * @param request - Stored id plus the replacement draft.
   * @returns the stored command, or the failure reason.
   */
  @Remote('update')
  async update(request: QuickCommandUpdateRequest): Promise<QuickCommandWireResult> {
    return wire(await this.ctx.terminalQuickCommands.update(request.id, request.draft))
  }

  /**
   * Delete one stored command.
   * @param request - Stored id.
   * @returns the removed command, or `unknown-command`.
   */
  @Remote('delete')
  async remove(request: QuickCommandRemoveRequest): Promise<QuickCommandWireResult> {
    return wire(await this.ctx.terminalQuickCommands.remove(request.id))
  }
}

/** Project the store's closed union onto the JSON wire result. */
function wire(result: { ok: true; value: unknown } | { ok: false; reason: string }): QuickCommandWireResult {
  if (result.ok) return { ok: true, value: result.value as QuickCommandWireResult['value'] }
  return { ok: false, reason: result.reason as QuickCommandFailure }
}

export default TerminalQuickCommandsController
