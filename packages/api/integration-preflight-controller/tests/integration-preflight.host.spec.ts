import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import IntegrationPreflightController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  return { ctx, controller: new IntegrationPreflightController(ctx), signal: new AbortController().signal }
}

describe('Integration preflight readiness', () => {
  it('reports not-configured when GITEE_TOKEN is not set', async () => {
    const { controller, signal } = bench()
    vi.stubEnv('GITEE_TOKEN', '')
    const result = await controller.check({ provider: 'gitee' }, signal)
    expect(result).toEqual({ provider: 'gitee', status: 'not-configured', reason: 'token-not-set', account: null })
    vi.unstubAllEnvs()
  })

  it('honours cancellation before the probe starts', async () => {
    const { controller } = bench()
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(controller.check({ provider: 'github' }, abort.signal)).rejects.toThrow('cancelled')
  })

  it('returns a snapshot with the requested provider', async () => {
    const { controller, signal } = bench()
    vi.stubEnv('GITEE_TOKEN', 'fake-token-for-test')
    const result = await controller.check({ provider: 'gitee' }, signal)
    expect(result.provider).toBe('gitee')
    expect(result.status).toBeDefined()
    vi.unstubAllEnvs()
  })
})
