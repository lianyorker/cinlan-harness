/** Session-scoped terminal Remote controller for Web clients. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  TerminalError,
  TerminalSessionId as TerminalServiceSessionId,
  type TerminalSessionService,
  type TerminalSessionSnapshot,
  type TerminalSpawnResult,
} from '@deepseek-ai/dsh-terminal'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TerminalKillRequest,
  TerminalKillValue,
  TerminalListRequest,
  TerminalListValue,
  TerminalReadRequest,
  TerminalReadValue,
  TerminalSendRequest,
  TerminalSendValue,
  TerminalSessionId,
  TerminalSessionStatus,
  TerminalSignalRequest,
  TerminalSignalValue,
  TerminalSpawnRequest,
  TerminalSpawnValue,
  TerminalView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host terminal Remote namespace owner. */
    terminalController: TerminalController
  }
}

/** Host service backing the generated `ctx.remote.terminals` namespace. */
export class TerminalController extends TypertRemoteService {
  static inject = ['typert', 'agents']

  /** @param ctx - Host context containing the Agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'terminalController', { namespace: 'terminals' })
  }

  /**
   * List all terminals owned by one session's agent.
   * @param request - session identity.
   * @param signal - cancellation.
   * @returns terminal snapshots in publication order.
   */
  @Remote
  async list(request: TerminalListRequest, signal: AbortSignal): Promise<TerminalListValue> {
    void signal
    const agent = this.getSessionAgent(request.sessionId)
    const terminals = this.service()
    const snapshots = terminals.list(agent)
    return { terminals: snapshots.map(snapshot => this.projectSnapshot(snapshot)) }
  }

  /**
   * Spawn a new terminal session owned by the agent.
   * @param request - session identity and terminal spawn parameters.
   * @param signal - cancellation of unpublished setup.
   * @returns published terminal identity and initial output.
   */
  @Remote
  async spawn(request: TerminalSpawnRequest, signal: AbortSignal): Promise<TerminalSpawnValue> {
    const agent = this.getSessionAgent(request.sessionId)
    const terminals = this.service()
    try {
      const result = await terminals.spawn(agent, {
        type: request.type,
        ...request.name !== undefined ? { name: request.name } : {},
        ...request.cwd !== undefined ? { cwd: request.cwd } : {},
      }, signal)
      return this.projectSpawnResult(result)
    } catch (error) {
      throw this.mapError(request.sessionId, error)
    }
  }

  /**
   * Send input to a terminal and await readiness.
   * @param request - terminal identity and input text.
   * @param signal - cancellation of the send operation.
   * @returns settled output and wait reason.
   */
  @Remote
  async send(request: TerminalSendRequest, signal: AbortSignal): Promise<TerminalSendValue> {
    const agent = this.getSessionAgent(request.sessionId)
    const terminals = this.service()
    const terminalSessionId = this.unmapTerminalId(request.terminalSessionId)
    try {
      const operation = terminals.startSend(agent, terminalSessionId, {
        text: request.text,
        submit: request.submit,
        signal,
      })
      const result = await operation.done
      return {
        viewport: result.viewport,
        waitReason: result.waitReason,
        sessionStatus: this.projectStatus(result.sessionStatus),
        truncated: result.truncated,
      }
    } catch (error) {
      throw this.mapError(request.sessionId, error, request.terminalSessionId)
    }
  }

  /**
   * Read terminal scrollback.
   * @param request - terminal identity and optional page parameters.
   * @param signal - cancellation.
   * @returns bounded scrollback page.
   */
  @Remote
  async read(request: TerminalReadRequest, signal: AbortSignal): Promise<TerminalReadValue> {
    void signal
    const agent = this.getSessionAgent(request.sessionId)
    const terminals = this.service()
    const terminalSessionId = this.unmapTerminalId(request.terminalSessionId)
    try {
      const result = terminals.read(agent, terminalSessionId, {
        ...request.offset !== undefined ? { offset: request.offset } : {},
        ...request.count !== undefined ? { count: request.count } : {},
      })
      return {
        text: result.text,
        totalLines: result.totalLines,
        lineBegin: result.lineBegin,
        lineEnd: result.lineEnd,
        truncated: result.truncated,
      }
    } catch (error) {
      throw this.mapError(request.sessionId, error, request.terminalSessionId)
    }
  }

  /**
   * Signal a terminal's foreground process group.
   * @param request - terminal identity and signal name.
   * @param signal - cancellation.
   * @returns delivered process group identity.
   */
  @Remote
  async signal(request: TerminalSignalRequest, signal: AbortSignal): Promise<TerminalSignalValue> {
    void signal
    const agent = this.getSessionAgent(request.sessionId)
    const terminals = this.service()
    const terminalSessionId = this.unmapTerminalId(request.terminalSessionId)
    try {
      const result = await terminals.signal(agent, terminalSessionId, request.signal)
      return {
        delivered: result.delivered,
        targetPgid: result.targetPgid,
      }
    } catch (error) {
      throw this.mapError(request.sessionId, error, request.terminalSessionId)
    }
  }

  /**
   * Close a terminal and await quiescent cleanup.
   * @param request - terminal identity.
   * @param signal - cancellation.
   * @returns whether the terminal was newly closed.
   */
  @Remote
  async kill(request: TerminalKillRequest, signal: AbortSignal): Promise<TerminalKillValue> {
    void signal
    const agent = this.getSessionAgent(request.sessionId)
    const terminals = this.service()
    const terminalSessionId = this.unmapTerminalId(request.terminalSessionId)
    try {
      const closed = await terminals.kill(agent, terminalSessionId, 'Remote request')
      return { closed }
    } catch (error) {
      throw this.mapError(request.sessionId, error, request.terminalSessionId)
    }
  }

  private service(): TerminalSessionService {
    const terminals = this.ctx.get('terminals')
    if (terminals === undefined) {
      throw new RemoteError('terminal/unavailable', 'Terminal service is not available in this composition', {})
    }
    return terminals
  }

  private getSessionAgent(sessionId: SessionId): Agent {
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'terminal/session-not-live',
        `session "${sessionId}" is not live`,
        { sessionId },
      )
    }
    return agent
  }

  private unmapTerminalId(terminalSessionId: TerminalSessionId): TerminalServiceSessionId {
    return TerminalServiceSessionId(terminalSessionId as string)
  }

  private projectSnapshot(snapshot: TerminalSessionSnapshot): TerminalView {
    return {
      terminalSessionId: snapshot.sessionId as unknown as TerminalSessionId,
      ...snapshot.name !== undefined ? { name: snapshot.name } : {},
      type: snapshot.type,
      ...snapshot.pid !== undefined ? { pid: snapshot.pid } : {},
      status: this.projectStatus(snapshot.status),
    }
  }

  private projectSpawnResult(result: TerminalSpawnResult): TerminalSpawnValue {
    return {
      terminalSessionId: result.sessionId as unknown as TerminalSessionId,
      ...result.name !== undefined ? { name: result.name } : {},
      type: result.type,
      ...result.pid !== undefined ? { pid: result.pid } : {},
      status: this.projectStatus(result.status),
      motd: result.motd,
    }
  }

  private projectStatus(status: TerminalSessionSnapshot['status']): TerminalSessionStatus {
    if (status.kind === 'running') return { kind: 'running' }
    return {
      kind: 'exited',
      exitCode: status.exitCode,
      signal: status.signal,
    }
  }

  private mapError(
    sessionId: SessionId,
    error: unknown,
    terminalSessionId?: TerminalSessionId,
  ): RemoteError {
    if (error instanceof TerminalError) {
      switch (error.code) {
        case 'NO_BACKEND':
          return new RemoteError(
            'terminal/no-backend',
            error.message,
            { sessionId, type: error.message.match(/"([^"]+)"/)?.[1] ?? 'unknown' },
          )
        case 'DUPLICATE_NAME': {
          const name = error.message.match(/"([^"]+)"/)?.[1] ?? 'unknown'
          return new RemoteError('terminal/duplicate-name', error.message, { sessionId, name })
        }
        case 'NO_SESSION':
          if (terminalSessionId !== undefined) {
            return new RemoteError(
              'terminal/not-found',
              error.message,
              { sessionId, terminalSessionId },
            )
          }
          break
        case 'SEND_ACTIVE':
          if (terminalSessionId !== undefined) {
            return new RemoteError(
              'terminal/send-active',
              error.message,
              { sessionId, terminalSessionId },
            )
          }
          break
        case 'OWNER_NOT_LIVE':
        case 'FOREIGN_SESSION':
          return new RemoteError('terminal/session-not-live', error.message, { sessionId })
        case 'SERVICE_DISPOSING':
          return new RemoteError('terminal/unavailable', error.message, {})
      }
    }
    throw error
  }
}

export default TerminalController
