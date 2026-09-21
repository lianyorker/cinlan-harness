import { Context, getTraceable, symbols } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import NodeRuntime from '../src/index.ts'

/** Provide the minimal capability names required to construct NodeRuntime. */
function provideCapabilityStubs(ctx: Context, defaultMode: 'read-only' | 'danger-full-access'): void {
  ctx.provide('fs', {} as never)
  ctx.provide('subprocess', {} as never)
  ctx.provide('sandbox', {} as never)
  ctx.provide('sandboxPolicy', {
    defaultMode,
    resolve: () => ({ mode: defaultMode, workspaceRoot: process.cwd() }),
  } as never)
}

describe('NodeRuntime execution context', () => {
  it('keeps its provider context when Cordis shadows a runtime method', async () => {
    const host = new Context()
    onTestFinished(async () => { await host.fiber.dispose() })
    provideCapabilityStubs(host, 'danger-full-access')
    const remote = host.isolate('sandboxPolicy').extend({ [symbols.shadow]: host })
    remote.provide('sandboxPolicy', {
      defaultMode: 'read-only',
      resolve: () => ({ mode: 'read-only', workspaceRoot: process.cwd() }),
    } as never)
    const runtimeService = new NodeRuntime(remote, {
      timeoutMs: 120_000,
      maxTimeoutMs: 600_000,
      maxOutputBytes: 67_108_864,
      maxOldGenerationSizeMb: 512,
      maxMessageBytes: 134_217_728,
      maxPendingCalls: 128,
      graceMs: 3_000,
      nodeExecutable: process.execPath,
    })
    const runtime = getTraceable(host, runtimeService)
    if (runtime === undefined) throw new Error('Node PTC runtime did not load')
    expect(runtime.sandboxMode).toBe('read-only')
  })
})
