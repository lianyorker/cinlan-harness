import { describe, expect, it } from 'vitest'
import {
  buildIamArgv, buildPolicyStatusArgv, buildS3ListArgv, buildStsArgv,
  parseAwsEnvSecret, parseIamRows, parsePolicyStatus, parseS3Buckets, parseStsIdentity,
} from '../src/aws.ts'

describe('parseAwsEnvSecret', () => {
  it('parses KEY=VALUE lines into environment entries', () => {
    expect(parseAwsEnvSecret('AWS_ACCESS_KEY_ID=AKIAEXAMPLE\nAWS_SECRET_ACCESS_KEY=secret-value\nAWS_SESSION_TOKEN=token-value\n')).toEqual({
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret-value',
      AWS_SESSION_TOKEN: 'token-value',
    })
  })

  it('accepts values containing = and skips blank lines', () => {
    expect(parseAwsEnvSecret('\nAWS_ACCESS_KEY_ID=AKIA\nAWS_SECRET_ACCESS_KEY=a=b=c\n')).toEqual({
      AWS_ACCESS_KEY_ID: 'AKIA',
      AWS_SECRET_ACCESS_KEY: 'a=b=c',
    })
  })

  it('rejects unsupported keys, malformed lines, and missing required keys', () => {
    expect(() => parseAwsEnvSecret('AWS_ACCESS_KEY_ID=A\nAWS_SECRET_ACCESS_KEY=B\nDSH_SESSION=leak')).toThrow(TypeError)
    expect(() => parseAwsEnvSecret('AWS_ACCESS_KEY_ID=A\nNOEQUALS')).toThrow(TypeError)
    expect(() => parseAwsEnvSecret('AWS_ACCESS_KEY_ID=A')).toThrow(/AWS_SECRET_ACCESS_KEY/)
    expect(() => parseAwsEnvSecret('')).toThrow(/AWS_ACCESS_KEY_ID/)
  })
})

describe('buildStsArgv', () => {
  it('builds a JSON-output identity call without credential material in argv', () => {
    expect(buildStsArgv('aws', { credentialRef: 'ASSESS_AWS_KEYS' })).toEqual([
      'aws', 'sts', 'get-caller-identity', '--output', 'json', '--no-cli-paginate',
    ])
    expect(buildStsArgv('aws', { credentialRef: 'ASSESS_AWS_KEYS', region: 'us-east-1' })).toEqual([
      'aws', 'sts', 'get-caller-identity', '--output', 'json', '--no-cli-paginate', '--region', 'us-east-1',
    ])
    expect(() => buildStsArgv('aws', { credentialRef: 'bad ref!' })).toThrow(TypeError)
    expect(() => buildStsArgv('aws', { credentialRef: 'REF', region: '-output' })).toThrow(TypeError)
  })
})

describe('buildIamArgv', () => {
  it('builds bounded listings per resource with Local policy scope', () => {
    expect(buildIamArgv('aws', { resource: 'users', limit: 100 })).toEqual([
      'aws', 'iam', 'list-users', '--output', 'json', '--no-cli-paginate', '--max-items', '100',
    ])
    expect(buildIamArgv('aws', { resource: 'roles', limit: 5, region: 'eu-west-1' })).toEqual([
      'aws', 'iam', 'list-roles', '--output', 'json', '--no-cli-paginate', '--max-items', '5', '--region', 'eu-west-1',
    ])
    expect(buildIamArgv('aws', { resource: 'policies', limit: 10 })).toEqual([
      'aws', 'iam', 'list-policies', '--scope', 'Local', '--output', 'json', '--no-cli-paginate', '--max-items', '10',
    ])
  })

  it('rejects out-of-range limits', () => {
    expect(() => buildIamArgv('aws', { resource: 'users', limit: 0 })).toThrow(TypeError)
    expect(() => buildIamArgv('aws', { resource: 'users', limit: 1001 })).toThrow(TypeError)
    expect(() => buildIamArgv('aws', { resource: 'users', limit: Number.NaN })).toThrow(TypeError)
  })
})

describe('buildS3ListArgv and buildPolicyStatusArgv', () => {
  it('builds the account listing and the per-bucket public-policy call', () => {
    expect(buildS3ListArgv('aws', {})).toEqual(['aws', 's3api', 'list-buckets', '--output', 'json', '--no-cli-paginate'])
    expect(buildPolicyStatusArgv('aws', { bucket: 'example-bucket', region: 'us-east-1' })).toEqual([
      'aws', 's3api', 'get-bucket-policy-status', '--bucket', 'example-bucket', '--region', 'us-east-1',
      '--output', 'json', '--no-cli-paginate',
    ])
    expect(() => buildPolicyStatusArgv('aws', { bucket: '-bucket', region: 'us-east-1' })).toThrow(TypeError)
    expect(() => buildPolicyStatusArgv('aws', { bucket: 'bucket;id', region: 'us-east-1' })).toThrow(TypeError)
    expect(() => buildPolicyStatusArgv('aws', { bucket: 'bucket', region: '' })).toThrow(TypeError)
  })
})

describe('parseStsIdentity', () => {
  it('parses the caller identity fields', () => {
    const stdout = JSON.stringify({ UserId: 'AIDAEXAMPLE', Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/svc' })
    expect(parseStsIdentity(stdout)).toEqual({
      userId: 'AIDAEXAMPLE', account: '123456789012', arn: 'arn:aws:iam::123456789012:user/svc',
    })
  })

  it('returns empty fields for empty or malformed output', () => {
    expect(parseStsIdentity('')).toEqual({ userId: '', account: '', arn: '' })
    expect(parseStsIdentity('not json')).toEqual({ userId: '', account: '', arn: '' })
    expect(parseStsIdentity('[1]')).toEqual({ userId: '', account: '', arn: '' })
    expect(parseStsIdentity('{"UserId":42,"Arn":"arn:aws:iam::x"}')).toEqual({ userId: '', account: '', arn: 'arn:aws:iam::x' })
  })
})

describe('parseIamRows', () => {
  it('parses users, roles, and policies by their list keys', () => {
    const users = JSON.stringify({ UserList: [{ UserName: 'svc-scan', Arn: 'arn:aws:iam::1:user/svc-scan' }, { Arn: 'arn:aws:iam::1:user/anonymous' }, 7] })
    expect(parseIamRows(users, 'users')).toEqual([{ name: 'svc-scan', arn: 'arn:aws:iam::1:user/svc-scan' }])
    const roles = JSON.stringify({ RoleList: [{ RoleName: 'deploy', Arn: 'arn:aws:iam::1:role/deploy' }] })
    expect(parseIamRows(roles, 'roles')).toEqual([{ name: 'deploy', arn: 'arn:aws:iam::1:role/deploy' }])
    const policies = JSON.stringify({ Policies: [{ PolicyName: 'customer-managed', Arn: 'arn:aws:iam::1:policy/customer-managed' }] })
    expect(parseIamRows(policies, 'policies')).toEqual([{ name: 'customer-managed', arn: 'arn:aws:iam::1:policy/customer-managed' }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseIamRows('', 'users')).toEqual([])
    expect(parseIamRows('not json', 'roles')).toEqual([])
    expect(parseIamRows('{"UserList": "no"}', 'users')).toEqual([])
  })
})

describe('parseS3Buckets', () => {
  it('parses bucket rows and skips rows without names', () => {
    const stdout = JSON.stringify({
      Buckets: [{ Name: 'example-bucket', CreationDate: '2026-01-02T03:04:05Z' }, { CreationDate: '2026-01-02' }, 'noise'],
      Owner: { ID: 'owner' },
    })
    expect(parseS3Buckets(stdout)).toEqual([{ name: 'example-bucket', creationDate: '2026-01-02T03:04:05Z' }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseS3Buckets('')).toEqual([])
    expect(parseS3Buckets('not json')).toEqual([])
    expect(parseS3Buckets('{"Buckets": null}')).toEqual([])
  })
})

describe('parsePolicyStatus', () => {
  it('parses IsPublic and reports unknown for buckets without a policy', () => {
    expect(parsePolicyStatus('{"PolicyStatus":{"IsPublic":true}}')).toBe(true)
    expect(parsePolicyStatus('{"PolicyStatus":{"IsPublic":false}}')).toBe(false)
    expect(parsePolicyStatus('{"PolicyStatus":{"IsPublic":"yes"}}')).toBeUndefined()
    expect(parsePolicyStatus('{}')).toBeUndefined()
    expect(parsePolicyStatus('not json')).toBeUndefined()
  })
})
