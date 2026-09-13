/**
 * Bundled Cinlan skill provider.
 *
 * Registers a {@link SkillProvider} on `ctx.skills` that exposes the packaged
 * Cinlan cyber-security, design, and browser-evidence skills. Discovery is
 * lazy and only complete observations are cached.
 *
 * @module @deepseek-ai/dsh-security-skills
 */

import type { Dirent, Stats } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillLookupOptions,
  type SkillProvider,
  type SkillProviderControl,
  type SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { parse as parseYaml } from 'yaml'

const PROVIDER_NAME = 'security-skills'
const SKILLS_DIR = fileURLToPath(new URL('../assets/skills/', import.meta.url))

interface ParsedSkillFile {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  metadata?: Record<string, unknown>
  content: string
  directory: string
  path: string
}

interface DiscoveryResult {
  parsed: ParsedSkillFile[]
  complete: boolean
}

interface SkillLocator {
  path: string
  directory: string
}

/** Parse one skill Markdown file with YAML frontmatter. */
async function parseSkillFile(filePath: string, signal?: AbortSignal): Promise<ParsedSkillFile | undefined> {
  signal?.throwIfAborted()
  let raw: string
  try {
    raw = await readFile(filePath, { encoding: 'utf8', signal })
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentPathError(error)) return undefined
    throw error
  }

  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!frontmatterMatch) throw new Error('missing YAML frontmatter')

  let data: Record<string, unknown>
  try {
    const parsed = parseYaml(frontmatterMatch[1] ?? '') as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('frontmatter must be a YAML object')
    }
    data = parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`invalid YAML frontmatter: ${errorMessage(error)}`)
  }

  const name = stringField(data, 'name')
  const description = stringField(data, 'description')
  if (name === undefined || description === undefined) {
    throw new Error('frontmatter requires non-empty name and description')
  }
  if (!isSkillName(name)) throw new Error(`invalid skill name "${name}"`)

  const whenToUse = stringField(data, 'whenToUse')
  const invocation = parseInvocationPolicy(data)
  const metadata = optionalMetadata(data)
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    invocation,
    ...(metadata !== undefined ? { metadata } : {}),
    content: (frontmatterMatch[2] ?? '').trim(),
    directory: dirname(filePath),
    path: filePath,
  }
}

/** Discover all skill files below a root and report whether the result is authoritative. */
async function discoverSkillFiles(rootDir: string, ctx: Context, signal?: AbortSignal): Promise<DiscoveryResult> {
  const parsed: ParsedSkillFile[] = []
  let complete = true

  async function scanDir(dir: string, root = false): Promise<void> {
    signal?.throwIfAborted()
    let entries: Array<Dirent | string>
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      signal?.throwIfAborted()
      if (isAbsentPathError(error)) {
        if (root) {
          throw new Error(`security-skills: bundled skill directory is missing: ${rootDir}`)
        }
        complete = false
        return
      }
      ctx.logger.warn(`security-skills: failed to scan ${dir}: ${errorMessage(error)}`)
      complete = false
      return
    }

    for (const entry of entries) {
      signal?.throwIfAborted()
      // pkg's SEA filesystem provider can return names despite withFileTypes.
      // Stat only that external-runtime representation and keep failed reads
      // incomplete so the registry retries instead of caching a partial list.
      const name = typeof entry === 'string' ? entry : entry.name
      const fullPath = join(dir, name)
      let metadata: Dirent | Stats
      if (typeof entry === 'string') {
        try {
          metadata = await stat(fullPath)
        } catch (error) {
          signal?.throwIfAborted()
          if (!isAbsentPathError(error)) {
            ctx.logger.warn(`security-skills: failed to inspect ${fullPath}: ${errorMessage(error)}`)
          }
          complete = false
          continue
        }
      } else {
        metadata = entry
      }
      if (metadata.isDirectory()) {
        await scanDir(fullPath)
        continue
      }
      if (!metadata.isFile() || name !== 'SKILL.md') continue
      try {
        const skill = await parseSkillFile(fullPath, signal)
        if (skill !== undefined) {
          parsed.push(skill)
        } else {
          // The entry was present in the directory listing but disappeared
          // before its body could be read; retry instead of caching a partial catalog.
          complete = false
        }
      } catch (error) {
        signal?.throwIfAborted()
        ctx.logger.warn(`security-skills: ignored ${fullPath}: ${errorMessage(error)}`)
        complete = false
      }
    }
  }

  await scanDir(rootDir, true)
  return { parsed, complete }
}

function toCandidate(parsed: ParsedSkillFile): SkillCandidate {
  return {
    name: parsed.name,
    description: parsed.description,
    ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
    invocation: parsed.invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    locator: { path: parsed.path, directory: parsed.directory },
    resourceBase: { kind: 'directory', path: parsed.directory },
    path: parsed.path,
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  }
}

function createProvider(ctx: Context, control: SkillProviderControl): SkillProvider {
  let cachedCandidates: SkillCandidate[] | undefined
  let cachedParsed: ParsedSkillFile[] | undefined

  async function ensureDiscovered(signal?: AbortSignal): Promise<DiscoveryResult> {
    signal?.throwIfAborted()
    if (cachedParsed !== undefined) return { parsed: cachedParsed, complete: true }
    const result = await discoverSkillFiles(SKILLS_DIR, ctx, signal)
    if (result.complete) cachedParsed = result.parsed
    return result
  }

  async function ensureCandidates(signal?: AbortSignal): Promise<SkillProviderObservation> {
    signal?.throwIfAborted()
    if (cachedCandidates !== undefined) return { candidates: cachedCandidates, complete: true }
    const result = await ensureDiscovered(signal)
    const candidates = result.parsed.map(toCandidate)
    if (result.complete) cachedCandidates = candidates
    return { candidates, complete: result.complete }
  }

  return {
    name: PROVIDER_NAME,
    async list(options: SkillLookupOptions = {}): Promise<SkillProviderObservation> {
      return await ensureCandidates(combineSignals(control.signal, options.signal))
    },
    async get(candidate, options: SkillLookupOptions = {}): Promise<SkillDefinition | undefined> {
      const locator = candidate.locator as SkillLocator
      const signal = combineSignals(control.signal, options.signal)
      signal.throwIfAborted()
      const parsed = await parseSkillFile(locator.path, signal)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
        invocation: parsed.invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: locator.directory },
        path: locator.path,
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
        content: parsed.content,
      }
    },
  }
}

/** Cordis plugin name. */
export const name = 'security-skills'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled Cinlan skill provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(control => createProvider(ctx, control))
}

/** Combine a provider registration's lifetime with one caller's lookup lifetime. */
function combineSignals(registrationSignal: AbortSignal, lookupSignal?: AbortSignal): AbortSignal {
  if (lookupSignal === undefined || lookupSignal === registrationSignal) return registrationSignal
  return AbortSignal.any([registrationSignal, lookupSignal])
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalMetadata(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = data.metadata
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'modelInvocable', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'userInvocable', 'user-invocable')
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

function rejectLegacyInvocationKey(data: Record<string, unknown>, legacy: string, canonical: string): void {
  if (Object.hasOwn(data, legacy)) {
    throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function isAbsentPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function errorMessage(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
