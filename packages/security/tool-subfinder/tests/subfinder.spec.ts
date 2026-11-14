import { describe, expect, it } from 'vitest'
import { buildSubfinderArgv, parseSubfinderJsonLines } from '../src/subfinder.ts'

describe('buildSubfinderArgv', () => {
  it('builds a minimal argv with JSON output and one domain', () => {
    const argv = buildSubfinderArgv('/usr/local/bin/subfinder', { domain: 'example.com' })
    expect(argv).toEqual(['/usr/local/bin/subfinder', '-json', '-domain', 'example.com'])
  })

  it('adds resolve and active flags', () => {
    const argv = buildSubfinderArgv('subfinder', { domain: 'example.com', resolve: true, active: true })
    expect(argv).toEqual(['subfinder', '-json', '-domain', 'example.com', '-resolve', '-active'])
  })

  it('rejects option injection, scheme contamination, and bare TLDs', () => {
    expect(() => buildSubfinderArgv('subfinder', { domain: '-config' })).toThrow(TypeError)
    expect(() => buildSubfinderArgv('subfinder', { domain: 'example.com; id' })).toThrow(TypeError)
    expect(() => buildSubfinderArgv('subfinder', { domain: 'https://example.com' })).toThrow(TypeError)
    expect(() => buildSubfinderArgv('subfinder', { domain: 'localhost' })).toThrow(TypeError)
    expect(() => buildSubfinderArgv('subfinder', { domain: '' })).toThrow(TypeError)
  })
})

describe('parseSubfinderJsonLines', () => {
  it('parses one JSON object per line and dedupes hosts', () => {
    const stdout = [
      '{"host":"api.example.com","source":"crtsh"}',
      '{"host":"www.example.com","source":"hackertarget","a":["192.0.2.10","192.0.2.11"]}',
      '{"host":"api.example.com","source":"virustotal"}',
      '{"host":"v6.example.com","source":"dnsx","aaaa":["2001:db8::1"]}',
    ].join('\n')
    const results = parseSubfinderJsonLines(stdout)
    expect(results).toHaveLength(3)
    expect(results[0]?.host).toBe('api.example.com')
    expect(results[0]?.source).toBe('crtsh')
    expect(results[1]?.addrs).toEqual(['192.0.2.10', '192.0.2.11'])
    expect(results[2]?.addrs).toEqual(['2001:db8::1'])
  })

  it('skips blank, non-JSON, and malformed lines plus records without host', () => {
    expect(parseSubfinderJsonLines('')).toHaveLength(0)
    expect(parseSubfinderJsonLines('plain text')).toHaveLength(0)
    expect(parseSubfinderJsonLines('{"source":"crtsh"}')).toHaveLength(0)
    expect(parseSubfinderJsonLines('{"host":"a.example.com"}\n{"host":broken')).toHaveLength(1)
  })
})
