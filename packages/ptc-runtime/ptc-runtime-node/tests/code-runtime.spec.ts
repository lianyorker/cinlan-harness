import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunFailure, PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import PtcCodeRuntime from '../src/code-runtime.ts'

class StubRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'process'
  resolve = vi.fn((request: PtcRunRequest): PtcRunSpec => ({ ...request, cwd: request.cwd!, timeoutMs: 120_000 }))
  run = vi.fn<(spec: PtcRunSpec) => Promise<PtcRunResult>>(async () => ({ logs: [] }))
}

async function setup() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'read-only', workspaceRoot: process.cwd() })
  const provider = await ctx.plugin(StubRuntime)
  const runtime = ctx.ptcRuntime as StubRuntime
  const fiber = await ctx.plugin(PtcCodeRuntime)
  return { ctx, runtime, adapter: ctx.codeRuntime, fiber, provider }
}

it('delegates agentless programs and bindings using deployment policy and returns only CodeRuntime fields', async () => {
  const { ctx, runtime, adapter } = await setup()
  const bindings = [{ global: 'tools', functions: { echo: async () => 42 } }]
  runtime.run.mockResolvedValue({ logs: ['ready'], value: { n: 42 }, sandbox: { mode: 'read-only', denied: false } })
  expect(adapter.language).toBe('typescript')
  expect(adapter.isolation).toBe('process')
  expect(await adapter.run({ program: 'return await tools.echo({})', bindings })).toEqual({ logs: ['ready'], value: { n: 42 } })
  const request = runtime.resolve.mock.calls[0]![0]
  expect(request).toMatchObject({ program: 'return await tools.echo({})', cwd: process.cwd(), sandboxPolicy: ctx.sandboxPolicy.resolve() })
  expect(request.bindings).toBe(bindings)
  expect(runtime.run.mock.calls[0]![0]).toBe(runtime.resolve.mock.results[0]!.value)
})

it('selects the initiating session workspace and standing policy before resolving execution', async () => {
  const { ctx, runtime, adapter } = await setup()
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create(SessionId('ptc-adapter-session'), { meta: { cwd: join(process.cwd(), 'session-workspace') } })
  setSandboxMode(session, 'workspace-write')
  const agent = { session } as Agent
  await ctx.agents.withInitiator(agent, async () => {
    await adapter.run({ program: 'return 42', bindings: [] })
  })
  expect(runtime.resolve.mock.calls[0]![0]).toMatchObject({
    cwd: session.header.cwd,
    sandboxPolicy: { mode: 'workspace-write', workspaceRoot: session.header.cwd, sessionId: session.id },
  })
})

it.each<PtcRunFailure['kind']>(['exception', 'timeout', 'abort', 'worker-exit', 'invalid-output', 'output-limit', 'protocol', 'sandbox-unavailable'])(
  'preserves diagnostics for %s within the CodeRuntime failure union', async (kind) => {
    const { runtime, adapter } = await setup()
    runtime.run.mockResolvedValue({ logs: ['before failure'], error: { kind, message: 'exact diagnostic' }, sandbox: { mode: 'read-only', denied: true } })
    expect(await adapter.run({ program: '', bindings: [] })).toEqual({
      logs: ['before failure'],
      error: { kind: kind === 'protocol' || kind === 'sandbox-unavailable' ? 'worker-exit' : kind, message: 'exact diagnostic' },
    })
  },
)

it('propagates a caller abort signal to the PTC provider', async () => {
  const { runtime, adapter } = await setup()
  const caller = new AbortController()
  runtime.run.mockImplementation(async (spec) => {
    caller.abort('caller cancelled')
    expect(spec.signal?.aborted).toBe(true)
    return { logs: [], error: { kind: 'abort', message: String(spec.signal?.reason) } }
  })
  expect(await adapter.run({ program: '', bindings: [], signal: caller.signal })).toEqual({ logs: [], error: { kind: 'abort', message: 'caller cancelled' } })
})

it('aborts its calls and waits for provider cleanup when only the adapter unloads', async () => {
  const { ctx, runtime, adapter, fiber } = await setup()
  const entered = Promise.withResolvers<AbortSignal>()
  const aborted = Promise.withResolvers<undefined>()
  const cleaned = Promise.withResolvers<undefined>()
  runtime.run.mockImplementation(async (spec) => {
    const signal = spec.signal!
    signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    entered.resolve(signal)
    await cleaned.promise
    return { logs: [], error: { kind: 'abort', message: String(signal.reason) } }
  })
  const pending = adapter.run({ program: '', bindings: [] })
  const signal = await entered.promise
  let settled = false
  const disposal = fiber.dispose().then(() => { settled = true })
  try {
    await aborted.promise
    expect(signal.reason).toBe('code runtime adapter disposed')
    expect(settled).toBe(false)
  } finally {
    cleaned.resolve(undefined)
    await disposal
  }
  expect((await pending).error?.kind).toBe('abort')
  expect(ctx.get('codeRuntime')).toBeUndefined()
  expect(ctx.get('ptcRuntime')).toBeInstanceOf(StubRuntime)
  expect(runtime.run).toHaveBeenCalledOnce()
  await expect(adapter.run({ program: '', bindings: [] })).rejects.toThrow('after disposal')
})

it('preserves caller misuse rejection and still allows adapter disposal', async () => {
  const { runtime, adapter, fiber } = await setup()
  runtime.resolve.mockImplementationOnce(() => { throw new Error('invalid options') })
  await expect(adapter.run({ program: '', bindings: [] })).rejects.toThrow('invalid options')
  runtime.run.mockRejectedValueOnce(new Error('invalid binding'))
  await expect(adapter.run({ program: '', bindings: [] })).rejects.toThrow('invalid binding')
  await fiber.dispose()
})
