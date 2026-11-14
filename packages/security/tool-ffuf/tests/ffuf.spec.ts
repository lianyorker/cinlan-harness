import { describe, expect, it } from 'vitest'
import { buildFfufArgv, parseFfufJson } from '../src/ffuf.ts'

describe('buildFfufArgv', () => {
  it('builds a minimal argv with JSON stdout and auto-calibration', () => {
    const argv = buildFfufArgv('/usr/local/bin/ffuf', { url: 'https://t.example.com/FUZZ', wordlist: '/usr/share/wordlists/common.txt' })
    expect(argv).toEqual(['/usr/local/bin/ffuf', '-w', '/usr/share/wordlists/common.txt', '-u', 'https://t.example.com/FUZZ', '-json', '-s', '-ac'])
  })

  it('adds method, match codes, extra wordlists, redirects, and timeout', () => {
    const argv = buildFfufArgv('ffuf', {
      url: 'https://t.example.com/?q=FUZZ&x=NAME',
      wordlist: 'words/common.txt',
      extraWordlists: [{ path: 'words/names.txt', keyword: 'NAME' }],
      method: 'POST',
      matchCodes: [200, 301],
      autoCalibrate: false,
      followRedirects: true,
      timeoutSeconds: 15,
    })
    expect(argv).toEqual([
      'ffuf', '-w', 'words/common.txt', '-w', 'words/names.txt:NAME',
      '-u', 'https://t.example.com/?q=FUZZ&x=NAME', '-json', '-s',
      '-X', 'POST', '-mc', '200,301', '-r', '-timeout', '15',
    ])
  })

  it('rejects missing scheme, missing FUZZ keyword, injection, and bad values', () => {
    expect(() => buildFfufArgv('ffuf', { url: 'ftp://t.example.com/FUZZ', wordlist: 'w.txt' })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: 'https://t.example.com/no-keyword', wordlist: 'w.txt' })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: '-mc', wordlist: 'w.txt' })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: 'https://t/FUZZ', wordlist: '-w' })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: 'https://t/FUZZ', wordlist: 'w.txt;id' })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: 'https://t/FUZZ', wordlist: 'w.txt', method: 'GET;id' })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: 'https://t/FUZZ', wordlist: 'w.txt', matchCodes: [99] })).toThrow(TypeError)
    expect(() => buildFfufArgv('ffuf', { url: 'https://t/FUZZ', wordlist: 'w.txt', timeoutSeconds: 0 })).toThrow(TypeError)
  })
})

describe('parseFfufJson', () => {
  it('parses the single JSON document with a results array', () => {
    const stdout = JSON.stringify({
      results: [
        { input: { FUZZ: 'admin' }, url: 'https://t.example.com/admin', status: 403, length: 274, words: 25, lines: 5 },
        { input: { FUZZ: 'backup.zip' }, url: 'https://t.example.com/backup.zip', status: 200, length: 10240 },
        { no_url: true },
      ],
    })
    const matches = parseFfufJson(stdout)
    expect(matches).toHaveLength(2)
    expect(matches[0]).toEqual({ keyword: 'admin', url: 'https://t.example.com/admin', status: 403, length: 274, words: 25, lines: 5 })
    expect(matches[1]?.status).toBe(200)
    expect(matches[1]?.words).toBeUndefined()
  })

  it('yields empty results for blank or malformed output', () => {
    expect(parseFfufJson('')).toHaveLength(0)
    expect(parseFfufJson('not json')).toHaveLength(0)
    expect(parseFfufJson('{"no_results":true}')).toHaveLength(0)
    expect(parseFfufJson('{"results":["bad",null]}')).toHaveLength(0)
  })
})
