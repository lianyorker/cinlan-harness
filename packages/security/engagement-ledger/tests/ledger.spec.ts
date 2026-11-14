import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  AssessmentGrantId,
  AssessmentTargetId,
  AssessmentEngagementId,
  type AssessmentGrant,
} from '@deepseek-ai/dsh-assessment-scope'
import {
  assertHostInGrant,
  cidrContains,
  CampaignStore,
  normalizeLedgerHost,
  targetMatchesHost,
} from '../src/index.ts'

const tmp = mkdtempSync(join(tmpdir(), 'engagement-ledger-spec-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function grantWith(targets: Array<{ kind: 'hostname' | 'ip-address' | 'url-prefix'; value: string }>, excluded: string[] = []): AssessmentGrant {
  const ids = targets.map((_, i) => AssessmentTargetId(`t${i}`))
  return Object.freeze({
    version: 1,
    engagementId: AssessmentEngagementId('e1'),
    grantId: AssessmentGrantId('g1'),
    authorizationRef: 'ref' as never,
    notBefore: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    executionHostIds: ['local' as never],
    targets: targets.map((t, i) => ({ id: ids[i], kind: t.kind, value: t.value })),
    excludedTargetIds: targets.flatMap((t, i) => excluded.includes(t.value) ? [ids[i]] : []),
    actions: ['reconnaissance', 'active-validation'],
    approvalRequiredActions: [],
    egress: [],
    credentials: [],
    evidence: { retainUntil: Number.MAX_SAFE_INTEGER, minimumRedaction: 'none', externalReporting: 'deny' },
  }) as AssessmentGrant
}

describe('ledger scope matching', () => {
  it('normalizes host variants', () => {
    expect(normalizeLedgerHost('HTTPS://Example.COM:8443/path?q=1')).toBe('example.com')
    expect(normalizeLedgerHost('10.0.0.1.')).toBe('10.0.0.1')
    expect(() => normalizeLedgerHost('   ')).toThrow()
  })

  it('matches exact, wildcard suffix, and CIDR targets', () => {
    expect(cidrContains('10.0.0.0/8', '10.1.2.3')).toBe(true)
    expect(cidrContains('10.0.0.0/8', '192.168.1.1')).toBe(false)
    const grant = grantWith([
      { kind: 'hostname', value: '*.corp.example' },
      { kind: 'ip-address', value: '10.0.0.0/8' },
      { kind: 'hostname', value: 'app.corp.example' },
    ])
    expect(targetMatchesHost(grant.targets[0]!, 'www.corp.example')).toBe(true)
    expect(targetMatchesHost(grant.targets[0]!, 'corp.example')).toBe(false)
    expect(targetMatchesHost(grant.targets[1]!, '10.2.3.4')).toBe(true)
    expect(() => assertHostInGrant('www.corp.example', grant)).not.toThrow()
    expect(() => assertHostInGrant('evil.example', grant)).toThrow(/outside the authorized scope/)
  })

  it('honors excluded target ids', () => {
    const grant = grantWith([{ kind: 'hostname', value: '*.corp.example' }], ['*.corp.example'])
    expect(() => assertHostInGrant('www.corp.example', grant)).toThrow(/excluded scope target/)
  })

  it('matches url-prefix targets by contained hostname', () => {
    const grant = grantWith([{ kind: 'url-prefix', value: 'https://portal.example.com/admin' }])
    expect(() => assertHostInGrant('portal.example.com', grant)).not.toThrow()
    expect(() => assertHostInGrant('other.example.com', grant)).toThrow()
  })
})

describe('campaign store', () => {
  const file = join(tmp, 'campaigns.json')

  it('creates, upserts, steps, advances and persists', () => {
    const store = new CampaignStore(file)
    const campaign = store.create({
      name: 'web test', objective: 'find admin data',
      scope: { targets: ['*.corp.example'], excluded: [] }, grantId: 'g1',
    })
    store.upsertAsset(campaign.id, 'www.corp.example', { port: 443, fingerprint: 'nginx/1.24' })
    store.addStep(campaign.id, { command: 'httpx -l hosts.txt', result: '3 live' })
    store.addAttempt(campaign.id, { asset: 'www.corp.example:443', kb: 'web-cms/x.md', outcome: 'hit' })
    const moved = store.advance(campaign.id)
    expect(moved.from).toBe('recon')
    expect(moved.to).toBe('fingerprint')

    const reloaded = new CampaignStore(file)
    const again = reloaded.get(campaign.id)
    expect(again.assets).toHaveLength(1)
    expect(again.steps).toHaveLength(1)
    expect(again.stage).toBe('fingerprint')
    expect(reloaded.progressOf(again)).toBeGreaterThan(0)
  })

  it('stops advancing at report and tracks stall rounds', () => {
    const store = new CampaignStore(file)
    const campaign = store.create({ name: 'x', objective: 'x', scope: { targets: ['a.b'], excluded: [] }, grantId: 'g1' })
    for (let i = 0; i < 7; i++) store.advance(campaign.id)
    expect(store.get(campaign.id).stage).toBe('report')
    const next = store.nextStep(campaign.id)
    expect(next.nextStage).toBe('report')
    store.noteRound(campaign.id, next.progress)
    store.noteRound(campaign.id, next.progress)
    expect(store.nextStep(campaign.id).stalled).toBe(true)
  })

  it('derives done criteria from the objective', () => {
    const store = new CampaignStore(file)
    const campaign = store.create({ name: 'x', objective: '拿到后台管理员数据', scope: { targets: ['a.b'], excluded: [] }, grantId: 'g1' })
    expect(store.criteriaOf(campaign).join(' ')).toContain('admin')
  })
})
