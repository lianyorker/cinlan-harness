import { describe, expect, it } from 'vitest'
import { aggregateBloodhoundFiles, buildBloodhoundArgv } from '../src/bloodhound.ts'

const USERS_ARRAY = JSON.stringify([
  {
    Properties: {
      name: 'SQLSVC@LAB.EXAMPLE.INVALID',
      serviceprincipalnames: ['MSSQLSvc/db.lab.example.invalid:1433'],
    },
  },
  {
    Properties: {
      name: 'LEGACY@LAB.EXAMPLE.INVALID',
      dontreqpreauth: true,
    },
  },
  { Properties: { name: 'PLAIN@LAB.EXAMPLE.INVALID' } },
])

const COMPUTERS_WRAPPED = JSON.stringify({
  meta: { type: 'computers', version: 5 },
  data: [
    { Properties: { name: 'WS01.LAB.EXAMPLE.INVALID', operatingsystem: 'Windows 11' } },
    { Properties: { name: 'WS02.LAB.EXAMPLE.INVALID' } },
  ],
})

describe('buildBloodhoundArgv', () => {
  it('builds a full-collection argv with the secret on the -p flag', () => {
    const argv = buildBloodhoundArgv('/usr/bin/bloodhound-python', {
      domain: 'lab.example.invalid',
      username: 'svc-scan',
      password: 'resolved-secret',
      credentialRef: 'ASSESS_AD_PASS',
    })
    expect(argv).toEqual([
      '/usr/bin/bloodhound-python', '-c', 'All',
      '-d', 'lab.example.invalid', '-u', 'svc-scan', '-p', 'resolved-secret',
    ])
  })

  it('adds the nameserver and rejects injection-shaped inputs', () => {
    const argv = buildBloodhoundArgv('bloodhound-python', {
      domain: 'lab.example.invalid',
      username: 'svc-scan',
      password: 'resolved-secret',
      credentialRef: 'ASSESS_AD_PASS',
      nameserver: '10.0.0.10',
    })
    expect(argv).toContain('-ns')
    expect(argv).toContain('10.0.0.10')
    expect(() => buildBloodhoundArgv('bloodhound-python', {
      domain: '-c', username: 'svc-scan', password: 'x', credentialRef: 'ASSESS_AD_PASS',
    })).toThrow(TypeError)
    expect(() => buildBloodhoundArgv('bloodhound-python', {
      domain: 'lab.example.invalid', username: 'user;id', password: 'x', credentialRef: 'ASSESS_AD_PASS',
    })).toThrow(TypeError)
    expect(() => buildBloodhoundArgv('bloodhound-python', {
      domain: 'lab.example.invalid', username: 'svc-scan', password: 'x', credentialRef: 'bad ref!',
    })).toThrow(TypeError)
  })
})

describe('aggregateBloodhoundFiles', () => {
  it('aggregates both document shapes and extracts roastable accounts', () => {
    const summary = aggregateBloodhoundFiles([
      { name: 'users.json', text: USERS_ARRAY },
      { name: 'computers.json', text: COMPUTERS_WRAPPED },
      { name: 'not-json.json', text: '{truncated' },
      { name: 'readme.txt', text: 'ignored' },
    ])
    expect(summary.collectors).toEqual([
      { file: 'users.json', count: 3 },
      { file: 'computers.json', count: 2 },
    ])
    expect(summary.kerberoastable).toEqual(['SQLSVC@LAB.EXAMPLE.INVALID'])
    expect(summary.asrepRoastable).toEqual(['LEGACY@LAB.EXAMPLE.INVALID'])
  })

  it('returns empty summaries for no collector files', () => {
    expect(aggregateBloodhoundFiles([])).toEqual({ collectors: [], kerberoastable: [], asrepRoastable: [] })
  })
})
