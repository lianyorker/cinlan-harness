/** One admitted automation's ordinary Agent lifetime, including cancellation and teardown. */
import type { Context } from '@deepseek-ai/cordis'
import { realpath } from 'node:fs/promises'
import { installModelSelection, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import type { AutomationRun } from './types.ts'
import { AutomationStore } from './store.ts'
import { outcomeStatus, runOutcome } from './outcome.ts'

/** Owns exactly one committed claim until the Agent and its owned work drain. */
export class AutomationExecution {
  private readonly abort = new AbortController()
  private handle: AgentHandle | undefined
  private cancelCause: 'user' | 'disposed' | undefined
  private enteredCreation = false
  private readonly persistence: Context['sessionPersistence']

  /** @param ctx - service owner, never a borrowed Agent initiator.
   * @param store - exclusively owned durable store.
   * @param run - already committed claim with immutable resolved inputs.
   * @param message - identified plugin-origin prompt allocated before the claim.
   * @param workspace - verified exact saved Workspace.
   * @param publish - post-commit observer notification.
   * @param failStorage - stop admission after a journal failure.
   */
  constructor(
    private readonly ctx: Context,
    private readonly store: AutomationStore,
    private readonly run: AutomationRun,
    private readonly message: UserMessage,
    private readonly workspace: Workspace,
    private readonly publish: () => void,
    private readonly failStorage: (error: unknown) => void,
  ) { this.persistence = ctx.sessionPersistence }

  /** Request ordinary Agent cancellation; completion waits for the public handle.
   * @param cause - user stop or owner teardown.
   */
  cancel(cause: 'user' | 'disposed'): void {
    this.cancelCause = cause
    this.abort.abort()
    this.handle?.agent.cancel({ kind: cause })
  }

  /** Drive the committed invocation and publish its terminal evidence after teardown. */
  async execute(): Promise<void> {
    let terminal: Pick<AutomationRun, 'status' | 'reason'> = { status: 'ambiguous', reason: 'dispatch-unconfirmed' }
    try {
      this.abort.signal.throwIfAborted()
      if (this.run.sessionId === null) throw new Error('admitted run has no Session identity')
      this.enteredCreation = true
      const spec = this.run.spec
      this.handle = await this.ctx.agents.create({
        sessionId: this.run.sessionId,
        signal: this.abort.signal,
        meta: { cwd: spec.workspacePath, agentPreset: spec.agentPresetId },
        agentOptions: spec.model,
        setup: async (agentCtx, agent) => {
          await this.ctx.agentPresets.mount(agentCtx, spec.agentPresetId)
          const permission = this.ctx.permissionPresets.resolve(spec.permissionPresetId)
          if (permission.sandbox !== spec.permission.sandbox || permission.approval !== spec.permission.approval) {
            throw new Error('saved permission preset changed during setup')
          }
          if (this.ctx.workspaceRegistry.get(spec.workspaceId)?.path !== spec.workspacePath
            || await realpath(spec.workspacePath) !== spec.workspacePath) throw new Error('saved workspace changed during setup')
          this.ctx.permissionPresets.set(agent.session, spec.permissionPresetId)
          installModelSelection(agentCtx, { current: spec.model, assembled: undefined })
          agentCtx.on('agent/inbox/claimed', ({ message, turn }) => {
            if (message.id !== this.message.id) return
            try {
              this.store.changeRun(this.run.id, { turn, updatedAt: Date.now() })
              this.publish()
            } catch (error: unknown) {
              this.cancel('disposed')
              this.failStorage(error)
            }
          })
        },
      })
      this.abort.signal.throwIfAborted()
      await this.workspace.attachSession(this.handle.agent.id)
      this.ctx.sessionTitle.rename(this.handle.agent.session, spec.title)
      if (!await this.ctx.sessions.flush(this.handle.agent.session)) throw new Error('automation Session has no durability listener')
      this.abort.signal.throwIfAborted()
      this.store.changeRun(this.run.id, { status: 'running', updatedAt: Date.now() })
      this.publish()
      this.handle.agent.followup(this.message)
      await this.handle.agent.whenIdle()
      if (!await this.ctx.sessions.flush(this.handle.agent.session)) throw new Error('automation Session has no durability listener')
      const receipt = this.store.run(this.run.id) ?? this.run
      const outcome = runOutcome(receipt, this.handle.agent.session.snapshotEvents())
      if (outcome !== undefined) terminal = { status: outcomeStatus(outcome), reason: outcome.kind }
    } catch (error: unknown) {
      if (this.cancelCause !== undefined && !this.enteredCreation) terminal = { status: 'cancelled', reason: this.cancelCause }
      else terminal = { status: 'ambiguous', reason: 'dispatch-unconfirmed' }
      this.ctx.logger.warn('automation invocation did not settle normally: %s', error instanceof Error ? error.message : String(error))
    } finally {
      try { await this.handle?.dispose() } catch (error: unknown) {
        terminal = { status: 'ambiguous', reason: 'teardown-unconfirmed' }
        this.ctx.logger.warn('automation Agent teardown failed: %s', error instanceof Error ? error.message : String(error))
      }
    }
    if (terminal.status === 'ambiguous' && terminal.reason !== 'teardown-unconfirmed' && this.enteredCreation) {
      terminal = await this.persistedOutcome() ?? terminal
    }
    const now = Date.now()
    try {
      this.store.changeRun(this.run.id, { ...terminal, updatedAt: now, finishedAt: now },
        terminal.status === 'ambiguous' || terminal.status === 'interrupted')
      this.publish()
    } catch (error: unknown) { this.failStorage(error) }
  }

  private async persistedOutcome(): Promise<Pick<AutomationRun, 'status' | 'reason'> | undefined> {
    if (this.run.sessionId === null) return undefined
    try {
      const log = await readColdSessionLog(this.persistence, this.run.sessionId)
      const outcome = runOutcome(this.store.run(this.run.id) ?? this.run, log.events)
      return outcome === undefined ? undefined : { status: outcomeStatus(outcome), reason: outcome.kind }
    } catch (error: unknown) {
      this.ctx.logger.warn('automation durable outcome is unavailable: %s', error instanceof Error ? error.message : String(error))
      return undefined
    }
  }
}
