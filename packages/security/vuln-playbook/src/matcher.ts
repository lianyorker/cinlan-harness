/**
 * Pure scoring engine for the bundled playbook corpus. Ported from the
 * reviewed `dsh-prompt-custom` matcher (port/product/CVE/keyword weighted
 * ranking) and kept dependency-free so it can run anywhere.
 *
 * @module @cinlan/vuln-playbook/matcher
 */

import type {
  PlaybookEntry,
  PlaybookFrontmatter,
  PlaybookMatchHit,
  PlaybookMatchInput,
} from './types.ts'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

/** Generic terms that would make every fingerprint hit every entry. */
const STOPWORDS = new Set([
  'gateway', 'server', 'service', 'client', 'web', 'http', 'https', 'httpd',
  'api', 'admin', 'login', 'default', 'remote', 'manager', 'console', 'portal',
  'access', 'open', 'source', 'code', 'test', 'main', 'index', 'config',
  'system', 'vpn', 'ssl', 'tls', 'ipsec', 'cloud', 'security', 'edge', 'app',
  'gate', 'proxy', 'auth',
])

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word match: `active` must not hit `activemq`. */
const hasWord = (haystack: string, word: string) =>
  new RegExp('(?:^|[^a-z0-9])' + escapeRe(String(word).toLowerCase()) + '(?:$|[^a-z0-9])').test(haystack)

/** Lowercase token stream used for product/keyword/text comparisons. */
export function playbookTokens(value: unknown): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9.+_/-]+/)
    .filter(token => token.length >= 2)
}

/**
 * Parse the leading `---` frontmatter of one corpus file into a flat
 * `key: value` map. The corpus uses scalar values only; quoting is stripped.
 */
export function parsePlaybookFrontmatter(markdown: string): PlaybookFrontmatter {
  const source = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown
  const match = FRONTMATTER.exec(source)
  if (!match) return {}
  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (!/^[a-z][a-z0-9-]*$/.test(key)) continue
    fields[key] = line.slice(index + 1).trim().replace(/^["']|["']$/g, '')
  }
  return fields as PlaybookFrontmatter
}

/** Build the in-memory entry for one corpus Markdown file. */
export function indexPlaybookEntry(relativeFile: string, category: string, path: string, markdown: string): PlaybookEntry {
  const frontmatter = parsePlaybookFrontmatter(markdown)
  return {
    file: relativeFile,
    category,
    path,
    title: frontmatter.title || relativeFile,
    cve: frontmatter.cve || '',
    severity: frontmatter.severity || 'medium',
    cvss: frontmatter.cvss || '',
    product: frontmatter.product || '',
    versions: frontmatter.versions || '',
    entry: frontmatter.entry || '',
    ports: String(frontmatter.ports || '').split(/[,\s]+/).filter(p => /^\d+$/.test(p)).map(Number),
    keywordTokens: playbookTokens(frontmatter.keywords),
    rawKeywords: String(frontmatter.keywords || '').split(/[,，、\s]+/).map(x => x.trim()).filter(x => x.length >= 2),
    textTokens: playbookTokens([
      frontmatter.title, frontmatter.product, frontmatter.cve,
      frontmatter.keywords, frontmatter.entry, frontmatter.versions,
    ].join(' ')),
  }
}

/**
 * Score every entry against one fingerprint and return ranked hits.
 * Weights: port 35, product 60, CVE 20, latin keywords ≤16, CJK keywords ≤40,
 * fallback text tokens ≤18, critical +5. Local ranking only — no network,
 * no execution.
 */
export function matchPlaybookEntries(
  entries: readonly PlaybookEntry[],
  input: PlaybookMatchInput = {},
  limit = 5,
): PlaybookMatchHit[] {
  const ports = ([] as number[])
    .concat(Array.isArray(input.ports) ? [...input.ports] : [])
    .concat(input.port === undefined ? [] : [input.port])
    .map(p => Number(p))
    .filter(p => Number.isFinite(p))
  const haystackTokens = new Set([
    ...playbookTokens(input.banner),
    ...playbookTokens(input.product),
    ...playbookTokens(Object.values(input.headers ?? {}).join(' ')),
    ...playbookTokens(input.text),
  ])
  const haystackText = [
    input.banner, input.product, input.text,
    ...Object.values(input.headers ?? {}),
  ].filter(Boolean).join(' ').toLowerCase()

  const scored: Array<{ score: number; why: string[]; item: PlaybookEntry }> = []
  for (const item of entries) {
    let score = 0
    const why: string[] = []
    if (ports.length > 0 && item.ports.some(p => ports.includes(p))) {
      score += 35
      why.push('端口 ' + item.ports.filter(p => ports.includes(p)).join(','))
    }
    const productTokens = playbookTokens(item.product)
    const productHit = productTokens.some(t => t.length >= 3 && !STOPWORDS.has(t) && hasWord(haystackText, t))
    if (productHit) {
      score += 60
      why.push('产品 ' + item.product)
    }
    if (item.cve && item.cve !== '无' && hasWord(haystackText, item.cve)) {
      score += 20
      why.push('CVE ' + item.cve)
    }
    const kwHits = item.keywordTokens.filter(k => k.length >= 3 && !STOPWORDS.has(k) && hasWord(haystackText, k))
    if (kwHits.length > 0) {
      score += Math.min(16, kwHits.length * 8)
      why.push('关键词 ' + kwHits.slice(0, 4).join('/'))
    }
    const cnHits = item.rawKeywords.filter(k => /[一-龥]/.test(k) && haystackText.includes(k.toLowerCase()))
    if (cnHits.length > 0) {
      // Longer CJK keywords are more specific: 2 chars → 8, +2 per extra char, capped at 40.
      const cnScore = cnHits.reduce((sum, k) => sum + 8 + Math.max(0, (k.length - 2) * 2), 0)
      score += Math.min(40, cnScore)
      why.push('中文关键词 ' + cnHits.slice(0, 3).join('/'))
    }
    const titleHits = item.textTokens.filter(t => t.length >= 4 && !STOPWORDS.has(t) && haystackTokens.has(t))
    if (!productHit && titleHits.length > 0) {
      score += Math.min(18, titleHits.length * 6)
      why.push('命中 ' + titleHits.slice(0, 3).join('/'))
    }
    if (score === 0) continue
    if (item.severity === 'critical') score += 5
    scored.push({ score, why, item })
  }
  scored.sort((a, b) => b.score - a.score || a.item.file.localeCompare(b.item.file))
  return scored.slice(0, Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 5))).map(hit => ({
    file: hit.item.file,
    category: hit.item.category,
    title: hit.item.title,
    cve: hit.item.cve,
    severity: hit.item.severity,
    product: hit.item.product,
    versions: hit.item.versions,
    entry: hit.item.entry,
    ports: hit.item.ports,
    score: hit.score,
    why: hit.why,
  }))
}
