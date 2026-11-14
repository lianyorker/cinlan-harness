import { describe, expect, it } from 'vitest'
import { buildNxcSprayArgv, parseNxcSprayLines } from '../src/nxc.ts'

const BASE = {
  target: '10.0.0.5',
  usernames: ['svc-backup', 'admin'],
  password: 'resolved-secret',
  credentialRef: 'ASSESS_AD_PASS',
} as const

describe('buildNxcSprayArgv', () => {
  it('builds a default smb spray with fixed continuation flags', () => {
    const argv = buildNxcSprayArgv('/usr/bin/nxc', { ...BASE }, 10)
    expect(argv).toEqual([
      '/usr/bin/nxc', 'smb', '10.0.0.5',
      '-u', 'svc-backup,admin', '-p', 'resolved-secret',
      '--threads', '5', '--continue-on-success', '--no-banner',
    ])
  })

  it('adds protocol, domain, and threads within the deployment cap', () => {
    const argv = buildNxcSprayArgv('nxc', { ...BASE, protocol: 'ldap', domain: 'lab.example.invalid', threads: 4 }, 10)
    expect(argv).toEqual([
      'nxc', 'ldap', '10.0.0.5',
      '-u', 'svc-backup,admin', '-p', 'resolved-secret',
      '-d', 'lab.example.invalid', '--threads', '4', '--continue-on-success', '--no-banner',
    ])
  })

  it('rejects injection, bad protocol, duplicates, and out-of-cap threads', () => {
    expect(() => buildNxcSprayArgv('nxc', { ...BASE, target: '-x' }, 10)).toThrow(TypeError)
    expect(() => buildNxcSprayArgv('nxc', { ...BASE, protocol: 'rdp' }, 10)).toThrow(TypeError)
    expect(() => buildNxcSprayArgv('nxc', { ...BASE, usernames: ['a', 'a'] }, 10)).toThrow(TypeError)
    expect(() => buildNxcSprayArgv('nxc', { ...BASE, usernames: [] }, 10)).toThrow(TypeError)
    expect(() => buildNxcSprayArgv('nxc', { ...BASE, threads: 11 }, 10)).toThrow(TypeError)
    expect(() => buildNxcSprayArgv('nxc', { ...BASE, credentialRef: 'bad ref!' }, 10)).toThrow(TypeError)
  })
})

describe('parseNxcSprayLines', () => {
  const FIXTURE = [
    'SMB         10.0.0.5      445    WS01        [+] lab.example.invalid\\admin:resolved-secret (Pwn3d!)',
    'SMB         10.0.0.5      445    WS01        [+] svc-backup:resolved-secret (Pwn3d!)',
    'SMB         10.0.0.5      445    WS01        [-] lab.example.invalid\\guest: (status: AccessDenied)',
    '',
    'some banner line',
  ].join('\n')

  it('extracts hit users and failure counts', () => {
    const result = parseNxcSprayLines(FIXTURE, ['resolved-secret'])
    expect(result.failures).toBe(1)
    expect(result.hits).toHaveLength(2)
    expect(result.hits[0]).toEqual({
      user: 'admin',
      line: 'SMB         10.0.0.5      445    WS01        [+] lab.example.invalid\\admin:[redacted] (Pwn3d!)',
    })
    expect(result.hits[1]).toEqual({
      user: 'svc-backup',
      line: 'SMB         10.0.0.5      445    WS01        [+] svc-backup:[redacted] (Pwn3d!)',
    })
    expect(JSON.stringify(result)).not.toContain('resolved-secret')
  })

  it('returns empty results for empty output', () => {
    expect(parseNxcSprayLines('')).toEqual({ hits: [], failures: 0 })
  })
})
