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

const egress = { protocol: 'https', host: 'fixture.test', port: 443, purpose: 'target-access', targetId: 'target' }
const credential = { ref: 'FIXTURE_REFERENCE', purpose: 'target-authentication', targetId: 'target' }

it('commits and clears advanced grants atomically without widening existing bindings', async () => {
  const ctx = await bench()
  const bound = ctx.assessmentScope.rootGrant
  await ctx.settings.mutate('assessment-scope', [
    { op: 'set', path: ['root', 'egress'], value: [egress] },
    { op: 'set', path: ['root', 'credentials'], value: [credential] },
  ], 0)
  expect(ctx.assessmentScope.rootGrant.egress).toEqual([egress])
  expect(ctx.assessmentScope.rootGrant.credentials).toEqual([credential])
  expect(ctx.assessmentScope.restore(bound)).toEqual(bound)
  const expanded = ctx.assessmentScope.rootGrant
  await ctx.settings.mutate('assessment-scope', [
    { op: 'set', path: ['root', 'egress'], value: [] }, { op: 'set', path: ['root', 'credentials'], value: [] },
  ], 1)
  expect(ctx.assessmentScope.rootGrant.egress).toEqual([])
  expect(ctx.assessmentScope.rootGrant.credentials).toEqual([])
  expect(() => ctx.assessmentScope.restore(expanded)).toThrow()
})

it.each([
  ['unknown egress target', 'egress', [{ ...egress, targetId: 'unknown' }]],
  ['unknown credential target', 'credentials', [{ ...credential, targetId: 'unknown' }]],
  ['duplicate egress', 'egress', [egress, egress]],
  ['duplicate credentials', 'credentials', [credential, credential]],
  ['invalid port', 'egress', [{ ...egress, port: 65536 }]],
  ['unsupported protocol', 'egress', [{ ...egress, protocol: 'ftp' }]],
  ['unsupported egress purpose', 'egress', [{ ...egress, purpose: 'target-authentication' }]],
  ['unsupported credential purpose', 'credentials', [{ ...credential, purpose: 'target-access' }]],
  ['inline credential value', 'credentials', [{ ...credential, value: 'non-secret-invalid-fixture' }]],
  ['invalid reference grammar', 'credentials', [{ ...credential, ref: 'invalid-reference' }]],
] as const)('rejects %s without committing other fields', async (_name, field, values) => {
  const ctx = await bench()
  const initial = ctx.assessmentScope.rootGrant
  await expect(ctx.settings.mutate('assessment-scope', [
    { op: 'set', path: ['root', 'grantId'], value: 'must-not-commit' },
    { op: 'set', path: ['root', field], value: values.map(value => ({ ...value })) },
  ], 0)).rejects.toThrow()
  expect(ctx.assessmentScope.rootGrant).toEqual(initial)
})
