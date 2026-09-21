/**
 * Instance-owned Git Remote callbacks and the sidebar HTTP helpers for other features.
 * HTTP calls retain the Session cwd hint; Git repository selection belongs to the Host.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { GitCommitPreview, GitSessionRequest } from '@deepseek-ai/dsh-sidebar-git/types'
import { encodeHtmlUrl } from '../html-route.ts'
import type { LastActivity } from '../subagent-activity.ts'
import type { SidechatThreadInfo } from '../sidechat-core.ts'
import type { BrowserProbeResult } from './browser.ts'

/** One wire failure. */
export class SidebarApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Explorer row (host fs-tree shape). */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
  /** Whether the row is a symlink; `isDir` then describes the link's target. */
  isSymlink: boolean
  /** For symlinks: the target is missing or unreadable (stat failed). */
  broken: boolean
}

export type {
  GitCommitPreview, GitCompareResult, GitLogEntry, GitRepositoryState, GitStatusEntry, GitStatusResult,
} from '@deepseek-ai/dsh-sidebar-git/types'

/** Text read result. */
export interface FsTextResult { kind: 'text'; content: string; truncated: boolean }
/** Binary read result (no content; images load through the media route).
 *  `head` carries the first bytes (base64) for viewer detect sniffing. */
export interface FsBinaryResult { kind: 'binary'; size: number; truncated: boolean; head: string }

/**
 * One jobs.output response: retained output observed through an independent
 * registry reader, so opening the pane never advances the model's cursor.
 */
export interface JobOutputResult {
  text: string
  /** True when registry retention or the response cap omitted output. */
  truncated: boolean
}

/** The `subagents.live` response: running child id → latest activity. */
export type SubagentLiveResult = { live: Record<string, LastActivity> }

/** Terminal dependency status (mirror of the host's depsStatus; issue #140). */
export type TerminalDepsStatus =
  | { ok: true }
  | {
    ok: false
    /** The require-time error message (module missing, native binding broken…). */
    cause: string
    /** The pasteable repair command (terminal/cmd). */
    command: string
    /** The detected profile name (null when undetected → the command defaults to web). */
    profile: string | null
    /** Optional supplementary hint (fallback command only). */
    note?: string
  }

async function call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/sidebar.api?method=${encodeURIComponent(method)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  const responseBody: unknown = await response.json().catch(() => null)
  const parsed = responseBody as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/**
 * Upload one file to the sidebar's raw upload route: the File goes straight
 * into the POST body (no JSON/base64 re-encoding — the host streams it into
 * the workspace). Failure surfaces as {@link SidebarApiError} with the wire
 * code, exactly like every sidebar API call. An aborted `signal` rejects
 * with the DOMException as-is (the caller decides whether that is an error).
 */
async function fetchUpload<T>(
  scope: SessionScope,
  dir: string,
  relativePath: string,
  body: Blob,
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams({ sessionId: scope.sessionId, dir, relativePath })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  let response: Response
  try {
    response = await fetch(`/api/sidebar.upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new SidebarApiError('network', error instanceof Error ? error.message : String(error))
  }
  const responseBody: unknown = await response.json().catch(() => null)
  const parsed = responseBody as { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new SidebarApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

/** One request's session scope: the conversation id plus its cwd when known. */
export interface SessionScope {
  sessionId: string
  /** The session's working directory from the client list summary (optional). */
  cwd?: string
}

/** Fold a scope into a JSON payload ({cwd} only when present). */
function scopePayload(scope: SessionScope, extra: Record<string, unknown>): Record<string, unknown> {
  return { sessionId: scope.sessionId, ...(scope.cwd !== undefined && scope.cwd !== '' ? { cwd: scope.cwd } : {}), ...extra }
}

/** Plain Git callbacks captured by the plugin instance and passed to its tabs. */
export type SidebarGitClient = ReturnType<typeof createSidebarGitClient>

async function gitValue<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw settled.error
  return settled.value
}

/**
 * Adapt the generated Git namespace into values and rejected Remote errors.
 * The Host resolves the Session cwd; the client's cwd hint never selects Git repositories.
 * @param remoteSidebarGit - namespace owned by this plugin's apply lifetime.
 * @returns plain callbacks with no HTTP fallback or shared Remote state.
 */
export function createSidebarGitClient(remoteSidebarGit: ClientRemote['sidebarGit']) {
  // Sidebar's persisted scope predates branded Session ids; the attached Session owns this id.
  const request = (scope: SessionScope): GitSessionRequest => ({ sessionId: scope.sessionId as GitSessionRequest['sessionId'] })
  return {
    gitStatus: (scope: SessionScope, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.status(request(scope), signal)),
    gitDiff: (scope: SessionScope, path: string | undefined, staged: boolean, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.diff({ ...request(scope), ...(path === undefined ? {} : { path }), staged }, signal)),
    gitStage: (scope: SessionScope, repositoryRoot: string, path?: string) =>
      gitValue(remoteSidebarGit.stage({ ...request(scope), repositoryRoot, ...(path === undefined ? {} : { path }) })),
    gitUnstage: (scope: SessionScope, repositoryRoot: string, path?: string) =>
      gitValue(remoteSidebarGit.unstage({ ...request(scope), repositoryRoot, ...(path === undefined ? {} : { path }) })),
    gitBranch: (scope: SessionScope, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.branches(request(scope), signal)),
    gitCheckout: (scope: SessionScope, repositoryRoot: string, branch: string) =>
      gitValue(remoteSidebarGit.checkout({ ...request(scope), repositoryRoot, branch })),
    gitPrepareCommit: (scope: SessionScope, repositoryRoot: string, message: string, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.prepareCommit({ ...request(scope), repositoryRoot, message }, signal)),
    gitCommit: (preview: GitCommitPreview) =>
      gitValue(remoteSidebarGit.commit({ preview })),
    gitCompare: (scope: SessionScope, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.compare(request(scope), signal)),
    gitLog: (scope: SessionScope, count?: number, skip?: number, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.log({
        ...request(scope), ...(count === undefined ? {} : { count }), ...(skip === undefined ? {} : { skip }),
      }, signal)),
    gitShow: (scope: SessionScope, ref: string, path: string, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.show({ ...request(scope), ref, path }, signal)),
    gitCommitDiff: (scope: SessionScope, hash: string, signal?: AbortSignal) =>
      gitValue(remoteSidebarGit.commitDiff({ ...request(scope), hash }, signal)),
    gitDiscard: (scope: SessionScope, repositoryRoot: string, head: string | null, path: string) =>
      gitValue(remoteSidebarGit.discard({ ...request(scope), repositoryRoot, head, path })),
    gitRevert: (scope: SessionScope, repositoryRoot: string, head: string | null, hash: string) =>
      gitValue(remoteSidebarGit.revert({ ...request(scope), repositoryRoot, head, hash })),
    gitCherryPick: (scope: SessionScope, repositoryRoot: string, head: string | null, hash: string) =>
      gitValue(remoteSidebarGit.cherryPick({ ...request(scope), repositoryRoot, head, hash })),
  }
}

/** The sidebar API surface (session scope threaded through every call). */
export const api = {
  sessionCwd: (scope: SessionScope, signal?: AbortSignal) =>
    call<{ sessionId: string; cwd: string; root: string; parent: string | null }>('session.cwd', scopePayload(scope, {}), signal),
  fsTree: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<{ path: string; entries: FsEntry[]; truncated: boolean }>('fs.tree', scopePayload(scope, { path }), signal),
  /** Global recursive file-name search rooted at the session cwd (the editor
   *  side panel's search box); matches are cwd-relative '/'-separated paths. */
  fsSearch: (scope: SessionScope, query: string, signal?: AbortSignal) =>
    call<{ matches: string[]; truncated: boolean }>('fs.search', scopePayload(scope, { query }), signal),
  fsRead: (scope: SessionScope, path: string, signal?: AbortSignal) =>
    call<FsTextResult | FsBinaryResult>('fs.read', scopePayload(scope, { path }), signal),
  fsWrite: (scope: SessionScope, path: string, content: string) =>
    call<{ ok: true }>('fs.write', scopePayload(scope, { path, content })),
  /** Upload one file's raw bytes into `dir` (keeps the folder tree via
   *  `relativePath`); the host streams it under the session workspace. */
  uploadFile: (scope: SessionScope, dir: string, relativePath: string, body: Blob, signal?: AbortSignal) =>
    fetchUpload<{ path: string; size: number }>(scope, dir, relativePath, body, signal),
  agentPtyClose: (uuid: string) =>
    call<{ ok: true }>('agent-pty.close', { uuid }),
  /** Terminal dependency status (issue #140): after a WS close 1011 with
   *  reason `pty-deps-missing` the view fetches the full repair details here
   *  (the close reason itself is capped at 123 bytes). */
  terminalDeps: () =>
    call<TerminalDepsStatus>('terminal.deps', {}),
  /**
   * The output the model has read so far for one background job (replayed
   * from the owner session's event log — never the model's job_output
   * cursor). The scope MUST be the job's OWNER session.
   */
  jobOutput: (scope: SessionScope, id: string, signal?: AbortSignal) =>
    call<JobOutputResult>('jobs.output', scopePayload(scope, { id }), signal),
  /** Request cancellation of one background job (live jobs flip to stopping). */
  jobKill: (scope: SessionScope, id: string, reason?: string) =>
    call<{ ok: true; outcome: 'requested' | 'already-finished' }>('jobs.kill', scopePayload(scope, {
      id,
      ...(reason !== undefined ? { reason } : {}),
    })),
  /**
   * One batch live-preview fetch for the whole Subagent tree. The payload is
   * the already-resolved topology ROOT (not a session scope); the host
   * enumerates descendants once and folds running children's activity.
   */
  subagentsLive: (rootSessionId: string, signal?: AbortSignal) =>
    call<SubagentLiveResult>('subagents.live', { rootSessionId }, signal),
  /** Create a Side Chat thread: a child session seeded with the parent's
   *  full log up to now. Empty question = immediate create (Codex-style):
   *  the thread opens empty, the first prompt carries the boundary. */
  sidechatStart: (sessionId: string, question?: string) =>
    call<{ childId: string }>('sidechat.start', { sessionId, question: question ?? '' }),
  /** Deliver one follow-up message to a Side Chat thread. */
  sidechatPrompt: (childId: string, text: string) =>
    call<{ accepted: true }>('sidechat.prompt', { childId, text }),
  /** Abort a Side Chat thread's running turn (queued work is preserved). */
  sidechatCancel: (childId: string) =>
    call<{ accepted: true }>('sidechat.cancel', { childId }),
  /** Release a Side Chat thread's live agent (history stays persisted). */
  sidechatDispose: (childId: string) =>
    call<{ accepted: true }>('sidechat.dispose', { childId }),
  /** Live state + agent identity (provider/model/preset) of a thread. */
  sidechatInfo: (childId: string) =>
    call<SidechatThreadInfo>('sidechat.info', { childId }),
  /** The effective terminal shell and its display name (plugin-global). */
  shellGet: () =>
    call<{ shell: string; name: string }>('shell.get', {}),
  /** Read the side card preferences (plugin-global, no session scope). */
  settingsGet: () =>
    call<{ value?: unknown; revision?: number; externalDisable?: boolean }>('settings.get', {}),
  /** Merge a patch into the side card preferences (revision-guarded). */
  settingsUpdate: (patch: Record<string, unknown>, expectedRevision?: number) =>
    call<{ value?: unknown; revision?: number }>('settings.update', {
      patch,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    }),
  /** Probe a URL's response headers (the sidebar browser's embeddability
   *  check; see the host's browser.probe route). */
  browserProbe: (url: string, signal?: AbortSignal) =>
    call<BrowserProbeResult>('browser.probe', { url }, signal),
  /** External open for the file tree's "open with" menu: reveal a path in
   *  the OS file manager, or hand a custom-scheme URL (vscode://, cursor://,
   *  zed://, custom editors) to its registered handler. The host launches
   *  the platform opener (argv, no shell). */
  openExternal: (payload: { action: 'reveal'; path: string; sessionId: string }
    | { action: 'url'; url: string; sessionId: string } | { action: 'browser'; url: string }) =>
    call<{ started: boolean }>('open.external', payload),
}

/** Absolute URL of the media route for one path (images only). */
export function mediaUrl(scope: SessionScope, path: string): string {
  return fileUrl(scope, path, false)
}

/** Absolute URL of the download route: serves raw bytes (binary-safe) with
 *  `Content-Disposition: attachment`, so the browser saves the file. */
export function downloadUrl(scope: SessionScope, path: string): string {
  return fileUrl(scope, path, true)
}

/** Shared URL builder for the /api/sidebar.file route (media vs download). */
function fileUrl(scope: SessionScope, path: string, download: boolean): string {
  const params = new URLSearchParams({ sessionId: scope.sessionId, path })
  if (scope.cwd !== undefined && scope.cwd !== '') params.set('cwd', scope.cwd)
  if (download) params.set('download', '1')
  return `/api/sidebar.file?${params.toString()}`
}

/**
 * Absolute URL of the HTML preview route (see html-route.ts): the path is
 * fully encoded so the previewed page's relative assets resolve back into
 * the same route with the session scope intact. The UNC marker is
 * platform-neutral — the host's requireAbsolute resolves the decoded
 * forward-slash `//server/share/...` form on both win32 and POSIX — so no
 * client-side platform signal is needed.
 */
export function htmlUrl(scope: SessionScope, path: string): string {
  return encodeHtmlUrl(scope.sessionId, path)
}
