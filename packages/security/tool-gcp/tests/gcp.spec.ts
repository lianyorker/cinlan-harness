import { describe, expect, it } from 'vitest'
import {
  buildGcsListArgv, buildIamPolicyArgv, buildIdentityArgv,
  parseAncestors, parseGcsBuckets, parseIamBindings, parseServiceAccountSecret,
} from '../src/gcp.ts'

describe('parseServiceAccountSecret', () => {
  it('accepts a service-account JSON document', () => {
    const secret = JSON.stringify({ type: 'service_account', project_id: 'proj-a', private_key: '-----BEGIN' })
    expect(parseServiceAccountSecret(secret)).toBe(secret)
  })

  it('rejects non-JSON and non-service-account documents', () => {
    expect(() => parseServiceAccountSecret('not json')).toThrow(TypeError)
    expect(() => parseServiceAccountSecret(JSON.stringify({ type: 'authorized_user' }))).toThrow(/authorized_user/)
    expect(() => parseServiceAccountSecret('[1,2]')).toThrow(TypeError)
  })
})

describe('buildIdentityArgv', () => {
  it('builds a JSON-format ancestor call without credential material in argv', () => {
    expect(buildIdentityArgv('gcloud', { projectId: 'proj-a', credentialRef: 'ASSESS_GCP_SA' })).toEqual([
      'gcloud', 'projects', 'get-ancestors', 'proj-a', '--format=json',
    ])
    expect(() => buildIdentityArgv('gcloud', { projectId: '-proj', credentialRef: 'REF' })).toThrow(TypeError)
    expect(() => buildIdentityArgv('gcloud', { projectId: 'proj-a', credentialRef: 'bad ref!' })).toThrow(TypeError)
    expect(() => buildIdentityArgv('gcloud', { projectId: 'UPPER', credentialRef: 'REF' })).toThrow(TypeError)
  })
})

describe('buildIamPolicyArgv and buildGcsListArgv', () => {
  it('builds the IAM policy and bucket listing calls', () => {
    expect(buildIamPolicyArgv('gcloud', { projectId: 'proj-a' })).toEqual([
      'gcloud', 'projects', 'get-iam-policy', 'proj-a', '--format=json',
    ])
    expect(buildGcsListArgv('gcloud', { projectId: 'proj-a' })).toEqual([
      'gcloud', 'storage', 'buckets', 'list', '--project', 'proj-a', '--format=json',
    ])
    expect(() => buildGcsListArgv('gcloud', { projectId: 'ab' })).toThrow(TypeError)
  })
})

describe('parseAncestors and parseIamBindings', () => {
  it('parses ancestor and binding rows, skipping incomplete entries', () => {
    const ancestors = JSON.stringify([{ kind: 'project#project', id: 'proj-a' }, { kind: 'folder' }, 'noise'])
    expect(parseAncestors(ancestors)).toEqual([{ kind: 'project#project', id: 'proj-a' }])
    const policy = JSON.stringify({
      bindings: [
        { role: 'roles/viewer', members: ['user:a@example.invalid', 'group:b@example.invalid'] },
        { role: 'roles/owner' },
        { members: ['user:c@example.invalid'] },
        'noise',
      ],
    })
    expect(parseIamBindings(policy)).toEqual([
      { role: 'roles/viewer', members: ['user:a@example.invalid', 'group:b@example.invalid'] },
      { role: 'roles/owner', members: [] },
    ])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseAncestors('')).toEqual([])
    expect(parseIamBindings('not json')).toEqual([])
    expect(parseAncestors('{"kind":"project"}')).toEqual([])
  })
})

describe('parseGcsBuckets', () => {
  it('parses bucket rows with their public-access-prevention setting', () => {
    const stdout = JSON.stringify([
      { name: 'projects/_/buckets/example-bucket', iamConfiguration: { publicAccessPrevention: 'enforced' } },
      { name: 'projects/_/buckets/open-bucket', iamConfiguration: { publicAccessPrevention: 'inherited' } },
      { iamConfiguration: { publicAccessPrevention: 'enforced' } },
      'noise',
    ])
    expect(parseGcsBuckets(stdout)).toEqual([
      { name: 'projects/_/buckets/example-bucket', publicAccessPrevention: 'enforced' },
      { name: 'projects/_/buckets/open-bucket', publicAccessPrevention: 'inherited' },
    ])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseGcsBuckets('')).toEqual([])
    expect(parseGcsBuckets('not json')).toEqual([])
    expect(parseGcsBuckets('{"name":"projects/_/buckets/x"}')).toEqual([])
  })
})
