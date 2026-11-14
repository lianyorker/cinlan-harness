import { describe, expect, it } from 'vitest'
import { buildHttpxArgv, parseHttpxJsonLines } from '../src/httpx.ts'

describe('buildHttpxArgv', () => {
  it('builds a minimal argv with JSON output and no-color', () => {
    const argv = buildHttpxArgv('/usr/local/bin/httpx', { targets: ['scanme.nmap.org'] })
    expect(argv).toEqual(['/usr/local/bin/httpx', '-json', '-no-color', '-silent', 'scanme.nmap.org'])
  })

  it('adds probe flags and multiple targets in request order', () => {
    const argv = buildHttpxArgv('httpx', {
      targets: ['10.0.0.1', 'example.com', 'https://example.org:8443'],
      statusCode: true,
      title: true,
      techDetect: true,
      followRedirects: true,
      https: false,
    })
    expect(argv).toEqual([
      'httpx', '-json', '-no-color', '-silent', '-status-code', '-title', '-tech-detect', '-follow-redirects', '-no-https',
      '10.0.0.1', 'example.com', 'https://example.org:8443',
    ])
  })

  it('rejects option injection, empty targets, and oversized batches', () => {
    expect(() => buildHttpxArgv('httpx', { targets: ['-status-code'] })).toThrow(TypeError)
    expect(() => buildHttpxArgv('httpx', { targets: ['host; id'] })).toThrow(TypeError)
    expect(() => buildHttpxArgv('httpx', { targets: [] })).toThrow(TypeError)
    expect(() => buildHttpxArgv('httpx', { targets: ['h'.repeat(300)] })).toThrow(TypeError)
    expect(() => buildHttpxArgv('httpx', { targets: Array.from({ length: 1001 }, (_, i) => `host${i}.example.com`) })).toThrow(TypeError)
  })
})

describe('parseHttpxJsonLines', () => {
  it('parses one JSON object per line into structured rows', () => {
    const stdout = [
      '{"url":"https://scanme.nmap.org","input":"scanme.nmap.org","status_code":200,"content-type":"text/html; charset=utf-8","content_length":6832,"title":"GoAhead WebServer","webserver":"GoAhead-http","cdn":"cloudflare","time":"0.25","technologies":["Nginx","Bootstrap"]}',
      '{"url":"http://192.0.2.1","input":"192.0.2.1","status_code":403,"content-type":"text/html"}',
      '{"no_url_field":true}',
    ].join('\n')
    const results = parseHttpxJsonLines(stdout)
    expect(results).toHaveLength(2)
    const first = results[0]
    expect(first?.url).toBe('https://scanme.nmap.org')
    expect(first?.statusCode).toBe(200)
    expect(first?.title).toBe('GoAhead WebServer')
    expect(first?.technologies).toEqual(['Nginx', 'Bootstrap'])
    expect(first?.cdn).toBe('cloudflare')
    expect(first?.webserver).toBe('GoAhead-http')
    const second = results[1]
    expect(second?.url).toBe('http://192.0.2.1')
    expect(second?.statusCode).toBe(403)
    expect(second?.title).toBeUndefined()
    expect(second?.technologies).toBeUndefined()
  })

  it('skips blank lines, non-JSON lines, ANSI-prefixed lines, and malformed JSON', () => {
    expect(parseHttpxJsonLines('')).toHaveLength(0)
    expect(parseHttpxJsonLines('plain text line')).toHaveLength(0)
    expect(parseHttpxJsonLines('{"url":"https://a"}\nnot json\n{"url":')).toHaveLength(1)
    expect(parseHttpxJsonLines('{"other":1}\n{"input":"192.0.2.2"}')).toHaveLength(1)
  })
})
