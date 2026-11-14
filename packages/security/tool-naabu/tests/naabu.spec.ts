import { describe, expect, it } from 'vitest'
import { buildNaabuArgv, parseNaabuJsonLines } from '../src/naabu.ts'

describe('buildNaabuArgv', () => {
  it('builds a minimal argv with JSON output and an explicit port list', () => {
    const argv = buildNaabuArgv('/usr/local/bin/naabu', { targets: ['scanme.nmap.org'], ports: '22,80,443' })
    expect(argv).toEqual(['/usr/local/bin/naabu', '-json', '-silent', '-exclude-cdn', '-p', '22,80,443', 'scanme.nmap.org'])
  })

  it('accepts topPorts instead of ports and multiple targets', () => {
    const argv = buildNaabuArgv('naabu', { targets: ['10.0.0.1', '10.0.0.0/24'], ports: '', topPorts: 100 })
    expect(argv).toEqual(['naabu', '-json', '-silent', '-exclude-cdn', '-top-ports', '100', '10.0.0.1', '10.0.0.0/24'])
  })

  it('rejects option injection, missing ports, ports+topPorts, and oversized batches', () => {
    expect(() => buildNaabuArgv('naabu', { targets: ['-top-ports'], ports: '80' })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: ['host; id'], ports: '80' })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: ['10.0.0.1'], ports: '' })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: ['10.0.0.1'], ports: '22;id' })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: ['10.0.0.1'], ports: '80', topPorts: 10 })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: ['10.0.0.1'], ports: '', topPorts: 0 })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: [], ports: '80' })).toThrow(TypeError)
    expect(() => buildNaabuArgv('naabu', { targets: Array.from({ length: 1001 }, (_, i) => `10.0.0.${i % 256}`), ports: '80' })).toThrow(TypeError)
  })
})

describe('parseNaabuJsonLines', () => {
  it('parses one JSON object per line into structured port rows', () => {
    const stdout = [
      '{"host":"scanme.nmap.org","ip":"45.33.32.156","port":22,"protocol":"tcp"}',
      '{"host":"scanme.nmap.org","ip":"45.33.32.156","port":80}',
      '{"no_port":true}',
    ].join('\n')
    const results = parseNaabuJsonLines(stdout)
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ host: 'scanme.nmap.org', ip: '45.33.32.156', port: 22, protocol: 'tcp' })
    expect(results[1]).toEqual({ host: 'scanme.nmap.org', ip: '45.33.32.156', port: 80 })
  })

  it('skips blank, non-JSON, malformed, and hostless lines', () => {
    expect(parseNaabuJsonLines('')).toHaveLength(0)
    expect(parseNaabuJsonLines('plain text')).toHaveLength(0)
    expect(parseNaabuJsonLines('{"port":22}')).toHaveLength(0)
    expect(parseNaabuJsonLines('{"host":"a","port":22}\n{"host":"b","port":"x"}')).toHaveLength(1)
  })
})
