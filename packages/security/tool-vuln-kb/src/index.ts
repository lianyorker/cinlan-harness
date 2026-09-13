/**
 * Model-facing vulnerability knowledge base tools. Registers `vuln_query`
 * and `vuln_read` on `ctx.tools`. Each tool delegates to `ctx.vulnKb` and
 * returns a byte-bounded result.
 *
 * @module @deepseek-ai/dsh-tool-vuln-kb
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CveId, type CveId as CveIdType, type VulnQueryRequest } from '@deepseek-ai/dsh-vuln-kb-service'

export const name = 'tool-vuln-kb'
export const inject = ['tools', 'vulnKb']

/** Deployment bounds for model-visible vulnerability results. */
export interface Config {
  /** Maximum UTF-8 bytes in one compact query result. */
  readonly maxQueryBytes?: number
  /** Maximum UTF-8 bytes in one complete read result. */
  readonly maxReadBytes?: number
}

const DEFAULT_MAX_QUERY_BYTES = 262_144
const DEFAULT_MAX_READ_BYTES = 262_144
const CONFIG_KEYS = new Set(['maxQueryBytes', 'maxReadBytes'])

interface ResolvedConfig {
  readonly maxQueryBytes: number
  readonly maxReadBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-vuln-kb: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    maxQueryBytes: config.maxQueryBytes ?? DEFAULT_MAX_QUERY_BYTES,
    maxReadBytes: config.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`tool-vuln-kb: ${key} must be a positive safe integer`)
    }
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-vuln-kb: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function validateCveId(value: string): CveIdType {
  const normalized = value.trim().toUpperCase()
  if (!/^CVE-[0-9]{4}-[0-9]{4,}$/.test(normalized)) {
    throw new TypeError(`tool-vuln-kb: invalid CVE id ${JSON.stringify(value)}`)
  }
  return CveId(normalized)
}

function validateQueryArgs(args: {
  cveId?: string
  ecosystem?: string
  package?: string
  version?: string
  maxResults?: number
}): void {
  if (args.maxResults !== undefined && (!Number.isSafeInteger(args.maxResults) || args.maxResults < 1)) {
    throw new TypeError('tool-vuln-kb: maxResults must be a positive safe integer')
  }
  if (args.cveId !== undefined) {
    validateCveId(args.cveId)
    return
  }
  if (args.ecosystem === undefined || args.package === undefined) {
    throw new TypeError('tool-vuln-kb: query requires cveId or ecosystem+package')
  }
  validateQueryText(args.ecosystem, 'ecosystem')
  validateQueryText(args.package, 'package')
  validateQueryText(args.version, 'version', true)
}

function validateQueryText(value: string | undefined, name: string, optional = false): void {
  if (value === undefined && optional) return
  if (value === undefined || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`tool-vuln-kb: ${name} must be non-empty without surrounding whitespace`)
  }
}

/**
 * Register the vulnerability KB tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and vulnKb runtime.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.tools.register(defineTool({
    name: 'vuln_query',
    description:
      'Query the vulnerability knowledge base for CVEs by package name and ecosystem, '
      + 'optionally filtered by version. Returns compact matching entries with severity '
      + 'and fix availability; use vuln_read for affected ranges and references.',
    parameters: {
      cveId: {
        type: 'string',
        description: 'Specific CVE id (e.g., CVE-2024-12345). If provided, ecosystem/package/version are ignored.',
      },
      ecosystem: {
        type: 'string',
        description: 'Package ecosystem (e.g., npm, pypi, maven, go, nuget). Required if cveId is not provided.',
      },
      package: {
        type: 'string',
        description: 'Package name within the ecosystem. Required if cveId is not provided.',
      },
      version: {
        type: 'string',
        description: 'Specific version to check for affectedness. Optional.',
      },
      maxResults: {
        type: 'integer',
        description: 'Positive maximum number of results to return. The active provider supplies the default.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                source: { type: 'string', required: true },
                summary: { type: 'string', required: true },
                severity: { type: 'string', required: true },
                hasFix: { type: 'boolean', required: true },
                published: { type: 'string' },
                modified: { type: 'string' },
              },
            },
          },
          total: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? 'No vulnerabilities found.'
          : `Found ${value.total} vulnerabilities (${value.entries.length} shown${value.truncated ? ', truncated' : ''}):\n${value.entries.map(e => `  - ${e.id} [${e.severity}] ${e.summary}${e.hasFix ? ' (fix available)' : ''}`).join('\n')}`,
      }],
    },
    async execute(args, exec) {
      validateQueryArgs(args)
      const request: Record<string, unknown> = {}
      if (args.cveId !== undefined) request.cveId = validateCveId(args.cveId)
      if (args.ecosystem !== undefined) request.ecosystem = args.ecosystem
      if (args.package !== undefined) request.package = args.package
      if (args.version !== undefined) request.version = args.version
      if (args.maxResults !== undefined) request.maxResults = args.maxResults
      const result = await ctx.vulnKb.query(request as VulnQueryRequest, exec.signal)
      const value = {
        entries: result.entries.map(e => ({
          id: e.id,
          source: e.source,
          summary: e.summary,
          severity: e.severity,
          hasFix: e.hasFix,
          ...(e.published !== undefined ? { published: e.published } : {}),
          ...(e.modified !== undefined ? { modified: e.modified } : {}),
        })),
        total: result.total,
        truncated: result.truncated,
      }
      enforceResultBytes(value, resolved.maxQueryBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Query vulnerability KB', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'vuln_read',
    description:
      'Read full details of a single vulnerability by CVE id, including description, '
      + 'CVSS vector, affected package ranges, and reference URLs.',
    parameters: {
      cveId: {
        type: 'string',
        required: true,
        description: 'The CVE id (e.g., CVE-2024-12345).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          source: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          description: { type: 'string', required: true },
          severity: { type: 'string', required: true },
          cvssVector: { type: 'string' },
          published: { type: 'string' },
          modified: { type: 'string' },
          hasFix: { type: 'boolean', required: true },
          affected: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ecosystem: { type: 'string', required: true },
                package: { type: 'string', required: true },
                rangeType: {
                  type: 'string',
                  required: true,
                  enum: ['semver', 'ecosystem', 'git', 'cpe', 'versions'],
                  description: 'Version range scheme supplied by the provider.',
                },
                introduced: { type: 'string', description: 'Lower affected bound.' },
                introducedInclusive: {
                  type: 'boolean',
                  description: 'Whether the introduced version is affected; defaults to true.',
                },
                fixed: {
                  type: 'string',
                  description: 'First unaffected version; the affected interval ends before it.',
                },
                lastAffected: { type: 'string', description: 'Inclusive final affected version.' },
                limit: { type: 'string', description: 'Provider-supplied upper range limit.' },
                versions: { type: 'array', items: { type: 'string' }, description: 'Discrete affected versions.' },
              },
            },
          },
          references: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                url: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    async execute(args, exec) {
      const entry = await ctx.vulnKb.read(validateCveId(args.cveId as string), exec.signal)
      const value = {
        id: entry.id,
        source: entry.source,
        summary: entry.summary,
        description: entry.description,
        severity: entry.severity,
        hasFix: entry.hasFix,
        ...(entry.cvssVector !== undefined ? { cvssVector: entry.cvssVector } : {}),
        ...(entry.published !== undefined ? { published: entry.published } : {}),
        ...(entry.modified !== undefined ? { modified: entry.modified } : {}),
        affected: entry.affected.map(a => ({
          ecosystem: a.ecosystem,
          package: a.package,
          rangeType: a.rangeType,
          ...(a.introduced !== undefined ? { introduced: a.introduced } : {}),
          ...(a.introducedInclusive !== undefined ? { introducedInclusive: a.introducedInclusive } : {}),
          ...(a.fixed !== undefined ? { fixed: a.fixed } : {}),
          ...(a.lastAffected !== undefined ? { lastAffected: a.lastAffected } : {}),
          ...(a.limit !== undefined ? { limit: a.limit } : {}),
          ...(a.versions !== undefined ? { versions: [...a.versions] } : {}),
        })),
        references: entry.references.map(r => ({
          source: r.source,
          url: r.url,
        })),
      }
      enforceResultBytes(value, resolved.maxReadBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Read vulnerability details', kind: 'other', rawInput: args }),
  }))
}
