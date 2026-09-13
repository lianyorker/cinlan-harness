/** The Settings commit is the policy publication point; bindings never gain authority from later edits. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import StaticPolicy from '@deepseek-ai/dsh-assessment-scope-static'
import SettingsPolicy from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  private readonly data: Record<string, unknown> = {}
  get writable(): boolean { return true }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(this.data) }
  protected persist(ns: SettingsNamespace, value: Record<string, unknown>): Promise<void> {
    this.data[ns] = value
    return Promise.resolve()
  }
}
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
  const policy = ctx.plugin(SettingsPolicy, { root })
  expect(ctx.get('assessmentScope')).toBeUndefined()
  await ctx.plugin(MemorySettings).await()
  await policy.await()
  return ctx
}

it('publishes committed settings without waiting for an asynchronous watcher', async () => {
  const ctx = await bench()
  const bound = ctx.assessmentScope.rootGrant
  await ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'actions'], value: ['reconnaissance', 'report-download'] }], 0)
  expect(ctx.assessmentScope.rootGrant.actions).toEqual(['reconnaissance', 'report-download'])
  expect(ctx.assessmentScope.restore(bound).actions).toEqual(['reconnaissance'])
  await ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'actions'], value: [] }], 1)
  expect(() => ctx.assessmentScope.restore(bound)).toThrow()
})

it('rejects invalid and stale writes without changing root authority', async () => {
  const ctx = await bench()
  const initial = ctx.assessmentScope.rootGrant
  await expect(ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'expiresAt'], value: 0 }], 0)).rejects.toThrow()
  await expect(ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'grantId'], value: 'changed' }], 9)).rejects.toThrow()
  expect(ctx.assessmentScope.rootGrant).toEqual(initial)
})

it('keeps the static Provider usable without Settings', () => {
  const ctx = new Context()
  roots.push(ctx)
  const policy = new StaticPolicy(ctx, { root })
  expect(policy.rootGrant.targets[0]?.value).toBe('fixture.test')
})
