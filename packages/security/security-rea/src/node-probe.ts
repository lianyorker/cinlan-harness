/** Pure helpers for REA runtime assessment; no cordis context required. */

/** Parsed semantic version triple. */
export interface NodeVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/**
 * Parse a `node --version` style string (`v24.22.2` or `24.22.2`).
 * @param text - Raw version output.
 * @returns Parsed triple, or undefined when the text is not a semver triple.
 */
export function parseNodeVersion(text: string): NodeVersion | undefined {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*$/u.exec(text)
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function compare(a: NodeVersion, b: NodeVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/** Result of evaluating a version against an engines range. */
export type EnginesVerdict = 'satisfied' | 'unsatisfied' | 'unknown'

/**
 * Evaluate one version against an npm-style engines range. Supports `||`
 * alternation and `^x.y.z`, `>=x.y.z`, `<=x.y.z`, `>x.y.z`, `<x.y.z`, `x.y.z`,
 * and `x.y` terms. Unrecognized terms make the whole verdict `unknown` rather
 * than failing closed, so status surfaces the configuration gap honestly.
 * @param version - Parsed runtime version.
 * @param range - `engines.node` range string from the target package.json.
 * @returns Whether the version satisfies every alternative.
 */
export function evaluateNodeEngines(version: NodeVersion, range: string): EnginesVerdict {
  const alternatives = range.split('||').map(part => part.trim()).filter(part => part.length > 0)
  if (alternatives.length === 0) return 'unknown'
  let sawUnknown = false
  for (const alternative of alternatives) {
    const verdict = evaluateAlternative(version, alternative)
    if (verdict === 'satisfied') return 'satisfied'
    if (verdict === 'unknown') sawUnknown = true
  }
  return sawUnknown ? 'unknown' : 'unsatisfied'
}

function evaluateAlternative(version: NodeVersion, alternative: string): EnginesVerdict {
  const terms = alternative.split(/\s+/u).filter(term => term.length > 0)
  let sawUnknown = false
  for (const term of terms) {
    const verdict = evaluateTerm(version, term)
    if (verdict === 'unsatisfied') return 'unsatisfied'
    if (verdict === 'unknown') sawUnknown = true
  }
  return sawUnknown ? 'unknown' : 'satisfied'
}

function evaluateTerm(version: NodeVersion, term: string): EnginesVerdict {
  const match = /^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/u.exec(term)
  if (!match) return 'unknown'
  const [, op, major, minor, patch] = match
  const target: NodeVersion = {
    major: Number(major),
    minor: Number(minor ?? '0'),
    patch: Number(patch ?? '0'),
  }
  const cmp = compare(version, target)
  switch (op) {
    case '^': return version.major === target.major && cmp >= 0 ? 'satisfied' : 'unsatisfied'
    case '~': return version.major === target.major && version.minor === target.minor && cmp >= 0 ? 'satisfied' : 'unsatisfied'
    case '>=': return cmp >= 0 ? 'satisfied' : 'unsatisfied'
    case '<=': return cmp <= 0 ? 'satisfied' : 'unsatisfied'
    case '>': return cmp > 0 ? 'satisfied' : 'unsatisfied'
    case '<': return cmp < 0 ? 'satisfied' : 'unsatisfied'
    case '=':
    case undefined: {
      if (minor === undefined) return version.major === target.major ? 'satisfied' : 'unsatisfied'
      if (patch === undefined) return version.major === target.major && version.minor === target.minor ? 'satisfied' : 'unsatisfied'
      return cmp === 0 ? 'satisfied' : 'unsatisfied'
    }
    default: return 'unknown'
  }
}

/** Reasons a REA launch is refused before spawning. */
export type ReaUnavailableReason =
  | 'not-configured'
  | 'node-probe-failed'
  | 'rea-package-missing'
  | 'engines-unsatisfied'
  | 'engines-unknown'

/**
 * Assert deployment env isolation for the REA child process: the state
 * directory and every supplied env value must stay outside the managed
 * `.dsh` namespace, and no `DSH_*` variable may be forwarded. Throws
 * `TypeError` because this is a self-contained deployment violation.
 * @param env - Env dict that will be handed to the spawned server.
 * @param stateDir - Resolved REA state directory.
 */
export function assertReaEnvironment(env: Record<string, string>, stateDir: string): void {
  if (/(?:^|[\\/])\.dsh(?:[\\/]|$)/iu.test(stateDir)) {
    throw new TypeError(`security-rea: stateDir must not live inside a .dsh directory: ${stateDir}`)
  }
  for (const [key, value] of Object.entries(env)) {
    if (/^DSH_/iu.test(key)) {
      throw new TypeError(`security-rea: env key ${key} must not forward DSH_* variables`)
    }
    if (/(?:^|[\\/])\.dsh(?:[\\/]|$)/iu.test(value)) {
      throw new TypeError(`security-rea: env ${key} must not point inside a .dsh directory`)
    }
  }
}
