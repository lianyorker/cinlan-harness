import { describe, expect, it } from 'vitest'
import {
  buildCamArgv, buildCamAttachArgv, buildCamDetachArgv, buildCosAclArgv, buildCosServiceArgv, buildIdentityArgv,
  isPublicGrants, parseAclGrants, parseCamRows, parseCallerIdentity, parseCosBuckets,
  parseTencentEnvSecret,
} from '../src/tencent.ts'

describe('parseTencentEnvSecret', () => {
  it('parses KEY=VALUE lines into environment entries', () => {
    expect(parseTencentEnvSecret('TENCENTCLOUD_SECRETID=AKIDexample\nTENCENTCLOUD_SECRETKEY=secret\nTENCENTCLOUD_SESSION_TOKEN=token\n')).toEqual({
      TENCENTCLOUD_SECRETID: 'AKIDexample',
      TENCENTCLOUD_SECRETKEY: 'secret',
      TENCENTCLOUD_SESSION_TOKEN: 'token',
    })
  })

  it('rejects unsupported keys, malformed lines, and missing required keys', () => {
    expect(() => parseTencentEnvSecret('TENCENTCLOUD_SECRETID=A\nTENCENTCLOUD_SECRETKEY=B\nAWS_ACCESS_KEY_ID=X')).toThrow(TypeError)
    expect(() => parseTencentEnvSecret('TENCENTCLOUD_SECRETID=A\nNOEQUALS')).toThrow(TypeError)
    expect(() => parseTencentEnvSecret('TENCENTCLOUD_SECRETID=A')).toThrow(/TENCENTCLOUD_SECRETKEY/)
    expect(() => parseTencentEnvSecret('')).toThrow(/TENCENTCLOUD_SECRETID/)
  })
})

describe('buildIdentityArgv', () => {
  it('builds a JSON-output identity call without credential material in argv', () => {
    expect(buildIdentityArgv('tccli', { region: 'ap-guangzhou', credentialRef: 'ASSESS_TENCENT_KEYS' })).toEqual([
      'tccli', 'sts', 'GetCallerIdentity', '--region', 'ap-guangzhou', '--output', 'json',
    ])
    expect(() => buildIdentityArgv('tccli', { region: 'ap-guangzhou', credentialRef: 'bad ref!' })).toThrow(TypeError)
    expect(() => buildIdentityArgv('tccli', { region: '-region', credentialRef: 'REF' })).toThrow(TypeError)
  })
})

describe('buildCamArgv', () => {
  it('builds bounded listings per resource with their paging parameters', () => {
    expect(buildCamArgv('tccli', { resource: 'users', limit: 100, region: 'ap-guangzhou' })).toEqual([
      'tccli', 'cam', 'ListUsers', '--limit', '100', '--offset', '0', '--region', 'ap-guangzhou', '--output', 'json',
    ])
    expect(buildCamArgv('tccli', { resource: 'roles', limit: 20, region: 'ap-shanghai' })).toEqual([
      'tccli', 'cam', 'ListRoles', '--page', '1', '--rp', '20', '--region', 'ap-shanghai', '--output', 'json',
    ])
  })

  it('rejects out-of-range limits and invalid regions', () => {
    expect(() => buildCamArgv('tccli', { resource: 'users', limit: 0, region: 'ap-guangzhou' })).toThrow(TypeError)
    expect(() => buildCamArgv('tccli', { resource: 'users', limit: 1001, region: 'ap-guangzhou' })).toThrow(TypeError)
    expect(() => buildCamArgv('tccli', { resource: 'users', limit: 10, region: '' })).toThrow(TypeError)
  })
})

describe('buildCosServiceArgv and buildCosAclArgv', () => {
  it('builds the account listing and the per-bucket ACL call', () => {
    expect(buildCosServiceArgv('tccli', { region: 'ap-guangzhou' })).toEqual([
      'tccli', 'cos', 'GetService', '--region', 'ap-guangzhou', '--output', 'json',
    ])
    expect(buildCosAclArgv('tccli', { bucket: 'example-bucket-1250000000', region: 'ap-guangzhou' })).toEqual([
      'tccli', 'cos', 'GetBucketAcl', '--bucket', 'example-bucket-1250000000', '--region', 'ap-guangzhou', '--output', 'json',
    ])
    expect(() => buildCosAclArgv('tccli', { bucket: '-bucket', region: 'ap-guangzhou' })).toThrow(TypeError)
    expect(() => buildCosAclArgv('tccli', { bucket: 'bucket;id', region: 'ap-guangzhou' })).toThrow(TypeError)
  })
})

describe('buildCamAttachArgv and buildCamDetachArgv', () => {
  const REQUEST = { policyId: 123456, attachUin: 900000000000, region: 'ap-guangzhou' } as const
  it('builds symmetric attach and detach calls with JSON output', () => {
    expect(buildCamAttachArgv('tccli', REQUEST)).toEqual([
      'tccli', 'cam', 'AttachUserPolicy',
      '--policyId', '123456', '--attachUin', '900000000000', '--region', 'ap-guangzhou', '--output', 'json',
    ])
    expect(buildCamDetachArgv('tccli', REQUEST)).toEqual([
      'tccli', 'cam', 'DetachUserPolicy',
      '--policyId', '123456', '--detachUin', '900000000000', '--region', 'ap-guangzhou', '--output', 'json',
    ])
  })

  it('rejects non-numeric and non-positive ids', () => {
    for (const policyId of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildCamAttachArgv('tccli', { ...REQUEST, policyId })).toThrow(TypeError)
    }
    for (const attachUin of [0, -1, 1.5]) {
      expect(() => buildCamDetachArgv('tccli', { ...REQUEST, attachUin })).toThrow(TypeError)
    }
    expect(() => buildCamAttachArgv('tccli', { ...REQUEST, region: '-r' })).toThrow(TypeError)
  })
})

describe('parseCallerIdentity', () => {
  it('parses the tccli envelope into identity fields', () => {
    const stdout = JSON.stringify({ Response: { Type: 'CAMUser', AccountId: '100000000000', UserId: '900000000000', Arn: 'qcs::cam::uin/900000000000' } })
    expect(parseCallerIdentity(stdout)).toEqual({ userId: '900000000000', accountId: '100000000000', arn: 'qcs::cam::uin/900000000000' })
  })

  it('returns empty fields for empty or malformed output', () => {
    expect(parseCallerIdentity('')).toEqual({ userId: '', accountId: '', arn: '' })
    expect(parseCallerIdentity('not json')).toEqual({ userId: '', accountId: '', arn: '' })
    expect(parseCallerIdentity('{"Response": 42}')).toEqual({ userId: '', accountId: '', arn: '' })
  })
})

describe('parseCamRows', () => {
  it('parses users and roles by their list paths, skipping unnamed rows', () => {
    const users = JSON.stringify({ Response: { Data: [{ Uin: '900000000000', Arn: 'qcs::cam::uin/900000000000' }, { Arn: 'qcs::cam::uin/1' }, 'noise'] } })
    expect(parseCamRows(users, 'users')).toEqual([{ name: '900000000000', arn: 'qcs::cam::uin/900000000000' }])
    const roles = JSON.stringify({ Response: { ListData: [{ RoleName: 'deploy', Arn: 'qcs::cam::role/deploy' }] } })
    expect(parseCamRows(roles, 'roles')).toEqual([{ name: 'deploy', arn: 'qcs::cam::role/deploy' }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseCamRows('', 'users')).toEqual([])
    expect(parseCamRows('not json', 'roles')).toEqual([])
    expect(parseCamRows('{"Response": {"Data": "no"}}', 'users')).toEqual([])
  })
})

describe('parseCosBuckets', () => {
  it('parses bucket rows from the wrapped GetService payload', () => {
    const stdout = JSON.stringify({
      Response: {
        ListAllMyBucketsResult: {
          Buckets: { Bucket: [{ Name: 'example-bucket-1250000000', Location: 'ap-guangzhou', CreationDate: '2026-01-02T03:04:05Z' }, { Location: 'ap-guangzhou' }] },
        },
      },
    })
    expect(parseCosBuckets(stdout)).toEqual([{ name: 'example-bucket-1250000000', location: 'ap-guangzhou', creationDate: '2026-01-02T03:04:05Z' }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseCosBuckets('')).toEqual([])
    expect(parseCosBuckets('not json')).toEqual([])
    expect(parseCosBuckets('{"Response": {}}')).toEqual([])
  })
})

describe('parseAclGrants and isPublicGrants', () => {
  it('parses grant rows and detects anonymous-read access', () => {
    const stdout = JSON.stringify({
      Response: {
        AccessControlList: {
          Grant: [
            { Grantee: { URI: 'http://cam.qcloud.com/groups/global/AllUsers' }, Permission: 'READ' },
            { Grantee: { ID: 'qcs::cam::uin/900000000000' }, Permission: 'FULL_CONTROL' },
            { Permission: 'WRITE' },
            'noise',
          ],
        },
      },
    })
    const grants = parseAclGrants(stdout)
    expect(grants).toEqual([
      { grantee: 'http://cam.qcloud.com/groups/global/AllUsers', permission: 'READ' },
      { grantee: 'qcs::cam::uin/900000000000', permission: 'FULL_CONTROL' },
    ])
    expect(isPublicGrants(grants)).toBe(true)
    expect(isPublicGrants([{ grantee: 'qcs::cam::uin/900000000000', permission: 'FULL_CONTROL' }])).toBe(false)
  })

  it('treats missing ACL envelopes as unknown public status', () => {
    expect(parseAclGrants('')).toEqual([])
    expect(parseAclGrants('not json')).toEqual([])
    expect(parseAclGrants('{"Response": {}}')).toEqual([])
  })
})
