/** Pure mapping between the target form, saved records and OpenSSH import entries. */
import type {
  CreateTargetRequest, SshConfigHost, SshConnection, TargetView,
} from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostsKey } from './locales.ts'
import type { TargetDraft } from './types.ts'

/** OpenSSH alias grammar shared with the durable target schema. */
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/
/** Default port shown by the form, matching OpenSSH's own default. */
export const DEFAULT_PORT = '22'
/** Bounds the durable record accepts for the saved connection deadline. */
export const MIN_CONNECT_TIMEOUT_SECONDS = 1
export const MAX_CONNECT_TIMEOUT_SECONDS = 604_800

/**
 * One destination as typed into the single host-or-alias field.
 * `invalidPort` keeps bad text visible so the validator can report it.
 */
export interface ParsedDestination {
  readonly host: string
  readonly username?: string | undefined
  readonly port?: number | undefined
  readonly invalidPort?: boolean | undefined
}

function parsePort(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined
}

function parseHostAndPort(input: string): ParsedDestination {
  if (input.startsWith('[')) {
    const close = input.indexOf(']')
    if (close > 1) {
      const host = input.slice(1, close)
      const suffix = input.slice(close + 1)
      if (suffix.startsWith(':')) {
        const port = parsePort(suffix.slice(1))
        return port === undefined ? { host, invalidPort: true } : { host, port }
      }
      return { host }
    }
  }
  const colon = input.indexOf(':')
  if (colon !== -1 && colon === input.lastIndexOf(':')) {
    const host = input.slice(0, colon)
    const port = parsePort(input.slice(colon + 1))
    if (host !== '') return port === undefined ? { host, invalidPort: true } : { host, port }
  }
  return { host: input }
}

/**
 * Decompose the single destination field: an optional `ssh://` URL, an optional
 * account before the last `@`, and an optional port after the host.
 * @param raw - destination text as typed.
 * @returns the parsed destination, or null when no host remains.
 */
export function parseDestination(raw: string): ParsedDestination | null {
  const input = raw.trim()
  if (input === '') return null
  if (/^ssh:\/\//i.test(input)) {
    try {
      const url = new URL(input)
      if (url.protocol !== 'ssh:' || !url.hostname) return null
      const host = url.hostname.replace(/^\[|\]$/g, '')
      if (url.port === '') return { host, ...url.username === '' ? {} : { username: decodeURIComponent(url.username) } }
      const port = parsePort(url.port)
      return port === undefined
        ? { host, invalidPort: true }
        : { host, port, ...url.username === '' ? {} : { username: decodeURIComponent(url.username) } }
    } catch {
      return null
    }
  }
  const at = input.lastIndexOf('@')
  const username = at > 0 ? input.slice(0, at).trim() : undefined
  const rest = at > 0 ? input.slice(at + 1).trim() : input
  const parsed = parseHostAndPort(rest)
  if (parsed.host === '') return null
  return { ...parsed, ...username === undefined || username === '' ? {} : { username } }
}

/**
 * Fold a typed destination into the separate fields the form shows, the way the
 * Host field does on blur: the account and port it carried are lifted out, and
 * bad `host:port` text is left alone for the validator to report.
 * @param draft - current form values.
 * @returns the draft with the destination applied.
 */
export function applyParsedDestination(draft: TargetDraft): TargetDraft {
  const parsed = parseDestination(draft.destination)
  if (parsed === null || parsed.invalidPort === true) return draft
  const port = parsed.port !== undefined && (draft.port.trim() === '' || draft.port.trim() === DEFAULT_PORT)
    ? String(parsed.port)
    : draft.port
  return {
    ...draft,
    destination: parsed.host,
    username: draft.username.trim() !== '' ? draft.username : parsed.username ?? '',
    port,
  }
}

/** An empty draft for a new target. */
export function emptyDraft(): TargetDraft {
  return {
    label: '', destination: '', username: '', port: DEFAULT_PORT, identityFile: '',
    proxyCommand: '', jumpHost: '', connectionReuse: true, connectTimeoutSeconds: '',
  }
}

/** The connection the card reads: the editable record first, then the pinned deployment. */
export function effectiveConnection(target: TargetView): SshConnection | undefined {
  return target.connection ?? target.execution?.endpoint
}

/**
 * Load one saved record into the form.
 * @param target - saved target as observed.
 * @returns a draft that round-trips unchanged when the operator edits nothing.
 */
export function draftFromTarget(target: TargetView): TargetDraft {
  const connection = effectiveConnection(target)
  const timeout = connection?.connectTimeoutSeconds
  return {
    label: target.label,
    destination: target.sshAlias,
    username: connection?.username ?? '',
    port: connection?.port === undefined ? DEFAULT_PORT : String(connection.port),
    identityFile: connection?.privateKeyFile ?? '',
    proxyCommand: connection?.proxyCommand ?? '',
    jumpHost: connection?.jumpHost ?? '',
    connectionReuse: connection?.multiplex !== false,
    connectTimeoutSeconds: timeout === undefined ? '' : String(timeout),
  }
}

/**
 * Prefill the form from one imported OpenSSH Host entry.
 * @param entry - concrete Host entry read from the managing Host's configuration.
 * @returns a draft naming that alias, with every destination detail the file stated.
 */
export function draftFromImport(entry: SshConfigHost): TargetDraft {
  return {
    ...emptyDraft(),
    label: entry.alias,
    destination: entry.alias,
    username: entry.username ?? '',
    port: entry.port === undefined ? DEFAULT_PORT : String(entry.port),
    identityFile: entry.identityFile ?? '',
    proxyCommand: entry.proxyCommand ?? '',
    jumpHost: entry.jumpHost ?? '',
  }
}

/**
 * Validate a draft before it can be submitted.
 * @param draft - current form values.
 * @returns the locale key of the first problem, or undefined when the draft can be saved.
 */
export function draftProblem(draft: TargetDraft): HostsKey | undefined {
  const parsed = parseDestination(draft.destination)
  if (parsed === null) return 'formInvalidDestination'
  if (parsed.invalidPort === true) return 'formInvalidPort'
  if (!ALIAS.test(parsed.host)) return 'formInvalidDestinationFormat'
  const port = parsePort(draft.port.trim())
  if (draft.port.trim() === '' || port === undefined) return 'formInvalidPort'
  const timeout = draft.connectTimeoutSeconds.trim()
  if (timeout !== '') {
    const seconds = Number(timeout)
    if (!Number.isInteger(seconds) || seconds < MIN_CONNECT_TIMEOUT_SECONDS || seconds > MAX_CONNECT_TIMEOUT_SECONDS) {
      return 'formInvalidTimeout'
    }
  }
  return undefined
}

/**
 * Build the saved request for one valid draft.
 *
 * The alias stays the destination, so an omitted refinement keeps whatever the
 * OpenSSH configuration already says. Only an explicit connection-reuse opt-out
 * and a saved connection deadline are recorded, matching the form's own
 * default-on meaning for reuse and its empty default for the deadline.
 * @param draft - validated form values.
 * @returns the create or update payload, without credentials or key contents.
 */
export function targetRequest(draft: TargetDraft): CreateTargetRequest {
  const parsed = parseDestination(draft.destination)
  if (parsed === null) throw new Error('target draft destination was not validated')
  const username = draft.username.trim() || parsed.username || ''
  const typedPort = draft.port.trim()
  const port = parsed.port !== undefined && (typedPort === '' || typedPort === DEFAULT_PORT)
    ? parsed.port
    : Number(typedPort)
  const connection: {
    port: number
    username?: string
    privateKeyFile?: string
    proxyCommand?: string
    jumpHost?: string
    multiplex?: boolean
    connectTimeoutSeconds?: number
  } = { port }
  if (username !== '') connection.username = username
  if (draft.identityFile.trim() !== '') connection.privateKeyFile = draft.identityFile.trim()
  if (draft.proxyCommand.trim() !== '') connection.proxyCommand = draft.proxyCommand.trim()
  if (draft.jumpHost.trim() !== '') connection.jumpHost = draft.jumpHost.trim()
  if (!draft.connectionReuse) connection.multiplex = false
  const timeout = draft.connectTimeoutSeconds.trim()
  if (timeout !== '') connection.connectTimeoutSeconds = Number(timeout)
  return {
    label: draft.label.trim() || (username === '' ? parsed.host : username + '@' + parsed.host),
    sshAlias: parsed.host,
    connection,
  }
}
