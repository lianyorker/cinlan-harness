/**
 * Offline CVE/PoC playbook service (`ctx.vulnPlaybook`): indexes the bundled
 * Markdown corpus under `assets/knowledge` and scores entries against
 * observed fingerprints. Model-facing surface is the `playbook_*` tool set;
 * matching is local-only — no network, no subprocess, no code execution.
 *
 * The corpus was imported from a reviewed third-party playbook archive (see
 * `assets/resource-provenance.json`); entries describe public vulnerability
 * material and are marked `verified: false` until reproduced on a target.
 *
 * @module @cinlan/vuln-playbook
 */

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { indexPlaybookEntry, matchPlaybookEntries } from './matcher.ts'
import type {
  PlaybookEntry,
  PlaybookMatchHit,
  PlaybookMatchInput,
  PlaybookReadResult,
  VulnPlaybookLike,
} from './types.ts'

export type {
  PlaybookEntry,
  PlaybookFrontmatter,
  PlaybookMatchHit,
  PlaybookMatchInput,
  PlaybookReadResult,
  VulnPlaybookLike,
} from './types.ts'
export { indexPlaybookEntry, matchPlaybookEntries, parsePlaybookFrontmatter, playbookTokens } from './matcher.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vulnPlaybook: VulnPlaybook
  }
}

/** Plugin configuration; every deployment-varying choice lives here. */
export interface Config {
  /** Corpus root; defaults to the bundled `assets/knowledge` directory. */
  readonly corpusDir?: string
  /** Maximum corpus Markdown files indexed; defaults to 2000. */
  readonly maxEntries?: number
  /** Maximum UTF-8 bytes returned by one playbook_read call; defaults to 24000. */
  readonly maxReadBytes?: number
  /** Maximum UTF-8 bytes in one match result; defaults to 32768. */
  readonly maxResultBytes?: number
}

const DEFAULT_MAX_ENTRIES = 2000
const DEFAULT_MAX_READ_BYTES = 24_000
const DEFAULT_MAX_RESULT_BYTES = 32_768
const CONFIG_KEYS = new Set(['corpusDir', 'maxEntries', 'maxReadBytes', 'maxResultBytes'])

interface ResolvedConfig {
  readonly corpusDir: string
  readonly maxEntries: number
  readonly maxReadBytes: number
  readonly maxResultBytes: number
}

function defaultCorpusDir(): string {
  // src/index.ts and lib/index.js sit one level below the package root in
  // both development (src/) and packaged (lib/) layouts, so `../assets` is
  // stable either way.
  return fileURLToPath(new URL('../assets/knowledge', import.meta.url))
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`vuln-playbook: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    corpusDir: config.corpusDir ?? defaultCorpusDir(),
    maxEntries: config.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxReadBytes: config.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    maxResultBytes: config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES,
  }
  for (const key of ['maxEntries', 'maxReadBytes', 'maxResultBytes'] as const) {
    const value = resolved[key]
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`vuln-playbook: ${key} must be a positive safe integer`)
    }
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`vuln-playbook: result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Walk the corpus and index every Markdown entry, bounded by `maxEntries`. */
export function loadPlaybookCorpus(corpusDir: string, maxEntries = DEFAULT_MAX_ENTRIES): PlaybookEntry[] {
  const entries: PlaybookEntry[] = []
  let categories: string[] = []
  try {
    categories = readdirSync(corpusDir, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => item.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return entries
  }
  outer: for (const category of categories) {
    const dir = join(corpusDir, category)
    let files: string[] = []
    try {
      files = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.md') && name.toLowerCase() !== 'skill.md')
    } catch {
      continue
    }
    for (const file of files.sort((a, b) => a.localeCompare(b))) {
      if (entries.length >= maxEntries) break outer
      const full = join(dir, file)
      let text = ''
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const relativeFile = relative(corpusDir, full).split(sep).join('/')
      entries.push(indexPlaybookEntry(relativeFile, category, full, text))
    }
  }
  return entries
}

/**
 * Playbook corpus service. The index is built lazily on first use and
 * rebuilds each query so corpus edits take effect without restart — the
 * corpus is small (~180 files) so a full rescan is cheap.
 */
export class VulnPlaybook extends Service implements VulnPlaybookLike {
  static inject = ['tools']

  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'vulnPlaybook')
    this.config = resolveConfig(config)
    registerPlaybookTools(ctx, this, this.config)
  }

  private corpus(): PlaybookEntry[] {
    return loadPlaybookCorpus(this.config.corpusDir, this.config.maxEntries)
  }

  /** Score the corpus against one observed fingerprint; returns ranked hits. */
  match(input: PlaybookMatchInput, limit: number = 5): PlaybookMatchHit[] {
    return matchPlaybookEntries(this.corpus(), input, limit)
  }

  /** Read one entry's Markdown body by its stable `file` id. */
  read(file: string, maxBytes: number = this.config.maxReadBytes): PlaybookReadResult {
    const key = String(file ?? '').trim()
    if (!key) throw new Error('vuln-playbook: read requires a file id from playbook_match')
    const hit = this.corpus().find(entry => entry.file === key || basename(entry.file) === key)
    if (!hit) throw new Error(`vuln-playbook: no playbook entry ${JSON.stringify(key)}; run playbook_match first`)
    const text = readFileSync(hit.path, 'utf8')
    const truncated = Buffer.byteLength(text, 'utf8') > maxBytes
    return {
      file: hit.file,
      category: hit.category,
      title: hit.title,
      cve: hit.cve,
      severity: hit.severity,
      content: truncated ? Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8') : text,
      truncated,
    }
  }

  /** Corpus size and per-category entry counts. */
  stats(): { entries: number; categories: Record<string, number> } {
    const categories: Record<string, number> = {}
    const entries = this.corpus()
    for (const entry of entries) categories[entry.category] = (categories[entry.category] ?? 0) + 1
    return { entries: entries.length, categories }
  }
}

const matchHitSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', required: true },
    category: { type: 'string', required: true },
    title: { type: 'string', required: true },
    cve: { type: 'string', required: true },
    severity: { type: 'string', required: true },
    product: { type: 'string', required: true },
    versions: { type: 'string', required: true },
    entry: { type: 'string', required: true },
    score: { type: 'integer', required: true },
    why: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/**
 * Register the `playbook_*` tool set on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param playbook - the corpus service the tools delegate to.
 * @param config - resolved limits applied to tool output.
 */
export function registerPlaybookTools(ctx: Context, playbook: VulnPlaybook, config: ResolvedConfig): void {
  ctx.tools.register(defineTool({
    name: 'playbook_match',
    description:
      'Match an observed fingerprint (port, banner, product name, header or response text) '
      + 'against the offline CVE/PoC playbook corpus. Returns ranked candidates with match '
      + 'reasons; call playbook_read on a chosen file id for the full entry. Local-only, '
      + 'no network access.',
    parameters: {
      port: { type: 'integer', description: 'One observed open port.' },
      banner: { type: 'string', description: 'Service banner or fingerprint text.' },
      product: { type: 'string', description: 'Product name if already identified.' },
      text: { type: 'string', description: 'Free-form text such as a response snippet or error string.' },
      limit: { type: 'integer', description: 'Positive maximum hits to return; defaults to 5, capped at 20.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: { type: 'array', required: true, items: matchHitSchema },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.hits.length === 0
          ? 'No playbook entries matched the fingerprint.'
          : `Matched ${value.hits.length} playbook entries:\n${value.hits.map(h => `  - [${h.score}] ${h.file} ${h.cve} ${h.title} (${h.why.join('; ')})`).join('\n')}`,
      }],
    },
    async execute(args) {
      const input: { port?: number; banner?: string; product?: string; text?: string } = {}
      if (args.port !== undefined) {
        const port = Number(args.port)
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
          throw new TypeError('vuln-playbook: port must be an integer between 1 and 65535')
        }
        input.port = port
      }
      if (args.banner !== undefined) input.banner = String(args.banner)
      if (args.product !== undefined) input.product = String(args.product)
      if (args.text !== undefined) input.text = String(args.text)
      const hits = playbook.match(input, args.limit === undefined ? 5 : Number(args.limit))
      const value = {
        hits: hits.map(hit => ({
          file: hit.file,
          category: hit.category,
          title: hit.title,
          cve: hit.cve,
          severity: hit.severity,
          product: hit.product,
          versions: hit.versions,
          entry: hit.entry,
          score: hit.score,
          why: [...hit.why],
        })),
      }
      enforceResultBytes(value, config.maxResultBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Match playbooks by fingerprint', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'playbook_read',
    description:
      'Read the full Markdown body of one playbook entry by its file id from playbook_match. '
      + 'Entries are public-material playbooks marked verified:false until reproduced — '
      + 'treat them as candidate guidance, not confirmed findings.',
    parameters: {
      file: {
        type: 'string',
        required: true,
        description: 'Entry id returned by playbook_match (e.g. web-cms/cve-2021-41773-apache-path-traversal.md).',
      },
      maxBytes: { type: 'integer', description: 'Positive byte cap for the returned body; defaults to 24000.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', required: true },
          category: { type: 'string', required: true },
          title: { type: 'string', required: true },
          cve: { type: 'string', required: true },
          severity: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `# ${value.title} [${value.severity}] ${value.cve}\n\n${value.content}${value.truncated ? '\n\n…(truncated)' : ''}`,
      }],
    },
    async execute(args) {
      const value = playbook.read(String(args.file), args.maxBytes === undefined ? undefined : Number(args.maxBytes))
      enforceResultBytes(value, config.maxResultBytes + config.maxReadBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Read playbook entry', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'playbook_list',
    description: 'List playbook corpus size and per-category entry counts.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: { type: 'integer', required: true },
          categories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                entries: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Playbook corpus: ${value.entries} entries\n${value.categories.map(category => `  - ${category.name}: ${category.entries}`).join('\n')}`,
      }],
    },
    async execute() {
      const stats = playbook.stats()
      const value = {
        entries: stats.entries,
        categories: Object.entries(stats.categories).map(([name, entries]) => ({ name, entries })),
      }
      enforceResultBytes(value, config.maxResultBytes)
      return value
    },
    presentCall: () => ({ card: 'generic', title: 'List playbook corpus', kind: 'other' }),
  }))
}
