import { describe, expect, it } from 'vitest'
import { buildGauArgv, parseGauLines } from '../src/gau.ts'

const FIXTURE_LINES = [
  '{"url":"https://example.invalid/a","domain":"example.invalid"}',
  'https://example.invalid/b?x=1',
  '{"url":"https://example.invalid/a"}',
  'not a url line?? maybe',
  '',
].join('\n')

describe('buildGauArgv', () => {
  it('builds a minimal argv with fixed --json --subs and the positional domain', () => {
    const argv = buildGauArgv('/usr/bin/gau', { domain: 'example.invalid' })
    expect(argv).toEqual(['/usr/bin/gau', '--json', '--subs', 'example.invalid'])
  })

  it('adds a whitelisted providers list', () => {
    const argv = buildGauArgv('gau', { domain: 'example.invalid', providers: ['wayback', 'commoncrawl'] })
    expect(argv).toEqual(['gau', '--json', '--subs', '--providers', 'wayback,commoncrawl', 'example.invalid'])
  })

  it('rejects option injection and non-whitelisted providers', () => {
    expect(() => buildGauArgv('gau', { domain: '-o /tmp/x' })).toThrow(TypeError)
    expect(() => buildGauArgv('gau', { domain: 'example.invalid; rm -rf /' })).toThrow(TypeError)
    expect(() => buildGauArgv('gau', { domain: 'example.invalid', providers: ['shodan'] })).toThrow(TypeError)
    expect(() => buildGauArgv('gau', { domain: 'example.invalid', providers: [] })).toThrow(TypeError)
  })
})

describe('parseGauLines', () => {
  it('accepts both JSON records and plain URL lines and deduplicates', () => {
    const urls = parseGauLines(FIXTURE_LINES)
    expect(urls).toEqual([
      'https://example.invalid/a',
      'https://example.invalid/b?x=1',
      'not a url line?? maybe',
    ])
  })

  it('returns no rows for empty output', () => {
    expect(parseGauLines('')).toEqual([])
    expect(parseGauLines('\n  \n')).toEqual([])
  })
})
