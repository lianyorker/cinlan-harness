/** Terminal controller Remote tests with a real service subclass and deterministic backend doubles. */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import TerminalSessionService, {
  TerminalError,
  TerminalSessionId as TerminalServiceSessionId,
  type TerminalReadRequest,
  type TerminalReadResult,
  type TerminalSendOperation,
  type TerminalSendRequest,
  type TerminalSendResult,
  type TerminalSessionSnapshot,
  type TerminalSignal,
  type TerminalSignalResult,
  type TerminalSpawnRequest,
  type TerminalSpawnResult,
} from '@deepseek-ai/dsh-terminal'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TerminalController from '../src/index.ts'
import type {
  TerminalKillRequest,
  TerminalListRequest,
  TerminalSessionId,
  TerminalSendRequest as ClientTerminalSendRequest,
  TerminalSpawnRequest as ClientTerminalSpawnRequest,
} from '../src/types.ts'

describe('TerminalController', () => {
  let ctx: Context
  let agent: Agent
  let sessionId: SessionId
  let controller: TerminalController
  let fakeTerminals: FakeTerminalService

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(AgentRegistry)
    fakeTerminals = new FakeTerminalService(ctx)
    controller = new TerminalController(ctx)

    sessionId = brandString<SessionId>('session-test')
    agent = {
      id: sessionId,
      ctx,
      status: 'idle',
      session: { id: sessionId, header: { id: sessionId, version: 2, createdAt: 1, isSeeded: false }, events: [] },
    } as unknown as Agent
    ctx.agents.register(agent)
  })

  it('rejects when terminal service is unavailable', async () => {
    const freshCtx = new Context()
    await freshCtx.plugin(TypertRegistry)
    await freshCtx.plugin(AgentRegistry)
    const freshController = new TerminalController(freshCtx)
    const freshAgent = {
      id: sessionId,
      ctx: freshCtx,
      status: 'idle',
      session: { id: sessionId, header: { id: sessionId, version: 2, createdAt: 1, isSeeded: false }, events: [] },
    } as unknown as Agent
    freshCtx.agents.register(freshAgent)

    const request: TerminalListRequest = { sessionId }
    await expect(freshController.list(request, new AbortController().signal))
      .rejects.toThrow(/not available/)
  })

  it('rejects when session is not live', async () => {
    const coldSessionId = brandString<SessionId>('session-cold')
    const request: TerminalListRequest = { sessionId: coldSessionId }
    await expect(controller.list(request, new AbortController().signal))
      .rejects.toThrow(/not live/)
  })

  it('lists terminals for a live session', async () => {
    fakeTerminals.addSnapshot({
      sessionId: TerminalServiceSessionId('term-1'),
      type: 'pty',
      name: 'shell-1',
      pid: 1234,
      status: { kind: 'running' },
    })

    const result = await controller.list({ sessionId }, new AbortController().signal)
    expect(result.terminals).toHaveLength(1)
    expect(result.terminals[0]!.name).toBe('shell-1')
    expect(result.terminals[0]!.type).toBe('pty')
    expect(result.terminals[0]!.status.kind).toBe('running')
  })

  it('spawns a new terminal', async () => {
    const request: ClientTerminalSpawnRequest = { sessionId, type: 'pty', name: 'test-shell', cwd: '/test' }
    const result = await controller.spawn(request, new AbortController().signal)
    expect(result.name).toBe('test-shell')
    expect(result.type).toBe('pty')
    expect(result.motd).toBe('Welcome to test terminal')
    expect(fakeTerminals.spawnCalls).toBe(1)
  })

  it('maps duplicate name errors', async () => {
    fakeTerminals.throwOnSpawn = new TerminalError('duplicate', 'DUPLICATE_NAME')
    const request: ClientTerminalSpawnRequest = { sessionId, type: 'pty', name: 'test-shell' }
    await expect(controller.spawn(request, new AbortController().signal)).rejects.toThrow(/duplicate/)
  })

  it('sends input to a terminal', async () => {
    const terminalSessionId = TerminalServiceSessionId('term-1')
    fakeTerminals.addSnapshot({ sessionId: terminalSessionId, type: 'pty', status: { kind: 'running' } })
    const request: ClientTerminalSendRequest = {
      sessionId,
      terminalSessionId: terminalSessionId as unknown as TerminalSessionId,
      text: 'echo hello',
      submit: true,
    }
    const result = await controller.send(request, new AbortController().signal)
    expect(result.viewport).toBe('echo hello\noutput')
    expect(result.waitReason).toBe('inferred_idle')
    expect(result.sessionStatus.kind).toBe('running')
  })

  it('kills a terminal', async () => {
    const terminalSessionId = TerminalServiceSessionId('term-1')
    fakeTerminals.addSnapshot({ sessionId: terminalSessionId, type: 'pty', status: { kind: 'running' } })
    const request: TerminalKillRequest = {
      sessionId,
      terminalSessionId: terminalSessionId as unknown as TerminalSessionId,
    }
    const result = await controller.kill(request, new AbortController().signal)
    expect(result.closed).toBe(true)
    expect(fakeTerminals.killCalls).toBe(1)
  })
})

/** A service subclass keeps the controller test on the production service contract. */
class FakeTerminalService extends TerminalSessionService {
  private readonly snapshots: TerminalSessionSnapshot[] = []
  spawnCalls = 0
  killCalls = 0
  throwOnSpawn: Error | undefined

  addSnapshot(snapshot: TerminalSessionSnapshot): void { this.snapshots.push(snapshot) }

  override list(_owner: Agent): TerminalSessionSnapshot[] { return [...this.snapshots] }

  override async spawn(_owner: Agent, spec: TerminalSpawnRequest, _signal?: AbortSignal): Promise<TerminalSpawnResult> {
    this.spawnCalls++
    if (this.throwOnSpawn !== undefined) throw this.throwOnSpawn
    return {
      sessionId: TerminalServiceSessionId('term-new'),
      type: spec.type,
      ...(spec.name === undefined ? {} : { name: spec.name }),
      status: { kind: 'running' },
      motd: 'Welcome to test terminal',
    }
  }

  override startSend(_owner: Agent, _sessionId: ReturnType<typeof TerminalServiceSessionId>, request: TerminalSendRequest): TerminalSendOperation {
    const result: TerminalSendResult = {
      viewport: request.text + '\noutput',
      waitReason: 'inferred_idle',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }
    return {
      done: Promise.resolve(result),
      readOutput: () => ({ delta: '', truncated: false }),
      cancel: () => true,
    }
  }

  override read(_owner: Agent, _sessionId: ReturnType<typeof TerminalServiceSessionId>, _request: TerminalReadRequest = {}): TerminalReadResult {
    return { text: 'scrollback content', totalLines: 100, lineBegin: 0, lineEnd: 50, truncated: false }
  }

  override signal(_owner: Agent, _sessionId: ReturnType<typeof TerminalServiceSessionId>, _signal: TerminalSignal): Promise<TerminalSignalResult> {
    return Promise.resolve({ delivered: true, targetPgid: 1234 })
  }

  override async kill(_owner: Agent, _sessionId: ReturnType<typeof TerminalServiceSessionId>, _reason: string): Promise<boolean> {
    this.killCalls++
    return true
  }
}
