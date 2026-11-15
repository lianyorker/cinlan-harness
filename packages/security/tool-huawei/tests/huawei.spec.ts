import { describe, expect, it } from 'vitest'
import {
  buildIamArgv, buildIdentityArgv, buildObsListArgv,
  parseCallerIdentity, parseHuaweiSecret, parseIamRows, parseObsRows,
} from '../src/huawei.ts'

const PAIR = {
  accessKeyId: 'HWAKEXAMPLE',
  secretAccessKey: 'resolved-secret',
} as const

describe('parseHuaweiSecret', () => {
  it('parses KEY=VALUE lines into a key pair', () => {
    const secret = 'HW_ACCESS_KEY_ID=HWAKEXAMPLE\nHW_SECRET_ACCESS_KEY=resolved-secret\nHW_SECURITY_TOKEN=token\n'
    expect(parseHuaweiSecret(secret)).toEqual({ ...PAIR, securityToken: 'token' })
    expect(parseHuaweiSecret('HW_ACCESS_KEY_ID=HWAKEXAMPLE\nHW_SECRET_ACCESS_KEY=resolved-secret')).toEqual(PAIR)
  })

  it('rejects unsupported keys, malformed lines, and missing required keys', () => {
    expect(() => parseHuaweiSecret('HW_ACCESS_KEY_ID=A\nHW_SECRET_ACCESS_KEY=B\nAWS_ACCESS_KEY_ID=X')).toThrow(TypeError)
    expect(() => parseHuaweiSecret('HW_ACCESS_KEY_ID=A\nNOEQUALS')).toThrow(TypeError)
    expect(() => parseHuaweiSecret('HW_ACCESS_KEY_ID=A')).toThrow(/HW_SECRET_ACCESS_KEY/)
    expect(() => parseHuaweiSecret('')).toThrow(/HW_ACCESS_KEY_ID/)
  })
})

describe('buildIdentityArgv', () => {
  it('builds the KooCLI IAM5 identity call with key flags', () => {
    expect(buildIdentityArgv('hcloud', { region: 'cn-north-4', credentialRef: 'ASSESS_HW_KEYS' }, PAIR)).toEqual([
      'hcloud', 'IAM5', 'GetCallerIdentity', '--cli-region=cn-north-4',
      '--cli-access-key=HWAKEXAMPLE', '--cli-secret-key=resolved-secret',
    ])
    expect(() => buildIdentityArgv('hcloud', { region: 'cn-north-4', credentialRef: 'bad ref!' }, PAIR)).toThrow(TypeError)
    expect(() => buildIdentityArgv('hcloud', { region: '-region', credentialRef: 'REF' }, PAIR)).toThrow(TypeError)
  })
})

describe('buildIamArgv', () => {
  it('builds the project-scoped KooCLI listings per resource', () => {
    expect(buildIamArgv('hcloud', { resource: 'users', region: 'cn-north-4', projectId: '4ff018c3aaaaaaaaaaaaaaaaaaaaaaaaaa' }, PAIR)).toEqual([
      'hcloud', 'IAM', 'ListUsers', '--cli-region=cn-north-4',
      '--project_id=4ff018c3aaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--cli-access-key=HWAKEXAMPLE', '--cli-secret-key=resolved-secret',
    ])
    expect(buildIamArgv('hcloud', { resource: 'keys', region: 'cn-north-4', projectId: '4ff018c3aaaaaaaaaaaaaaaaaaaaaaaaaa' }, PAIR)).toEqual([
      'hcloud', 'IAM', 'ListPermanentAccessKeys', '--cli-region=cn-north-4',
      '--project_id=4ff018c3aaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--cli-access-key=HWAKEXAMPLE', '--cli-secret-key=resolved-secret',
    ])
    expect(() => buildIamArgv('hcloud', { resource: 'users', region: 'cn-north-4', projectId: '-proj' }, PAIR)).toThrow(TypeError)
    expect(() => buildIamArgv('hcloud', { resource: 'users', region: 'cn-north-4', projectId: '' }, PAIR)).toThrow(TypeError)
  })
})

describe('buildObsListArgv', () => {
  it('builds the obsutil listing with the key flags and optional token', () => {
    expect(buildObsListArgv('obsutil', { region: 'cn-north-4' }, PAIR)).toEqual([
      'obsutil', 'ls', '-region=cn-north-4', '-i=HWAKEXAMPLE', '-k=resolved-secret',
    ])
    expect(buildObsListArgv('obsutil', { region: 'cn-north-4' }, { ...PAIR, securityToken: 'token' })).toEqual([
      'obsutil', 'ls', '-region=cn-north-4', '-i=HWAKEXAMPLE', '-k=resolved-secret', '-t=token',
    ])
    expect(() => buildObsListArgv('obsutil', { region: '' }, PAIR)).toThrow(TypeError)
  })
})

describe('parseCallerIdentity', () => {
  it('parses the IAM5 identity fields', () => {
    const stdout = JSON.stringify({ user_id: 'hwuser-example', account_id: 'hwaccount-example', urn: 'iam::hwaccount-example:user:admin' })
    expect(parseCallerIdentity(stdout)).toEqual({ userId: 'hwuser-example', accountId: 'hwaccount-example', urn: 'iam::hwaccount-example:user:admin' })
  })

  it('returns empty fields for empty or malformed output', () => {
    expect(parseCallerIdentity('')).toEqual({ userId: '', accountId: '', urn: '' })
    expect(parseCallerIdentity('not json')).toEqual({ userId: '', accountId: '', urn: '' })
    expect(parseCallerIdentity('[1]')).toEqual({ userId: '', accountId: '', urn: '' })
  })
})

describe('parseIamRows', () => {
  it('parses user rows from the snake_case IAM payload, skipping unnamed rows', () => {
    const stdout = JSON.stringify({ userlist: [{ user_name: 'svc-scan', user_id: 'hwuser-example' }, { user_id: 'hwuser-x' }, 'noise'] })
    expect(parseIamRows(stdout, 'users')).toEqual([{ name: 'svc-scan', userId: 'hwuser-example' }])
    const alt = JSON.stringify({ users: [{ user_name: 'other' }] })
    expect(parseIamRows(alt, 'users')).toEqual([{ name: 'other', userId: '' }])
  })

  it('parses access key rows from the credentials list, skipping keyless rows', () => {
    const stdout = JSON.stringify({
      credentials: [
        { access_key_id: 'HWAKEXAMPLE01', user_id: 'hwuser-example', status: 'Active' },
        { user_id: 'hwuser-x' },
        'noise',
      ],
    })
    expect(parseIamRows(stdout, 'keys')).toEqual([{ accessKeyId: 'HWAKEXAMPLE01', userId: 'hwuser-example', status: 'Active' }])
    const alt = JSON.stringify({ accesskeys: [{ access: 'HWAKEXAMPLE02' }] })
    expect(parseIamRows(alt, 'keys')).toEqual([{ accessKeyId: 'HWAKEXAMPLE02', userId: '', status: '' }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseIamRows('', 'users')).toEqual([])
    expect(parseIamRows('not json', 'keys')).toEqual([])
    expect(parseIamRows('{"userlist": "no"}', 'users')).toEqual([])
  })
})

describe('parseObsRows', () => {
  it('parses obs:// listing lines and skips headers and notes', () => {
    const stdout = [
      'Bucket list:',
      'obs://example-bucket  2026-01-02T03:04:05Z  STORAGE_CLASS',
      'obs://second-bucket  2026-01-03',
      '',
      'progress note without scheme',
    ].join('\n')
    expect(parseObsRows(stdout)).toEqual([
      { name: 'example-bucket', detail: '2026-01-02T03:04:05Z  STORAGE_CLASS' },
      { name: 'second-bucket', detail: '2026-01-03' },
    ])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseObsRows('')).toEqual([])
    expect(parseObsRows('no buckets here')).toEqual([])
  })
})
