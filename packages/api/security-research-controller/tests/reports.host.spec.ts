/** Local report authorization uses every exported target and the current immutable Session grant. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssessmentDecisionId, authorizeAssessmentOperation, canonicalizeAssessmentGrant } from '@deepseek-ai/dsh-assessment-scope'
import type { AssessmentSessionOperation } from '@deepseek-ai/dsh-assessment-scope-session'
import StaticPolicy from '@deepseek-ai/dsh-assessment-scope-static'
import { FindingCursor, FindingId, FindingRuleId, FindingTargetId } from '@deepseek-ai/dsh-finding'
import type { FindingQueryPage, FindingSnapshot } from '@deepseek-ai/dsh-finding'
import { SessionId } from '@deepseek-ai/dsh-session'
import Controller from '../src/index.ts'
import type { Config } from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })

function finding(targets = ['a']): FindingSnapshot {
  const ruleId = FindingRuleId('fixture')
  const targetIds = targets.map(FindingTargetId)
  return {
    id: FindingId('fixture'), revision: 1, fingerprint: 'fixture' as FindingSnapshot['fingerprint'],
    identity: { ruleId, targetIds, locations: [] }, ruleId, title: 'Fixture', summary: 'Local test',
    state: 'observation', severity: 'informational', confidence: 'high',
    targets: targetIds.map(id => ({ id, kind: 'host', displayName: String(id) })), locations: [],
    cweIds: [], cveIds: [], assumptions: [], reachability: { kind: 'unknown' }, evidence: [], provenance: [],
    occurrences: 1, createdAt: 0, updatedAt: 0,
  }
}

function bench(config: Config = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const controller = new Controller(ctx, config)
  const policy = new StaticPolicy(ctx, { root: {
    engagementId: 'fixture', grantId: 'root', authorizationRef: 'written-fixture', notBefore: 0, expiresAt: 9e15,
    executionHostIds: ['host'], targets: ['a', 'b'].map(id => ({ id, kind: 'hostname', value: id + '.test' })),
    excludedTargetIds: ['b'], actions: ['report-download'], approvalRequiredActions: [], egress: [], credentials: [],
    evidence: { retainUntil: 9e15, minimumRedaction: 'none', externalReporting: 'deny' },
  } })
  const session = { id: SessionId('live'), seq: 0 }
  const agent = { session }
  const get = vi.fn((): typeof agent | undefined => agent)
  const require = vi.fn(() => policy.rootGrant)
  const authorize = vi.fn((_session: unknown, operation: AssessmentSessionOperation) => policy.authorize(require(), {
    ...operation, at: Date.now(), grantId: policy.rootGrant.grantId, decisionId: AssessmentDecisionId('decision'),
  }))
  const query = vi.fn<() => Promise<FindingQueryPage>>().mockResolvedValue({ items: [] })
  const flush = vi.fn(async () => true)
  ctx.provide('agents', { get } as never)
  ctx.provide('executionHost', { current: () => ({ hostId: 'host' }) } as never)
  ctx.provide('assessmentScopeSessions', { require, authorize } as never)
  ctx.provide('findings', { query } as never)
  ctx.provide('sessions', { flush } as never)
  const signal = new AbortController().signal
  const request = { sessionId: session.id, format: 'json' as const }
  return { ctx, controller, session, policy, require, authorize, query, flush, get, request, signal }
}

describe('Security Research report exports', () => {
  it('keeps arbitrary data export and external reporting subject to exact egress grants', () => {
    const b = bench()
    const grant = canonicalizeAssessmentGrant({ ...b.policy.rootGrant, actions: ['report-download', 'data-export', 'external-reporting'] })
    for (const action of ['data-export', 'external-reporting'] as const) {
      const decision = authorizeAssessmentOperation(grant, { grantId: grant.grantId, decisionId: AssessmentDecisionId(action),
        targetId: grant.targets[0]!.id, executionHostId: grant.executionHostIds[0]!, action, at: Date.now(),
        evidence: { retainUntil: grant.evidence.retainUntil, redaction: 'none' } })
      expect(decision.code).toBe('ASSESSMENT_EGRESS_REQUIRED')
    }
  })

  it.each(['json', 'markdown', 'sarif'] as const)('returns complete %s bytes after a durable authorization checkpoint', async (format) => {
    const b = bench()
    b.query.mockResolvedValue({ items: [finding()] })
    const report = await b.controller.exportReport({ ...b.request, format }, b.signal)
    const data = Buffer.from(report.base64, 'base64')
    expect(report.bytes).toBe(data.byteLength)
    expect(report.findingCount).toBe(1)
    expect(data.toString()).toContain('Fixture')
    expect(b.authorize).toHaveBeenCalledWith(b.session, expect.objectContaining({
      action: 'report-download', targetId: 'a', executionHostId: 'host', evidence: { retainUntil: 9e15, redaction: 'none' },
    }))
    expect(b.flush).toHaveBeenCalledWith(b.session)
  })

  it('rejects a later excluded Finding target instead of checking only the first grant target', async () => {
    const b = bench()
    b.query.mockResolvedValue({ items: [finding(['a', 'b'])] })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/export-not-authorized' })
    expect(b.authorize.mock.calls.map(call => call[1].targetId)).toEqual(['a', 'b'])
  })

  it('rejects a Finding with no matching grant target', async () => {
    const b = bench()
    b.query.mockResolvedValue({ items: [finding(['foreign'])] })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/export-not-authorized' })
  })

  it('rejects approval-required decisions instead of treating a click as policy approval', async () => {
    const b = bench()
    b.authorize.mockImplementation((_, op) => ({ ...b.policy.authorize(b.policy.rootGrant, {
      ...op, grantId: b.policy.rootGrant.grantId, at: Date.now(), decisionId: AssessmentDecisionId('approval'),
    }), outcome: 'approval-required', code: 'ASSESSMENT_APPROVAL_REQUIRED' }))
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/export-not-authorized' })
  })

  it('does not read Findings without an available Session binding', async () => {
    const b = bench()
    b.require.mockImplementation(() => { throw new Error('unbound') })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/scope-required' })
    expect(b.query).not.toHaveBeenCalled()
  })

  it('refuses report bytes after revocation during the storage checkpoint', async () => {
    const b = bench()
    b.flush.mockImplementation(async () => { b.require.mockImplementation(() => { throw new Error('revoked') }); return true })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/scope-required' })
  })

  it('rejects cancellation and Session disappearance after awaited reads', async () => {
    const b = bench()
    const abort = new AbortController()
    b.query.mockImplementationOnce(async () => { abort.abort(); return { items: [] } })
    await expect(b.controller.exportReport(b.request, abort.signal)).rejects.toThrow()
    expect(b.authorize).not.toHaveBeenCalled()
    b.query.mockImplementationOnce(async () => { b.get.mockReturnValue(undefined); return { items: [] } })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/session-not-live' })
  })

  it('rejects changed and non-advancing paginated results', async () => {
    const b = bench()
    b.query.mockImplementationOnce(async () => { b.session.seq++; return { items: [] } })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/report-changed' })
    b.query.mockResolvedValue({ items: [], nextCursor: FindingCursor('same') })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/report-changed' })
  })

  it('refuses truncation and absence of durable storage', async () => {
    const b = bench({ maxFindings: 1 })
    b.query.mockResolvedValueOnce({ items: [finding(), finding()] })
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/report-limit' })
    b.flush.mockResolvedValue(false)
    await expect(b.controller.exportReport(b.request, b.signal)).rejects.toMatchObject({ code: 'security-research/report-storage' })
    const small = bench({ maxReportBytes: 1 })
    await expect(small.controller.exportReport(small.request, small.signal)).rejects.toMatchObject({ code: 'security-research/report-limit' })
  })
})
