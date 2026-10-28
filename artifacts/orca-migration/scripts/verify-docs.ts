/** Validate only the migration material, using the repository Markdown parser. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { anchorCache, findViolations } from '../../../scripts/verify-md-links.ts'
import { markdownHeadingLines, parseMarkdown, visitMarkdown } from '../../../scripts/markdown.ts'
import { features } from './features.mjs'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const allowed = new Set(['一致', '部分实现', '仅有底层能力', '缺失', '设计不同', '待运行验收'])
const failures: string[] = []
const anchors = anchorCache()

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : []
  })
}

function validateFeature(feature: typeof features[number]): void {
  if (!allowed.has(feature.status)) throw new Error(`unknown status: ${feature.id}`)
  if (!/^P[012]$/.test(feature.priority)) throw new Error(`unknown priority: ${feature.id}`)
  for (const path of feature.harness) {
    if (!existsSync(resolve(repo, path))) throw new Error(`missing Harness source: ${path}`)
  }
}

function validateClhPrompt(text: string): void {
  const headings = markdownHeadingLines(text)
  const section = headings.find(heading => heading.depth === 2 && heading.text === 'CLH 二开隔离')
  if (section === undefined) throw new Error('missing CLH isolation section')
  const end = headings.find(heading => heading.index > section.index && heading.depth <= 2)?.index ?? Infinity
  let linked = false
  visitMarkdown(parseMarkdown(text), (node) => {
    if (node.type === 'link' && node.url === '../提示词使用规则.md#clh-isolation' && node.position
      && node.position.start.line > section.index && node.position.start.line < end) linked = true
  })
  if (!linked) throw new Error('missing CLH rules link inside isolation section')
}

const ids = new Set<string>()
for (const feature of features) {
  if (ids.has(feature.id)) failures.push(`duplicate feature: ${feature.id}`)
  ids.add(feature.id)
  validateFeature(feature)
  for (const name of ['差异分析.md', 'UI检查表.md', '迁移提示词.md']) {
    const path = resolve(root, 'docs', feature.id, name)
    if (!existsSync(path)) failures.push(`missing dossier: ${feature.id}/${name}`)
    else if (name === '迁移提示词.md') {
      try { validateClhPrompt(readFileSync(path, 'utf8')) } catch (error) {
        failures.push(`${feature.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

const files = [resolve(root, 'AGENTS.md'), ...markdownFiles(resolve(root, 'docs'))]
for (const path of files) {
  const text = readFileSync(path, 'utf8')
  if (!text.endsWith('\n') || text.endsWith('\n\n')) failures.push(`expected one trailing newline: ${path}`)
  if (text.split(/\r?\n/).some(line => /[\t ]$/.test(line))) failures.push(`trailing whitespace: ${path}`)
  failures.push(...findViolations(path, anchors, repo).map(v => `${v.file}:${v.line} ${v.url} (${v.reason})`))
  visitMarkdown(parseMarkdown(text), (node) => {
    if (node.type === 'paragraph' && node.position && node.position.end.line > node.position.start.line) {
      failures.push(`hard-wrapped paragraph: ${path}:${node.position.start.line}`)
    }
  })
}

const baseline = JSON.parse(readFileSync(resolve(root, 'exports/baseline.json'), 'utf8')) as {
  featureCount: number
  harness: { files: { path: string; sha256: string }[] }
  originalPrompts: { path: string; sha256: string }[]
  downloadedReferences: { path: string; sha256: string }[]
}
if (baseline.featureCount !== features.length) failures.push('feature count differs from baseline')
for (const record of baseline.originalPrompts) {
  const actual = createHash('sha256').update(readFileSync(resolve(root, record.path))).digest('hex')
  if (actual !== record.sha256) failures.push(`original prompt changed: ${record.path}`)
}
for (const record of baseline.harness.files) {
  const actual = createHash('sha256').update(readFileSync(resolve(repo, record.path))).digest('hex')
  if (actual !== record.sha256) failures.push(`Harness source changed since review: ${record.path}`)
}
const known = new Set(baseline.downloadedReferences.map(record => record.path))
for (const feature of features) {
  for (const path of feature.upstream) if (!known.has(path)) failures.push(`upstream path missing from baseline: ${path}`)
}

// Reject malformed review inputs before checking the real corpus.
for (const mutation of [{ status: 'implemented' }, { priority: 'P9' }, { harness: ['missing-migration-source.ts'] }]) {
  let rejected = false
  try { validateFeature({ ...features[0]!, ...mutation }) } catch (_error) { rejected = true }
  if (!rejected) failures.push(`negative validation case accepted: ${JSON.stringify(mutation)}`)
}

for (const text of ['[CLH rules](../提示词使用规则.md#clh-isolation)\n', '## CLH 二开隔离\n\nNo rules link.\n']) {
  let rejected = false
  try { validateClhPrompt(text) } catch (_error) { rejected = true }
  if (!rejected) failures.push(`negative CLH prompt case accepted: ${JSON.stringify(text)}`)
}

if (failures.length) {
  for (const failure of failures) console.error(failure)
  process.exitCode = 1
} else console.log(`migration validation: ${features.length} features, ${files.length} Markdown files, 5 rejection cases passed`)
