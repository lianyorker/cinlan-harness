import { describe, expect, it } from 'vitest'
import { buildCertipyAuthArgv, buildCertipyFindArgv, buildCertipyReqArgv, parseCertipyFind, parseCertipyLines } from '../src/certipy.ts'

const BASE = {
  domain: 'lab.example.invalid',
  username: 'svc-scan',
  password: 'resolved-secret',
  credentialRef: 'ASSESS_AD_PASS',
} as const

describe('buildCertipyFindArgv', () => {
  it('builds a stdout-collection request with the secret on the -p flag', () => {
    expect(buildCertipyFindArgv('/usr/bin/certipy', { ...BASE })).toEqual([
      '/usr/bin/certipy', 'find', '-u', 'svc-scan@lab.example.invalid', '-p', 'resolved-secret', '-stdout',
    ])
  })

  it('adds -dc-ip and -vulnerable and rejects injection-shaped inputs', () => {
    expect(buildCertipyFindArgv('certipy', { ...BASE, dcIp: '10.0.0.10', vulnerableOnly: true })).toEqual([
      'certipy', 'find', '-u', 'svc-scan@lab.example.invalid', '-p', 'resolved-secret', '-stdout',
      '-dc-ip', '10.0.0.10', '-vulnerable',
    ])
    expect(() => buildCertipyFindArgv('certipy', { ...BASE, domain: '-v' })).toThrow(TypeError)
    expect(() => buildCertipyFindArgv('certipy', { ...BASE, username: 'user;id' })).toThrow(TypeError)
    expect(() => buildCertipyFindArgv('certipy', { ...BASE, credentialRef: 'bad ref!' })).toThrow(TypeError)
    expect(() => buildCertipyFindArgv('certipy', { ...BASE, dcIp: '-stdout' })).toThrow(TypeError)
  })
})

describe('parseCertipyFind', () => {
  it('parses CA and template rows and skips rows without names', () => {
    const stdout = JSON.stringify({
      CAs: [{ name: 'LAB-CA' }, { ca_enabled: true }],
      Templates: [{ name: 'User' }, { name: 'ESC1-Template' }, 42],
    })
    expect(parseCertipyFind(stdout)).toEqual({
      cas: [{ name: 'LAB-CA' }],
      templates: [{ name: 'User' }, { name: 'ESC1-Template' }],
    })
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseCertipyFind('')).toEqual({ cas: [], templates: [] })
    expect(parseCertipyFind('not json')).toEqual({ cas: [], templates: [] })
    expect(parseCertipyFind('[1,2,3]')).toEqual({ cas: [], templates: [] })
  })
})

describe('buildCertipyReqArgv', () => {
  const REQUEST = {
    domain: 'lab.example.invalid',
    username: 'svc-scan',
    password: 'resolved-secret',
    credentialRef: 'ASSESS_AD_PASS',
    ca: 'LAB-CA',
    template: 'ESC1-Template',
    dcIp: '10.0.0.10',
    san: 'administrator@lab.example.invalid',
  } as const
  const pfx = 'C:/Users/runner/AppData/Local/Temp/tool-certipy-x/requested.pfx'

  it('builds the request argv with the PFX artifact output', () => {
    expect(buildCertipyReqArgv('certipy', REQUEST, pfx)).toEqual([
      'certipy', 'req', '-u', 'svc-scan@lab.example.invalid', '-p', 'resolved-secret',
      '-ca', 'LAB-CA', '-template', 'ESC1-Template', '-out', pfx,
      '-dc-ip', '10.0.0.10', '-san', 'administrator@lab.example.invalid',
    ])
  })

  it('rejects relative artifact paths and injection-shaped CA/template/SAN values', () => {
    expect(() => buildCertipyReqArgv('certipy', REQUEST, 'relative/x.pfx')).toThrow(TypeError)
    for (const ca of ['', '-ca', 'CA;id', 'CA name $x']) {
      expect(() => buildCertipyReqArgv('certipy', { ...REQUEST, ca }, pfx)).toThrow(TypeError)
    }
    for (const template of ['', '-t', 'T;id']) {
      expect(() => buildCertipyReqArgv('certipy', { ...REQUEST, template }, pfx)).toThrow(TypeError)
    }
    for (const san of ['', '-san', 'admin;id', 'admin name']) {
      expect(() => buildCertipyReqArgv('certipy', { ...REQUEST, san }, pfx)).toThrow(TypeError)
    }
  })
})

describe('buildCertipyAuthArgv', () => {
  it('builds the authentication argv from a PFX artifact', () => {
    expect(buildCertipyAuthArgv('certipy', { pfxPath: 'C:/tmp/x.pfx', dcIp: '10.0.0.10' })).toEqual([
      'certipy', 'auth', '-pfx', 'C:/tmp/x.pfx', '-dc-ip', '10.0.0.10',
    ])
    expect(buildCertipyAuthArgv('certipy', { pfxPath: '/tmp/x.pfx' })).toEqual([
      'certipy', 'auth', '-pfx', '/tmp/x.pfx',
    ])
    expect(() => buildCertipyAuthArgv('certipy', { pfxPath: 'relative.pfx' })).toThrow(TypeError)
  })
})

describe('parseCertipyLines', () => {
  it('keeps every non-empty line, bounded to the last forty', () => {
    const stdout = [
      'Connecting to LDAP server...',
      '',
      '[+] Requesting certificate...',
      '[+] Certificate retrieved!',
      '[+] Saved to requested.pfx',
      'Certificate subject: CN=svc-scan',
    ].join('\n')
    expect(parseCertipyLines(stdout).map(row => row.text)).toEqual([
      'Connecting to LDAP server...',
      '[+] Requesting certificate...',
      '[+] Certificate retrieved!',
      '[+] Saved to requested.pfx',
      'Certificate subject: CN=svc-scan',
    ])
    const many = Array.from({ length: 80 }, (_, i) => `[+] line ${i}`).join('\n')
    expect(parseCertipyLines(many)).toHaveLength(40)
  })

  it('returns empty for empty output', () => {
    expect(parseCertipyLines('')).toEqual([])
    expect(parseCertipyLines('\n\n')).toEqual([])
  })
})
