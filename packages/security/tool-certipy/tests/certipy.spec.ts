import { describe, expect, it } from 'vitest'
import { buildCertipyFindArgv, parseCertipyFind } from '../src/certipy.ts'

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
