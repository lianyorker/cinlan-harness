/** Read-only import of concrete Host entries from the managing Host's OpenSSH configuration. */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Config } from './config.ts'
import { ExecutionTargetError } from './errors.ts'
import type { ImportableHostsValue, SshConfigHost } from './types.ts'

const IMPORTED_KEYWORDS = new Set(['hostname', 'user', 'port', 'identityfile', 'proxycommand', 'proxyjump'])

/**
 * Decide whether one Host pattern names a single concrete destination.
 * @param pattern Host pattern as written in the configuration.
 * @returns true only for a literal pattern, so wildcards and negations are skipped.
 */
function isConcrete(pattern: string): boolean {
  return pattern.length > 0 && !pattern.includes('*') && !pattern.includes('?') && !pattern.startsWith('!')
}

function parsePort(text: string): number | undefined {
  const value = Number(text)
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : undefined
}

function firstValue(fields: Map<string, string>, key: string): string | undefined {
  const value = fields.get(key)
  return value === undefined || value === '' ? undefined : value
}

/**
 * Extract concrete Host entries from OpenSSH client configuration text.
 *
 * OpenSSH resolves the first obtained value for each keyword, so the first
 * occurrence inside a block wins; a Match block ends the unconditional block
 * and its keywords are conditional, so nothing after it is imported, and
 * Include is not followed.
 * @param content Configuration file text.
 * @returns one entry per concrete Host pattern, in file order.
 */
export function parseSshConfigHosts(content: string): SshConfigHost[] {
  const entries: SshConfigHost[] = []
  let patterns: string[] | undefined
  let fields = new Map<string, string>()
  const flush = (): void => {
    const current = patterns
    if (current === undefined) return
    patterns = undefined
    const host = firstValue(fields, 'hostname')
    const username = firstValue(fields, 'user')
    const identityFile = firstValue(fields, 'identityfile')
    const proxyCommand = firstValue(fields, 'proxycommand')
    const jumpHost = firstValue(fields, 'proxyjump')
    const rawPort = firstValue(fields, 'port')
    const port = rawPort === undefined ? undefined : parsePort(rawPort)
    fields = new Map()
    for (const pattern of current) {
      if (!isConcrete(pattern)) continue
      entries.push({
        alias: pattern,
        ...host === undefined ? {} : { host },
        ...username === undefined ? {} : { username },
        ...port === undefined ? {} : { port },
        ...identityFile === undefined ? {} : { identityFile },
        ...proxyCommand === undefined ? {} : { proxyCommand },
        ...jumpHost === undefined ? {} : { jumpHost },
      })
    }
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const parts = line.split(/[\s=]+/).filter(part => part !== '')
    const keyword = (parts[0] ?? '').toLowerCase()
    const value = parts.slice(1).join(' ')
    if (keyword === 'host') { flush(); patterns = value.split(/\s+/).filter(Boolean) }
    else if (keyword === 'match') flush()
    else if (patterns !== undefined && IMPORTED_KEYWORDS.has(keyword) && !fields.has(keyword)) fields.set(keyword, value)
  }
  flush()
  return entries
}

/**
 * Read import candidates without ever writing the configuration back.
 * @param config Deployment configuration owning the OpenSSH configuration path.
 * @returns the exact source path, whether it exists, and its concrete Host entries.
 * @throws when the file exists but cannot be read.
 */
export async function readImportableHosts(config: Config): Promise<ImportableHostsValue> {
  const source = config.sshConfigFile ?? join(homedir(), '.ssh', 'config')
  let content: string
  try {
    content = await readFile(source, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { source, exists: false, entries: [] }
    throw new ExecutionTargetError('configuration-unreadable', 'OpenSSH configuration could not be read', { cause: error })
  }
  return { source, exists: true, entries: parseSshConfigHosts(content) }
}
