import { describe, expect, it } from 'vitest'
import { buildKatanaArgv, parseKatanaJsonLines } from '../src/katana.ts'

const FIXTURE_LINES = [
  '{"timestamp":"2026-11-15T00:00:00Z","request":{"method":"GET","url":"https://example.invalid/"},"response":{"status_code":200,"content_length":1256,"content_type":"text/html"},"source":"cli","tag":"root"}',
  '{"timestamp":"2026-11-15T00:00:01Z","request":{"method":"GET","url":"https://example.invalid/login"},"response":{"status_code":302},"source":"crawler","tag":"a"}',
  'not json',
  '',
].join('\n')

describe('buildKatanaArgv', () => {
  it('builds a minimal argv with fixed output flags and the default depth', () => {
    const argv = buildKatanaArgv('/usr/bin/katana', { url: 'https://example.invalid/' }, 10)
    expect(argv).toEqual([
      '/usr/bin/katana', '-json', '-silent', '-no-color', '-u', 'https://example.invalid/', '-d', '3',
    ])
  })

  it('adds depth and concurrency', () => {
    const argv = buildKatanaArgv('katana', { url: 'https://example.invalid/', depth: 5, concurrency: 4 }, 10)
    expect(argv).toEqual([
      'katana', '-json', '-silent', '-no-color', '-u', 'https://example.invalid/', '-d', '5', '-c', '4',
    ])
  })

  it('rejects non-http URLs, option injection, and out-of-bound depth/concurrency', () => {
    expect(() => buildKatanaArgv('katana', { url: 'ftp://example.invalid/' }, 10)).toThrow(TypeError)
    expect(() => buildKatanaArgv('katana', { url: '-u https://example.invalid/' }, 10)).toThrow(TypeError)
    expect(() => buildKatanaArgv('katana', { url: 'https://example.invalid/', depth: 6 }, 10)).toThrow(TypeError)
    expect(() => buildKatanaArgv('katana', { url: 'https://example.invalid/', depth: 0 }, 10)).toThrow(TypeError)
    expect(() => buildKatanaArgv('katana', { url: 'https://example.invalid/', concurrency: 11 }, 10)).toThrow(TypeError)
    expect(() => buildKatanaArgv('katana', { url: 'https://example.invalid/', concurrency: 0 }, 10)).toThrow(TypeError)
  })
})

describe('parseKatanaJsonLines', () => {
  it('parses request/response fields and skips unparseable lines', () => {
    const rows = parseKatanaJsonLines(FIXTURE_LINES)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      url: 'https://example.invalid/',
      method: 'GET',
      status: 200,
      contentLength: 1256,
      contentType: 'text/html',
      timestamp: '2026-11-15T00:00:00Z',
      source: 'cli',
      tag: 'root',
    })
    expect(rows[1]).toEqual({
      url: 'https://example.invalid/login',
      method: 'GET',
      status: 302,
      timestamp: '2026-11-15T00:00:01Z',
      source: 'crawler',
      tag: 'a',
    })
  })

  it('accepts flat url-only records and empty output', () => {
    expect(parseKatanaJsonLines('{"url":"https://example.invalid/x"}')).toEqual([{ url: 'https://example.invalid/x' }])
    expect(parseKatanaJsonLines('')).toEqual([])
  })
})
