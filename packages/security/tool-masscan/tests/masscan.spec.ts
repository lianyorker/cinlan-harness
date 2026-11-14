import { describe, expect, it } from 'vitest'
import { buildMasscanArgv, parseMasscanJson } from '../src/masscan.ts'

const FIXTURE_COMPLETE = `[
  { "ip": "192.0.2.10", "ports": [ { "port": 443, "proto": "tcp", "status": "open" }, { "port": 80, "proto": "tcp", "status": "open" } ] },
  { "ip": "192.0.2.11", "ports": [ { "port": 22, "proto": "tcp", "status": "open" } ] }
]`

const FIXTURE_TRUNCATED = `[
  { "ip": "192.0.2.10", "ports": [ { "port": 443, "proto": "tcp", "status": "open" } ] },
  { "ip": "192.0.2.11", "ports": [ { "port": 22, "proto": "tcp", "status": "open" } ] },
  { "ip": "192.0.2.12", "ports": [ { "port": 8`

describe('buildMasscanArgv', () => {
  it('builds a minimal argv with JSON stdout and the default rate', () => {
    const argv = buildMasscanArgv('/usr/bin/masscan', { target: '10.0.0.0/24' }, 1000)
    expect(argv).toEqual(['/usr/bin/masscan', '-oJ', '-', '--rate', '100', '10.0.0.0/24'])
  })

  it('adds ports and an explicit rate', () => {
    const argv = buildMasscanArgv('masscan', { target: '10.0.0.1-10.0.0.9', ports: '22,80,443', rate: 500 }, 1000)
    expect(argv).toEqual(['masscan', '-oJ', '-', '--rate', '500', '-p', '22,80,443', '10.0.0.1-10.0.0.9'])
  })

  it('rejects option injection, bad ports, and out-of-cap rates', () => {
    expect(() => buildMasscanArgv('masscan', { target: '-iL' }, 1000)).toThrow(TypeError)
    expect(() => buildMasscanArgv('masscan', { target: '10.0.0.1; rm -rf /' }, 1000)).toThrow(TypeError)
    expect(() => buildMasscanArgv('masscan', { target: '10.0.0.1', ports: '80;id' }, 1000)).toThrow(TypeError)
    expect(() => buildMasscanArgv('masscan', { target: '10.0.0.1', rate: 1001 }, 1000)).toThrow(TypeError)
    expect(() => buildMasscanArgv('masscan', { target: '10.0.0.1', rate: 0 }, 1000)).toThrow(TypeError)
    expect(() => buildMasscanArgv('masscan', { target: '10.0.0.1' }, 1_000_001)).toThrow(TypeError)
  })
})

describe('parseMasscanJson', () => {
  it('parses a complete array document', () => {
    const rows = parseMasscanJson(FIXTURE_COMPLETE)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ ip: '192.0.2.10', ports: [{ port: 443, proto: 'tcp', status: 'open' }, { port: 80, proto: 'tcp', status: 'open' }] })
    expect(rows[1]?.ports[0]).toEqual({ port: 22, proto: 'tcp', status: 'open' })
  })

  it('parses a truncated stream by dropping the incomplete trailing object', () => {
    const rows = parseMasscanJson(FIXTURE_TRUNCATED)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({ ip: '192.0.2.11', ports: [{ port: 22, proto: 'tcp', status: 'open' }] })
  })

  it('falls back to regex ip/port extraction for non-array documents', () => {
    const rows = parseMasscanJson('noise\n{"ip": "192.0.2.10", "ports": [ { "port": 443 } ] }\nnoise')
    expect(rows).toEqual([{ ip: '192.0.2.10', ports: [{ port: 443 }] }])
  })

  it('returns no rows for empty output', () => {
    expect(parseMasscanJson('')).toEqual([])
    expect(parseMasscanJson('   \n')).toEqual([])
  })
})
