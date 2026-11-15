import { describe, expect, it } from 'vitest'
import {
  buildIdentityArgv, buildOssListArgv, buildRamArgv,
  parseAliyunEnvSecret, parseCallerIdentity, parseOssRows, parseRamUsers,
} from '../src/aliyun.ts'

describe('parseAliyunEnvSecret', () => {
  it('parses KEY=VALUE lines into environment entries', () => {
    expect(parseAliyunEnvSecret('ALIBABA_CLOUD_ACCESS_KEY_ID=AKIDexample\nALIBABA_CLOUD_ACCESS_KEY_SECRET=secret\nALIBABA_CLOUD_SECURITY_TOKEN=token\n')).toEqual({
      ALIBABA_CLOUD_ACCESS_KEY_ID: 'AKIDexample',
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'secret',
      ALIBABA_CLOUD_SECURITY_TOKEN: 'token',
    })
  })

  it('rejects unsupported keys, malformed lines, and missing required keys', () => {
    expect(() => parseAliyunEnvSecret('ALIBABA_CLOUD_ACCESS_KEY_ID=A\nALIBABA_CLOUD_ACCESS_KEY_SECRET=B\nAWS_ACCESS_KEY_ID=X')).toThrow(TypeError)
    expect(() => parseAliyunEnvSecret('ALIBABA_CLOUD_ACCESS_KEY_ID=A\nNOEQUALS')).toThrow(TypeError)
    expect(() => parseAliyunEnvSecret('ALIBABA_CLOUD_ACCESS_KEY_ID=A')).toThrow(/ALIBABA_CLOUD_ACCESS_KEY_SECRET/)
    expect(() => parseAliyunEnvSecret('')).toThrow(/ALIBABA_CLOUD_ACCESS_KEY_ID/)
  })
})

describe('buildIdentityArgv', () => {
  it('builds the identity call without credential material in argv', () => {
    expect(buildIdentityArgv('aliyun', { region: 'cn-hangzhou', credentialRef: 'ASSESS_ALIYUN_KEYS' })).toEqual([
      'aliyun', 'sts', 'GetCallerIdentity', '--region', 'cn-hangzhou',
    ])
    expect(() => buildIdentityArgv('aliyun', { region: 'cn-hangzhou', credentialRef: 'bad ref!' })).toThrow(TypeError)
    expect(() => buildIdentityArgv('aliyun', { region: '-region', credentialRef: 'REF' })).toThrow(TypeError)
  })
})

describe('buildRamArgv', () => {
  it('builds a bounded user listing with its paging parameters', () => {
    expect(buildRamArgv('aliyun', { limit: 100, region: 'cn-hangzhou' })).toEqual([
      'aliyun', 'ram', 'ListUsers', '--region', 'cn-hangzhou', '--PageSize', '100', '--PageNumber', '1',
    ])
  })

  it('rejects out-of-range limits and invalid regions', () => {
    expect(() => buildRamArgv('aliyun', { limit: 0, region: 'cn-hangzhou' })).toThrow(TypeError)
    expect(() => buildRamArgv('aliyun', { limit: 1001, region: 'cn-hangzhou' })).toThrow(TypeError)
    expect(() => buildRamArgv('aliyun', { limit: 10, region: '' })).toThrow(TypeError)
  })
})

describe('buildOssListArgv', () => {
  it('builds the built-in ossutil listing call', () => {
    expect(buildOssListArgv('aliyun', { region: 'cn-hangzhou' })).toEqual([
      'aliyun', 'oss', 'ls', '--region', 'cn-hangzhou',
    ])
  })
})

describe('parseCallerIdentity', () => {
  it('parses the STS identity fields', () => {
    const stdout = JSON.stringify({ IdentityType: 'RAMUser', AccountId: '196813200012', Arn: 'acs:ram::196813200012:user/admin' })
    expect(parseCallerIdentity(stdout)).toEqual({ identityType: 'RAMUser', accountId: '196813200012', arn: 'acs:ram::196813200012:user/admin' })
  })

  it('returns empty fields for empty or malformed output', () => {
    expect(parseCallerIdentity('')).toEqual({ identityType: '', accountId: '', arn: '' })
    expect(parseCallerIdentity('not json')).toEqual({ identityType: '', accountId: '', arn: '' })
    expect(parseCallerIdentity('[1]')).toEqual({ identityType: '', accountId: '', arn: '' })
  })
})

describe('parseRamUsers', () => {
  it('parses users from the Users.User wrapper, skipping unnamed rows', () => {
    const stdout = JSON.stringify({
      Users: { User: [{ UserName: 'svc-scan', Arn: 'acs:ram::196813200012:user/svc-scan' }, { Arn: 'acs:ram::196813200012:user/x' }, 'noise'] },
      PageNumber: 1,
    })
    expect(parseRamUsers(stdout)).toEqual([{ name: 'svc-scan', arn: 'acs:ram::196813200012:user/svc-scan' }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseRamUsers('')).toEqual([])
    expect(parseRamUsers('not json')).toEqual([])
    expect(parseRamUsers('{"Users": "no"}')).toEqual([])
    expect(parseRamUsers('{"Users": {"User": "no"}}')).toEqual([])
  })
})

describe('parseOssRows', () => {
  it('parses oss:// listing lines and skips headers and notes', () => {
    const stdout = [
      'Bucket list:',
      'oss://example-bucket  cn-hangzhou  2026-01-02T03:04:05Z',
      'oss://second-bucket  cn-beijing',
      '',
      'progress note without scheme',
    ].join('\n')
    expect(parseOssRows(stdout)).toEqual([
      { name: 'example-bucket', detail: 'cn-hangzhou  2026-01-02T03:04:05Z' },
      { name: 'second-bucket', detail: 'cn-beijing' },
    ])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseOssRows('')).toEqual([])
    expect(parseOssRows('no buckets here')).toEqual([])
  })
})
