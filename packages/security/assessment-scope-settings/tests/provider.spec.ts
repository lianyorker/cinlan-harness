/** The Settings commit is the policy publication point; bindings never gain authority from later edits. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import StaticPolicy from '@deepseek-ai/dsh-assessment-scope-static'
import SettingsPolicy from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })
const root = {
  engagementId: 'fixture', grantId: 'grant', authorizationRef: 'written-fixture', notBefore: 0, expiresAt: 9e15,
  executionHostIds: ['host'], targets: [{ id: 'target', kind: 'hostname' as const, value: 'fixture.test' }],
  excludedTargetIds: [], actions: ['reconnaissance' as const], approvalRequiredActions: [], egress: [], credentials: [],
  evidence: { retainUntil: 9e15, minimumRedaction: 'none' as const, externalReporting: 'deny' as const },
}
async function bench() {
  const ctx = new Context()
  roots.push(ctx)
  const configure = vi.fn()
  ctx.provide('settings', { configure } as any)
  const policy = ctx.plugin(SettingsPolicy, { root })
  await policy.await()
  return { ctx, configure }
}

it('publishes root grant and configures settings with auto: false', async () => {
  const { ctx, configure } = await bench()
  expect(ctx.assessmentScope.rootGrant.targets[0]?.value).toBe('fixture.test')
  expect(configure).toHaveBeenCalledWith({ auto: false }, expect.anything())
})

it('keeps the static Provider usable without Settings', () => {
  const ctx = new Context()
  roots.push(ctx)
  const policy = new StaticPolicy(ctx, { root })
  expect(policy.rootGrant.targets[0]?.value).toBe('fixture.test')
})
