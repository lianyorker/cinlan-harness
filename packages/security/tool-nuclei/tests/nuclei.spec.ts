import { describe, expect, it } from 'vitest'
import { buildNucleiArgv, parseNucleiJsonLines, type NucleiSeverity } from '../src/nuclei.ts'

describe('buildNucleiArgv', () => {
  it('builds a minimal argv with JSON output, no-color, and no interactsh', () => {
    const argv = buildNucleiArgv('/usr/local/bin/nuclei', { targets: ['https://scanme.nmap.org'] })
    expect(argv).toEqual(['/usr/local/bin/nuclei', '-json', '-silent', '-no-color', '-ni', 'https://scanme.nmap.org'])
  })

  it('adds template, severity, redirect, and timeout flags', () => {
    const argv = buildNucleiArgv('nuclei', {
      targets: ['https://a.example.com', 'https://b.example.com'],
      templates: ['cves/2023', 'technologies'],
      severities: ['high', 'critical'],
      followRedirects: true,
      timeoutSeconds: 15,
    })
    expect(argv).toEqual([
      'nuclei', '-json', '-silent', '-no-color', '-ni',
      '-t', 'cves/2023,technologies',
      '-severity', 'high,critical',
      '-follow-redirects', '-timeout', '15',
      'https://a.example.com', 'https://b.example.com',
    ])
  })

  it('rejects option injection, bad templates, bad severities, and bad timeouts', () => {
    expect(() => buildNucleiArgv('nuclei', { targets: ['-dast'] })).toThrow(TypeError)
    expect(() => buildNucleiArgv('nuclei', { targets: ['host; id'] })).toThrow(TypeError)
    expect(() => buildNucleiArgv('nuclei', { targets: [] })).toThrow(TypeError)
    expect(() => buildNucleiArgv('nuclei', { targets: ['https://a'], templates: ['-dast'] })).toThrow(TypeError)
    expect(() => buildNucleiArgv('nuclei', { targets: ['https://a'], severities: ['extreme' as NucleiSeverity] })).toThrow(TypeError)
    expect(() => buildNucleiArgv('nuclei', { targets: ['https://a'], timeoutSeconds: 0 })).toThrow(TypeError)
    expect(() => buildNucleiArgv('nuclei', { targets: ['https://a'], timeoutSeconds: 601 })).toThrow(TypeError)
  })
})

describe('parseNucleiJsonLines', () => {
  it('parses one JSON object per line into finding rows', () => {
    const stdout = [
      '{"template-id":"cve-2023-1234","name":"A CVE","severity":"high","host":"https://a.example.com","matched-at":"https://a.example.com/x","type":"http","tags":["cve","rce"],"reference":["https://example.com/advisory"]}',
      '{"template_id":"tech-detect","name":"Tech","severity":"info","host":"https://b.example.com","matched-at":"https://b.example.com/","type":"http"}',
      '{"template-id":"no-hit","name":"No hit","matcher-status":false,"host":"https://a.example.com"}',
    ].join('\n')
    const results = parseNucleiJsonLines(stdout)
    expect(results).toHaveLength(2)
    expect(results[0]?.templateId).toBe('cve-2023-1234')
    expect(results[0]?.severity).toBe('high')
    expect(results[0]?.tags).toEqual(['cve', 'rce'])
    expect(results[0]?.reference).toBe('https://example.com/advisory')
    expect(results[1]?.templateId).toBe('tech-detect')
  })

  it('skips blank, non-JSON, malformed, and nameless lines', () => {
    expect(parseNucleiJsonLines('')).toHaveLength(0)
    expect(parseNucleiJsonLines('plain text')).toHaveLength(0)
    expect(parseNucleiJsonLines('{"severity":"high"}')).toHaveLength(0)
    expect(parseNucleiJsonLines('{"template-id":"x","name":"X"}\n{"broken')).toHaveLength(1)
  })
})
