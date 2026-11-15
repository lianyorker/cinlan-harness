import { describe, expect, it } from 'vitest'
import { canonicalizeAssessmentGrant, isAssessmentGrantSubset } from '../src/index.ts'

function grantWith(targets: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    version: 1,
    engagementId: 'engagement',
    grantId: 'grant-root',
    authorizationRef: 'auth-ref',
    notBefore: 0,
    expiresAt: 10,
    executionHostIds: ['host'],
    targets,
    excludedTargetIds: [],
    actions: ['reconnaissance'],
    approvalRequiredActions: [],
    egress: [],
    credentials: [],
    evidence: { retainUntil: 5, minimumRedaction: 'none', externalReporting: 'deny' },
  }
}

describe('assessment grant canonicalization', () => {
  it('canonicalizes a cloud target and normalizes its allowlists', () => {
    const grant = canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'cloud', value: '123456789012',
      cloud: { provider: 'aws', regions: ['us-west-2', 'us-east-1'] },
    }]))
    expect(grant.targets[0]?.cloud).toEqual({
      provider: 'aws',
      regions: ['us-east-1', 'us-west-2'],
    })
    expect(Object.isFrozen(grant.targets[0]?.cloud)).toBe(true)
  })

  it('rejects duplicate allowlist entries', () => {
    expect(() => canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'cloud', value: '123456789012',
      cloud: { provider: 'aws', regions: ['us-east-1', 'us-east-1'] },
    }]))).toThrow(/duplicate/)
  })

  it('canonicalizes an empty allowlist to absent', () => {
    const grant = canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'cloud', value: '123456789012',
      cloud: { provider: 'gcp', regions: [], projects: ['proj-a'] },
    }]))
    expect(grant.targets[0]?.cloud).toEqual({ provider: 'gcp', projects: ['proj-a'] })
  })

  it('rejects cloud targets without a cloud scope', () => {
    expect(() => canonicalizeAssessmentGrant(grantWith([{ id: 'target', kind: 'cloud', value: '123456789012' }])))
      .toThrow(/cloud/)
  })

  it('rejects non-cloud targets that carry a cloud scope', () => {
    expect(() => canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'hostname', value: 'example.test',
      cloud: { provider: 'aws' },
    }]))).toThrow(/cloud/)
  })

  it('rejects unknown cloud providers', () => {
    expect(() => canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'cloud', value: '123456789012', cloud: { provider: 'oracle' },
    }]))).toThrow(/provider/)
  })

  it('rejects blank allowlist entries', () => {
    expect(() => canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'cloud', value: '123456789012',
      cloud: { provider: 'aws', regions: ['us-east-1', ' '] },
    }]))).toThrow(/regions/)
  })

  it('rejects delegated grants that redefine a cloud target with a different scope', () => {
    const parent = canonicalizeAssessmentGrant(grantWith([{
      id: 'target', kind: 'cloud', value: '123456789012',
      cloud: { provider: 'aws', regions: ['us-east-1', 'us-west-2'] },
    }]))
    const narrowed = canonicalizeAssessmentGrant({
      ...grantWith([{
        id: 'target', kind: 'cloud', value: '123456789012',
        cloud: { provider: 'aws', regions: ['us-east-1'] },
      }]),
      grantId: 'grant-child',
      parentGrantId: 'grant-root',
    })
    expect(isAssessmentGrantSubset(parent, narrowed)).toBe(false)
    const widened = canonicalizeAssessmentGrant({
      ...grantWith([{ id: 'target', kind: 'cloud', value: '123456789012', cloud: { provider: 'aws' } }]),
      grantId: 'grant-child',
      parentGrantId: 'grant-root',
    })
    expect(isAssessmentGrantSubset(parent, widened)).toBe(false)
  })
})
