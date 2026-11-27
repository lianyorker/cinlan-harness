#!/usr/bin/env node
/**
 * Whitelist circuit-breaker for upstream file edits.
 *
 * Compares the working tree (committed + unstaged + untracked) against the
 * pinned upstream baseline. Every upstream file that differs must be
 * registered in `docs/dev/upstream-touch-allowlist.txt`; deletions always
 * fail. New files are free only under Cinlan-owned prefixes.
 *
 * Exit 1 on any violation. `!`-prefixed allowlist entries pass but warn.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ALLOWLIST = join(ROOT, 'docs/dev/upstream-touch-allowlist.txt')
const BASELINE_TAG = 'dsh-v0.2.3-alpha.2'
const BASELINE_COMMIT = '4b399c39a6d1479cd84ca591b4d7c88e24d38a96'

/** Prefixes Cinlan-owned additions may live under without registration. */
const OWNED_PREFIXES = [
  'docs/dev/',
  'scripts/cinlan/',
  'packages/cinlan',
  'packages/bundle/cinlan-',
]

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function baseline() {
  try {
    git('rev-parse', '--verify', `refs/tags/${BASELINE_TAG}`)
    return BASELINE_TAG
  } catch { return BASELINE_COMMIT }
}

/** One allowlist record: exact path or directory prefix, plus the flagged marker. */
function parseAllowlist() {
  const entries = []
  for (const raw of readFileSync(ALLOWLIST, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const [pathPart] = line.split(/\s+#/)
    const flagged = pathPart.startsWith('!')
    const path = (flagged ? pathPart.slice(1) : pathPart).trim()
    if (path === '') continue
    entries.push({ path, flagged, directory: path.endsWith('/') })
  }
  return entries
}

function match(entries, path) {
  return entries.find(entry => entry.directory ? path.startsWith(entry.path) : path === entry.path)
}

const base = baseline()
const changed = git('diff', '--name-status', `${base}`, '--')
  .split('\n').map(line => line.trim()).filter(Boolean)
const untracked = git('ls-files', '--others', '--exclude-standard')
  .split('\n').map(line => line.trim()).filter(Boolean)

const entries = existsSync(ALLOWLIST) ? parseAllowlist() : []
const violations = []
const flagged = []

for (const line of changed) {
  const [status, ...rest] = line.split('\t')
  const path = rest[rest.length - 1]
  if (status.startsWith('D')) {
    violations.push(`deleted upstream file: ${path}`)
    continue
  }
  const entry = match(entries, path)
  if (entry === undefined) violations.push(`modified upstream file not in allowlist: ${path}`)
  else if (entry.flagged) flagged.push(path)
}

for (const path of untracked) {
  if (OWNED_PREFIXES.some(prefix => path.startsWith(prefix))) continue
  if (match(entries, path) !== undefined) continue
  violations.push(`new file outside Cinlan-owned paths: ${path}`)
}

if (flagged.length > 0) {
  console.warn(`verify-upstream-untouched: WARNING ${flagged.length} flagged entr${flagged.length === 1 ? 'y' : 'ies'} (scope-expansion, pending YG confirmation):`)
  for (const path of flagged) console.warn(`  ! ${path}`)
}
if (violations.length > 0) {
  console.error(`verify-upstream-untouched: ${violations.length} violation(s) vs ${base}:`)
  for (const line of violations) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`verify-upstream-untouched: clean vs ${base} (${changed.length} registered change(s), ${untracked.length} new file(s))`)
