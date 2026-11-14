import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  indexPlaybookEntry,
  loadPlaybookCorpus,
  matchPlaybookEntries,
  parsePlaybookFrontmatter,
  playbookTokens,
} from '../src/index.ts'

const APACHE = `---
title: Apache HTTP Server 路径穿越 / CGI RCE
cve: CVE-2021-41773 / CVE-2021-42013
severity: critical
product: Apache HTTP Server
versions: 2.4.49
ports: 80, 443
keywords: httpd, apache, path traversal, cgi
entry: /cgi-bin/.%2e/
---

## 指纹
- Server: Apache/2.4.49
`

const SHIRO = `---
title: Apache Shiro rememberMe 反序列化
cve: CVE-2016-4437
severity: high
product: Apache Shiro
versions: <= 1.2.4
ports: 8080
keywords: shiro, rememberme, 反序列化
entry: Cookie: rememberMe
---

## 指纹
- Set-Cookie: rememberMe=deleteMe
`

const tmp = mkdtempSync(join(tmpdir(), 'vuln-playbook-spec-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('playbook matcher', () => {
  it('parses frontmatter scalars and ignores non-frontmatter files', () => {
    const fields = parsePlaybookFrontmatter(APACHE)
    expect(fields.title).toBe('Apache HTTP Server 路径穿越 / CGI RCE')
    expect(fields.cve).toBe('CVE-2021-41773 / CVE-2021-42013')
    expect(fields.severity).toBe('critical')
    expect(parsePlaybookFrontmatter('# no frontmatter')).toEqual({})
  })

  it('tokenizes lowercase and keeps version punctuation', () => {
    expect(playbookTokens('Apache HTTP Server 2.4.49')).toContain('apache')
    expect(playbookTokens('Apache HTTP Server 2.4.49')).toContain('2.4.49')
  })

  it('indexes one entry per markdown file under each category', () => {
    const entry = indexPlaybookEntry('web-cms/apache.md', 'web-cms', '/x/apache.md', APACHE)
    expect(entry.ports).toEqual([80, 443])
    expect(entry.keywordTokens).toContain('apache')
    expect(entry.rawKeywords).toContain('httpd')
  })

  it('ranks a product+port fingerprint above unrelated entries', () => {
    const apache = indexPlaybookEntry('web-cms/apache.md', 'web-cms', '/x/apache.md', APACHE)
    const shiro = indexPlaybookEntry('java-deser/shiro.md', 'java-deser', '/x/shiro.md', SHIRO)
    const hits = matchPlaybookEntries([apache, shiro], { port: 80, banner: 'Server: Apache/2.4.49' })
    expect(hits[0]!.file).toBe('web-cms/apache.md')
    expect(hits[0]!.why.join(' ')).toContain('产品')
    // "Apache" also tokens-matches "Apache Shiro"; the exact-product entry must outrank it.
    expect(hits[0]!.score).toBeGreaterThan(hits[1]?.score ?? 0)
  })

  it('hits Chinese keywords inside mixed-language fingerprints', () => {
    const shiro = indexPlaybookEntry('java-deser/shiro.md', 'java-deser', '/x/shiro.md', SHIRO)
    const hits = matchPlaybookEntries([shiro], { text: '登录接口疑似反序列化问题' })
    expect(hits[0]!.why.join(' ')).toContain('中文关键词')
  })

  it('requires at least one scoring signal', () => {
    const shiro = indexPlaybookEntry('java-deser/shiro.md', 'java-deser', '/x/shiro.md', SHIRO)
    expect(matchPlaybookEntries([shiro], { port: 22, banner: 'OpenSSH_9.2' })).toHaveLength(0)
  })

  it('loads a corpus directory into entries', () => {
    mkdirSync(join(tmp, 'web-cms'), { recursive: true })
    writeFileSync(join(tmp, 'web-cms', 'apache.md'), APACHE)
    writeFileSync(join(tmp, 'web-cms', 'SKILL.md'), '---\nname: kb-web-cms\n---\n')
    const entries = loadPlaybookCorpus(tmp)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.file).toBe('web-cms/apache.md')
  })
})
