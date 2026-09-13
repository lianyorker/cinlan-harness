/** Read-only security composition status, with no model, device, or network effects. */
import { Context, FiberState } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SecurityResearchController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

function bench() {
  const ctx = new Context()
  roots.push(ctx)
  return { ctx, controller: new SecurityResearchController(ctx), signal: new AbortController().signal }
}

function configured(ctx: Context) {
  const grant = {
    targets: [{ id: 'private-target', value: 'private.invalid' }], actions: ['reconnaissance'],
    executionHostIds: ['private-host'], egress: [], credentials: [{ ref: 'private-reference' }],
    evidence: { minimumRedaction: 'sensitive', externalReporting: 'deny' },
    authorizationRef: 'private-authorization',
  }
  const status = vi.fn((): 'active' | 'expired' | 'not-yet-valid' => 'active')
  const list = vi.fn(async () => [{ id: 'security-research', trust: 'system', broken: undefined as string | undefined }])
  const snapshot = vi.fn(async () => ({ skills: [{ provider: 'security-skills' }, { provider: 'filesystem' }], complete: true }))
  const rows = ['security-skills', 'security-workflow-prompt', 'tool-finding'].map(name => ({
    disabled: false, options: { name: `@deepseek-ai/dsh-${name}` }, fiber: { state: FiberState.ACTIVE },
  }))
  ctx.provide('agentPresets', { list } as never)
  ctx.provide('assessmentScope', { rootGrant: grant, status } as never)
  ctx.provide('findings', {} as never)
  ctx.provide('artifacts', {} as never)
  ctx.provide('vulnKb', {} as never)
  ctx.provide('skills', { snapshot } as never)
  ctx.provide('loader', { entries: () => rows.values() } as never)
  return { grant, status, list, snapshot, rows }
}

describe('Security Research configuration status', () => {
  it('reports absent capabilities without loading a preset or external tools', async () => {
    const b = bench()
    const value = await b.controller.describe(b.signal)
    expect(value.status).toBe('not-configured')
    expect(value.preset).toEqual({ present: false })
    expect(value.scope.state).toBe('missing')
    expect(Object.values(value.components)).toEqual(Array(7).fill(false))
    expect(value.skillCount).toBe(0)
    expect(value.skillsComplete).toBe(false)
  })

  it('returns counts instead of target, host, credential, or authorization values', async () => {
    const b = bench()
    const f = configured(b.ctx)
    const value = await b.controller.describe(b.signal)
    expect(value).toMatchObject({ status: 'configured', skillCount: 1, skillsComplete: true,
      scope: { state: 'configured', targetCount: 1, actionCount: 1, executionHostCount: 1, credentialCount: 1 },
    })
    expect(JSON.stringify(value)).not.toContain('private-')
    expect(JSON.stringify(value)).not.toContain('private.invalid')
    expect(f.snapshot).toHaveBeenCalledWith({ signal: b.signal })
  })

  it.each(['targets', 'actions', 'executionHostIds'] as const)('keeps an empty %s inventory unconfigured', async (field) => {
    const b = bench()
    const f = configured(b.ctx)
    f.grant[field] = []
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'not-configured', scope: { state: 'empty' } })
  })

  it.each(['not-yet-valid', 'expired'] as const)('preserves the %s scope state', async (state) => {
    const b = bench()
    configured(b.ctx).status.mockReturnValue(state)
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'not-configured', scope: { state } })
  })

  it('does not mark a broken preset as configured or expose its diagnostic path', async () => {
    const b = bench()
    configured(b.ctx).list.mockResolvedValue([{ id: 'security-research', trust: 'system', broken: 'private-path' }])
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'attention', preset: { broken: 'preset-invalid' } })
  })

  it.each([FiberState.PENDING, FiberState.LOADING, FiberState.FAILED, FiberState.UNLOADING, FiberState.DISPOSED])(
    'does not treat fiber state %s as active', async (state) => {
      const b = bench()
      const f = configured(b.ctx)
      for (const row of f.rows) row.fiber.state = state
      expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'attention', components: { findingTools: false } })
    },
  )

  it('ignores disabled entries even if they have an active fiber', async () => {
    const b = bench()
    for (const row of configured(b.ctx).rows) row.disabled = true
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'attention', components: { securitySkills: false } })
  })

  it('reports incomplete, empty, and failed skill discovery as attention', async () => {
    const b = bench()
    const f = configured(b.ctx)
    f.snapshot.mockResolvedValueOnce({ skills: [{ provider: 'security-skills' }], complete: false })
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'attention', skillsComplete: false })
    f.snapshot.mockResolvedValueOnce({ skills: [], complete: true })
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'attention', skillCount: 0 })
    f.snapshot.mockRejectedValueOnce(new Error('private tool failure'))
    expect(await b.controller.describe(b.signal)).toMatchObject({ status: 'attention', skillsComplete: false })
  })

  it('honors cancellation before reads and after discovery without publishing a status', async () => {
    const b = bench()
    const f = configured(b.ctx)
    const abort = new AbortController()
    const reason = new Error('cancelled')
    f.snapshot.mockImplementationOnce(async () => { abort.abort(reason); return { skills: [], complete: true } })
    await expect(b.controller.describe(abort.signal)).rejects.toBe(reason)
    await expect(b.controller.describe(abort.signal)).rejects.toBe(reason)
    expect(f.list).toHaveBeenCalledTimes(1)
  })
})
