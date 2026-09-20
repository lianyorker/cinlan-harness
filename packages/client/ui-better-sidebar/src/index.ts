/**
 * dsh-better-sidebar host half: the /sidebar JSON API (explorer listing, file
 * read/write, git), the /sidebar/file media route (images), the /sidebar/html
 * preview route, the /sidebar/bundle lazy-chunk route (client code splits),
 * and the sidebar terminal provider. Every Web route passes the same
 * browser-trust fence as the /api gateway — Host-header loopback or the
 * web runtime's `trustedHosts` (LAN IP literals sampled at boot plus
 * `--trusted-host` authorities), read per request from the live service
 * value so the fence tracks the same trust source the /api gateway derives
 * its list from.
 *
 * All operations are conversation-scoped: requests carry a sessionId, the
 * session's authoritative cwd comes from the session store, and terminal
 * processes are keyed by session.
 */
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import type { Context, SidebarHttpRequest } from './context-types.ts'
import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection/types'
import {
  Config,
  PrefsSchema,
  resolveSidebarConfig,
  SIDEBAR_PREFS_NS,
  type ResolvedSidebarConfig,
  type SidebarConfig,
  type SidebarPrefs,
} from './config.ts'
import { parentOf, requireAbsolute, listDirectory, rootLabel } from './fs-tree.ts'
import { searchFiles } from './fs-search.ts'
import { extractFrameAncestors } from './browser-probe.ts'
import { isTrustedApiRequest, isLoopbackHostname } from './trust-fence.ts'
import { registerBundleRoute, registerSidebarBundleRoute, registerTerminalBundleRoute } from './bundle-route.ts'
import { createSidebarOperations, registerSidebarFetch, registerSidebarWebAliases } from './sidebar-transport.ts'
import { SidebarTerminalProvider } from './terminal-provider.ts'
import { launchExternal } from './open-external.ts'
import { buildGitApi } from './git.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { defaultShell, ensureSpawnHelper, PtyManager, shellDisplayName } from './pty-manager.ts'
import { AgentPtyRegistry } from './agent-pty.ts'
import {
  DSH_NODE_PTY_RANGE,
  depsStatus,
  loadNodePty,
} from './pty-deps.ts'
import { registerTools } from './tools.ts'
import { buildJobsApi, type SidebarJobsRoutes } from './jobs-routes.ts'
import { buildSubagentLiveApi, type SidebarSubagentLiveRoutes } from './subagent-live-route.ts'
// Phase 4: import { buildSidechatApi } from './sidechat-routes.ts'
import { requireString, SidebarError } from './wire.ts'

export { Config }
export type { SidebarConfig, ResolvedSidebarConfig }
// Re-export the Context augmentation (declare module 'cordis') so consumers
// `import type {} from 'dsh-better-sidebar'` and gain `ctx.betterSidebar`.
// Also re-export the service descriptor types so consumers can type their
// registerTab / registerFileViewer arguments without reaching into /client.
export type { Context } from './context-types.ts'
export type {
  BetterSidebarService,
  TabDescriptor,
  TabComponentProps,
  FileViewerDescriptor,
  FileViewerProps,
  FileFetchStrategy,
} from './client/service.ts'

/** Plugin identity for cordis.yml rows. */
export const name = '@deepseek-ai/dsh-client-ui-better-sidebar'

/** The native terminal owner needs sessions and tools; Web routes attach when their transport exists. */
export const inject = ['sessions', 'tools']

/** Content types for the media route, by extension. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
}

/** Content type served by /sidebar/file (binary-safe fallback for unknowns). */
export function mediaTypeForPath(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a session's authoritative working directory. The attached session
 * header wins; while the session is still hydrating from persistence (the
 * web client attaches the current conversation a moment after page load, so
 * the very first sidebar requests can arrive detached) the caller's own
 * list-summary cwd is used; the process cwd is the last resort (blank
 * sessions have no cwd anywhere yet). Never throws for a missing cwd, so
 * explorer/git/terminal work from first paint instead of surfacing
 * "session ... has no working directory".
 */
function sessionCwdOf(ctx: Context, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') {
    try {
      return requireAbsolute(clientCwd)
    } catch {
      throw new SidebarError('bad-request', `invalid working directory "${clientCwd}"`)
    }
  }
  return process.cwd()
}

/**
 * Resolve a path that a git command reported — `git status`/`git diff`
 * print paths RELATIVE TO THE REPO TOP LEVEL, which may sit above the
 * session cwd (a session inside a subdirectory of a repository). Absolute
 * paths pass through; relative ones join the repo root (falling back to the
 * cwd when the root cannot be resolved, e.g. a bare directory).
 */
async function resolveGitPath(ctx: Context, cwd: string, raw: string): Promise<string> {
  if (isAbsolute(raw)) return requireAbsolute(raw)
  const root = await ctx.get('sidebarGit')?.discover(cwd)
  return requireAbsolute(join(root ?? cwd, raw))
}

/** How many leading bytes a binary read returns for client-side detect sniffing. */
const READ_HEAD_LIMIT = 4096

/** Text read of a file with the size cap; binary detection via NUL probe.
 *  Binary reads also return the first {@link READ_HEAD_LIMIT} bytes (base64)
 *  so the client can re-match viewers by content (`detect`). */
async function readText(path: string, readLimit: number): Promise<{
  content: string
  truncated: boolean
  binary: boolean
  size: number
  head?: string
}> {
  const info = await stat(path).catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  if (info.isDirectory()) {
    throw new SidebarError('fs-error', `"${path}" is a directory`, 400)
  }
  const size = info.size
  const truncated = size > readLimit
  const handle = await open(path, 'r').catch((error: unknown) => {
    throw new SidebarError('fs-error', `cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
  })
  try {
    const buffer = Buffer.alloc(Math.min(size, readLimit))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    const head = binary
      ? slice.subarray(0, Math.min(slice.length, READ_HEAD_LIMIT)).toString('base64')
      : undefined
    return { content: binary ? '' : slice.toString('utf8'), truncated, binary, size, head }
  } finally {
    await handle.close()
  }
}

/** One API method dispatch table entry. */
type ApiMethod = (payload: unknown) => Promise<unknown> | unknown

/**
 * The live face of the side card settings namespace, bound to the settings
 * service when it is mounted. The DSH settings RPC domain only serves
 * allowlisted namespaces (api-proxy exposedNamespaces), so the client reads
 * and writes THIS namespace through the plugin's own fenced /sidebar routes,
 * which call the seam in-process — no configuration-client gate involved.
 */
export interface SidebarSettingsFace {
  /** The current resolved value + revision (undefined while the settings service is absent). */
  get(): { value?: unknown; revision?: number }
  /**
   * Whether the dsh-web-ui family's aionui-panel has been selected as the
   * right-panel provider (the `aionui-panel` settings namespace resolves
   * `rightPanel: 'aionui-panel'`). While true the sidebar must not mount —
   * the two right panels are mutually exclusive. False when the namespace is
   * absent (no aionui installed) or the provider is anything else.
   */
  externalDisable(): boolean
  /** Merge a patch (revision-guarded) and return the fresh resolved view. */
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
}

/**
 * Resolve the settings-page terminal shell overrides (the terminal card's
 * gear rows). Empty fields mean "unset": keep the yaml `config.shell` /
 * `shellArgs` (or the platform auto-resolution). The settings page is the
 * runtime complement to the boot-time yaml — same contract, later binding:
 * the values here win for terminals opened afterwards.
 */
function shellOverridesOf(getSettings: () => SidebarSettingsFace | undefined): { shell?: string; shellArgs?: string[] } {
  const settings = getSettings()
  const value = settings?.get().value
  if (value === null || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const shell = typeof record.terminalShell === 'string' ? record.terminalShell.trim() : ''
  const args = typeof record.terminalShellArgs === 'string' ? record.terminalShellArgs.trim() : ''
  return {
    shell: shell === '' ? undefined : shell,
    shellArgs: args === '' ? undefined : args.split(/\s+/).filter(Boolean),
  }
}

function isSettingsConflict(error: unknown): error is { readonly message: string } {
  if (error === null || typeof error !== 'object') return false
  const record = error as {
    readonly actual?: unknown
    readonly code?: unknown
    readonly expected?: unknown
    readonly message?: unknown
    readonly name?: unknown
  }
  return typeof record.message === 'string'
    && (record.code === 'SETTINGS_CONFLICT'
      || record.name === 'SettingsConflictError'
      || (typeof record.expected === 'number' && typeof record.actual === 'number'))
}

function buildApi(
  ctx: Context,
  ptyManager: PtyManager | null,
  agentPtyRegistry: AgentPtyRegistry | null,
  resolved: ResolvedSidebarConfig,
  terminalShell: string,
  getSettings: () => SidebarSettingsFace | undefined,
): Record<string, ApiMethod> {
  const cwdOf = (payload: unknown): { sessionId: string; cwd: string } => {
    const sessionId = requireString(payload, 'sessionId')
    const record = payload as { cwd?: unknown } | null
    const clientCwd = typeof record?.cwd === 'string' && record.cwd !== '' ? record.cwd : undefined
    return { sessionId, cwd: sessionCwdOf(ctx, sessionId, clientCwd) }
  }
  // Background jobs: the LIST rides the harness's `session/jobs` push
  // mirror, so these routes only replay output the model has read (from the
  // session's own event log — no DSH source is touched, the model's
  // job_output cursor is never consumed) and kill (the registry's stock
  // API). A deployment without the jobs registry downgrades kill to a 503.
  const jobsApi: SidebarJobsRoutes = buildJobsApi(ctx, resolved.readLimit)
  // Subagent live previews: one batch request instead of N per-child
  // `subagents.history` calls. The route degrades to a 503 when the host
  // subagent runtime is absent (the page has no topology to show anyway).
  const subagentLiveApi: SidebarSubagentLiveRoutes = buildSubagentLiveApi(ctx)
  return {
    'session.cwd': (payload) => {
      const { sessionId, cwd } = cwdOf(payload)
      return { sessionId, cwd, root: rootLabel(cwd), parent: parentOf(cwd) ?? null }
    },
    'fs.tree': async (payload) => {
      const { cwd } = cwdOf(payload)
      const record = payload as { path?: unknown }
      const target = record.path === undefined ? cwd : requireAbsolute(requireString(payload, 'path'))
      return listDirectory(target, resolved.listLimit)
    },
    'fs.search': async (payload) => {
      // The editor side panel's global name search: rooted at the session
      // cwd (not caller-targetable — the walk is unbounded by design and
      // must never escape the workspace), budgeted inside searchFiles.
      const { cwd } = cwdOf(payload)
      const query = requireString(payload, 'query')
      return searchFiles(cwd, query)
    },
    'fs.read': async (payload) => {
      const { cwd } = cwdOf(payload)
      // Relative paths are git-derived (status/diff report repo-root-relative
      // names; the untracked diff view reads the file through this route).
      const path = await resolveGitPath(ctx, cwd, requireString(payload, 'path'))
      const { content, truncated, binary, size, head } = await readText(path, resolved.readLimit)
      if (binary) return { kind: 'binary', size, truncated, head }
      return { kind: 'text', content, truncated }
    },
    'fs.write': async (payload) => {
      cwdOf(payload)
      const path = requireAbsolute(requireString(payload, 'path'))
      const content = requireString(payload, 'content')
      const tmp = `${path}.dsh-sidebar-tmp-${process.pid}`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, path)
      } catch (error) {
        await rm(tmp, { force: true }).catch(() => {})
        throw new SidebarError('fs-error', `cannot write "${path}": ${error instanceof Error ? error.message : String(error)}`, 400)
      }
      return { ok: true }
    },
    ...buildGitApi(() => ctx.get('sidebarGit')),
    // Release an agent terminal by uuid. The WS close frame already does
    // this while the socket is open; this route covers the tab-close that
    // happens while the socket is down (reconnect loop) so a closed agent
    // tab never leaves a zombie pty behind. Idempotent.
    'agent-pty.close': (payload) => {
      const uuid = requireString(payload, 'uuid')
      agentPtyRegistry?.close(uuid)
      return { ok: true }
    },
    // Terminal dependency status (issue #140): after a WS close 1011 with
    // reason `pty-deps-missing` the client fetches the full repair details
    // here — the close reason itself is capped at 123 bytes, too small for
    // the pasteable command.
    'terminal.deps': () => depsStatus(),
    // Background jobs: read one job's output (a REPLAY of what the model
    // has read so far, from the owner session's event log — the model's
    // job_output cursor is never touched, so the human pane can never steal
    // the agent's bytes), and kill one job. The job LIST itself arrives
    // through the harness's session/jobs push mirror, so no list route
    // exists. Kill is fenced to the owning session by the jobs registry.
    'jobs.output': payload => jobsApi.output(payload),
    'jobs.kill': payload => jobsApi.kill(payload),
    // Subagent live previews: one batch request per refresh; the route folds
    // the newest text/tool activity of every running child in the tree.
    'subagents.live': payload => subagentLiveApi.live(payload),
    // The effective terminal shell and its display name. The client uses
    // this to title terminal tabs with the shell name instead of a numbered
    // "Terminal N" label; the shell itself is configured through
    // `cordis.patch.yml` (`config.shell`) or resolved by the host default.
    'shell.get': () => ({ shell: terminalShell, name: shellDisplayName(terminalShell) }),
    // The side card preferences. The settings service is optional in the
    // composition; while absent the routes report undefined and the client
    // keeps the schema defaults. Writes are revision-guarded: a stale editor
    // is refused with settings-conflict so a concurrent change is never
    // silently overwritten (mirror of the settings seam's own guard).
    'settings.get': () => {
      const settings = getSettings()
      return settings === undefined
        ? { value: undefined, revision: undefined, externalDisable: false }
        : { ...settings.get(), externalDisable: settings.externalDisable() }
    },
    'settings.update': async (payload) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new SidebarError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SidebarError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.update(patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (isSettingsConflict(error)) {
          throw new SidebarError('settings-conflict', error.message, 409)
        }
        throw new SidebarError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
    // Probe a URL's RESPONSE HEADERS so the sidebar browser can explain an
    // iframe refusal: X-Frame-Options / CSP frame-ancestors are exactly the
    // signals the browser enforces when it refuses to embed a site. The
    // probe is display-only (headers back to the caller), restricted to
    // http(s) non-loopback URLs with a hard timeout, and gated by the same
    // trust fence as every other route — a cross-site page cannot reach it.
    'browser.probe': async (payload) => {
      const raw = requireString(payload, 'url')
      let parsed: URL
      try {
        parsed = new URL(raw)
      } catch {
        throw new SidebarError('bad-request', 'invalid url', 400)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new SidebarError('bad-request', 'only http/https urls can be probed', 400)
      }
      // Mirror the browser tab's address-bar policy: loopback stays unreachable
      // from the sidebar, so probing it would leak nothing the tab could use.
      if (isLoopbackHostname(parsed.hostname)) {
        throw new SidebarError('bad-request', 'local addresses are not probed', 400)
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      try {
        let response = await fetch(parsed, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
        // Some servers answer HEAD with 405/501; retry once as GET (the
        // body is discarded — only the headers matter).
        if (response.status === 405 || response.status === 501) {
          response = await fetch(parsed, { method: 'GET', redirect: 'follow', signal: controller.signal })
        }
        const csp = response.headers.get('content-security-policy')
        const frameAncestors = extractFrameAncestors(csp)
        const xFrameOptions = response.headers.get('x-frame-options')
        return {
          reachable: true,
          url: response.url,
          status: response.status,
          ...(xFrameOptions !== null ? { xFrameOptions } : {}),
          ...(frameAncestors !== undefined ? { frameAncestors } : {}),
        }
      } catch {
        // DNS / TLS / connection / timeout: nothing to judge — the client
        // keeps the plain iframe.
        return { reachable: false }
      } finally {
        clearTimeout(timer)
      }
    },
    // External open for the file tree's "open with" menu: reveal a path in
    // the OS file manager, or hand a custom-scheme URL (vscode://,
    // cursor://, zed://, custom editors) to its registered handler. The
    // client is a browser renderer where raw scheme navigation is
    // unreliable, so the launch always goes through the host — the same
    // fence as every other route, argv-only (no shell interpolation).
    'open.external': (payload) => {
      const record = payload as { action?: unknown } | null
      const action = record?.action
      if (action === 'reveal') return launchExternal('reveal', requireString(payload, 'path'))
      if (action === 'url') return launchExternal('url', requireString(payload, 'url'))
      // A session-transcript http(s) link opened in the OS browser: the
      // desktop webview only navigates to the packaged page and the loopback
      // origin, so an external page must hand off to the host opener.
      if (action === 'browser') return launchExternal('browser', requireString(payload, 'url'))
      throw new SidebarError('bad-request', 'action must be "reveal", "url", or "browser"')
    },
    // Side Chat: create a side-thread child seeded with the parent's full
    // log up to now, deliver follow-ups (cold-resuming when the thread's
    // agent is gone), abort a running thread, and release a thread's agent.
    // Every operation runs through these routes because subagent-origin
    // identities are fenced from the generic session RPCs (agent-lookup
    // ownership), and the thread is created with a CUSTOM seed the stock
    // fork APIs cannot express.
    // Phase 4: sidechat routes disabled until Session.events API is adapted
    'sidechat.start': async () => { throw new SidebarError('sidechat-error', 'Side Chat is not yet available in this deployment', 501) },
    'sidechat.prompt': async () => { throw new SidebarError('sidechat-error', 'Side Chat is not yet available in this deployment', 501) },
    'sidechat.cancel': async () => { throw new SidebarError('sidechat-error', 'Side Chat is not yet available in this deployment', 501) },
    'sidechat.dispose': async () => { throw new SidebarError('sidechat-error', 'Side Chat is not yet available in this deployment', 501) },
    'sidechat.info': async () => { throw new SidebarError('sidechat-error', 'Side Chat is not yet available in this deployment', 501) },
    'sidechat.history': async () => { throw new SidebarError('sidechat-error', 'Side Chat is not yet available in this deployment', 501) },
  }
}

/**
 * Plugin body: mount the fenced routes and the pty lifecycle.
 * @param ctx - host plugin context (webServer, sessions, webRuntime).
 * @param config - deployment-provided limits; the Loader validates against
 * {@link Config} and fills defaults, direct callers get them from
 * {@link resolveSidebarConfig}.
 */
export function apply(ctx: Context, config?: SidebarConfig): void {
  // pnpm strips the executable bit from node-pty's prebuilt spawn-helper;
  // restore it before any terminal can spawn (idempotent).
  ensureSpawnHelper()
  const resolved = resolveSidebarConfig(config)
  // One shell resolution feeds BOTH terminal surfaces: the UI tabs and the
  // model-facing terminal_* tools. They must stay in lockstep, otherwise a
  // configured shell fixes one surface and silently leaves the other on the
  // platform default.
  const terminalShell = defaultShell({ explicit: resolved.shell })
  // node-pty is loaded lazily, never at module top level (issue #140): a
  // missing or broken install must degrade THIS plugin — terminal tab shows
  // a repair command, agent terminal tools stay unregistered — instead of
  // failing the plugin load and taking the whole `dsh web` server down.
  const nodePty = loadNodePty()
  if (nodePty === null) {
    const status = depsStatus()
    const detail = status.ok
      ? 'unknown cause'
      : `${status.cause}. Repair: ${status.command}`
    ctx.logger?.warn(`[dsh-better-sidebar] node-pty (${DSH_NODE_PTY_RANGE}) failed to load: ${detail}`)
  }
  const ptyManager = nodePty !== null
    ? new PtyManager(terminalShell, resolved.terminalsPerSession, resolved.shellArgs, nodePty)
    : null
  // The agent-owned terminal registry: parallel to the UI-tab ptyManager,
  // keyed by uuid (the model's opaque handle) instead of `${sessionId}:${tabId}`,
  // uncapped, and torn down with the plugin. The model creates terminals here
  // through the terminal_create tool; sidebar views attach through the
  // sidebarTerminals Remote service.
  const agentPtyRegistry = nodePty !== null
    ? new AgentPtyRegistry(terminalShell, resolved.shellArgs, nodePty)
    : null

  // ── User-facing "Side card" preferences ──────────────────────────────────
  // Register the namespace with the settings provider so the Settings page
  // (client half) can render and persist the new-conversation defaults. The
  // DSH settings RPC domain (api-proxy) only serves allowlisted namespaces to
  // configuration clients, so the client reaches this namespace through the
  // plugin's own fenced routes below ('settings.get'/'settings.update'),
  // which call the seam in-process. Deployments without a settings service
  // simply never fill the face and the client falls back to the defaults.
  let settingsFace: SidebarSettingsFace | undefined
  // The model-facing terminal tools are gated on the side-card setting
  // `agentTerminalTools` (default off): nothing is injected until the user
  // turns the feature on, and turning it off mid-session unregisters the
  // tools and releases the agent terminals they created.
  let toolsDisposers: (() => void) | null = null
  const syncToolsGate = (scope: { get(): SidebarPrefs }): void => {
    if (scope.get().agentTerminalTools) {
      if (toolsDisposers === null) {
        // Degraded mode (node-pty unavailable): never register the terminal
        // tools — every one of them would fail at spawn time.
        if (agentPtyRegistry === null) return
        toolsDisposers = registerTools(
          ctx,
          agentPtyRegistry,
          sessionId => sessionCwdOf(ctx, sessionId),
          () => shellOverridesOf(() => settingsFace),
        )
      }
    } else if (toolsDisposers !== null) {
      toolsDisposers()
      toolsDisposers = null
      // The feature is off: release every agent terminal the model created
      // while it was on (they are only reachable through the tools). The
      // registry change fires the push, so the sidebar reconciles them away.
      agentPtyRegistry?.disposeAll()
    }
  }
  ctx.inject(['settings'], (sctx) => {
    const ns = SIDEBAR_PREFS_NS as SettingsNamespace
    // The structural settings mirror types `schema` as unknown, so the
    // generic is not inferred here; the real service resolves it from the
    // schemastery schema (PrefsSchema) — narrow the owner scope explicitly.
    const scope = sctx.settings.register(ns, PrefsSchema) as {
      get(): SidebarPrefs
      watch(callback: (next: SidebarPrefs, prev: SidebarPrefs) => void): () => void
    }
    const viewOf = (): { value?: unknown; revision?: number } => {
      const descriptor = sctx.settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === ns)
      return descriptor === undefined
        ? { value: undefined, revision: undefined }
        : { value: descriptor.value, revision: descriptor.revision }
    }
    // Mutual exclusion with the dsh-web-ui family right panel: the aionui
    // panel's provider choice (`aionui-panel.rightPanel`) is the authority.
    // While it resolves to 'aionui-panel', this sidebar must not mount. The
    // namespace is read through the settings seam like any other registered
    // section; absent namespace (no aionui installed) = not disabled.
    const externalDisable = (): boolean => {
      const descriptor = sctx.settings.describe({ redactSecrets: true })
        .find(candidate => candidate.ns === 'aionui-panel')
      const value = descriptor?.value as { rightPanel?: unknown } | undefined
      return value?.rightPanel === 'aionui-panel'
    }
    settingsFace = {
      get: viewOf,
      externalDisable,
      update: async (patch, expectedRevision) => {
        await sctx.settings.update(ns, patch, expectedRevision)
        return viewOf()
      },
    }
    // Register (or unregister) the terminal tools from the current setting,
    // and keep them in sync with every settings commit.
    syncToolsGate(scope)
    scope.watch(() => { syncToolsGate(scope) })
  })

  const terminalProvider = new SidebarTerminalProvider(ctx, {
    ui: ptyManager, agents: agentPtyRegistry, config: resolved,
    sessionCwd: id => sessionCwdOf(ctx, id),
    sessionWorkspace: id => ctx.sessions.get(id)?.header.cwd,
    shell: () => {
      const overrides = shellOverridesOf(() => settingsFace)
      return { shell: overrides.shell ?? terminalShell, shellArgs: overrides.shellArgs ?? resolved.shellArgs }
    },
  })
  ctx.effect(() => async () => {
    toolsDisposers?.()
    await terminalProvider.shutdown()
  }, 'dsh-better-sidebar: native terminal lifetime')
  ctx.inject(['connection'], (transport) => {
    // The injected Host connection shares its carrier types with the Client compiler face.
    const { fetch } = (transport as Context & { connection: { fetch: HostConnectionFetch } }).connection
    transport.effect(() => registerTerminalBundleRoute(fetch), 'dsh-better-sidebar: authenticated terminal bundle')
  })
  const operations = createSidebarOperations({
    api: buildApi(ctx, ptyManager, agentPtyRegistry, resolved, terminalShell, () => settingsFace),
    sessionCwd: (sessionId, clientCwd) => sessionCwdOf(ctx, sessionId, clientCwd),
    mediaType: mediaTypeForPath,
    config: resolved,
  })
  ctx.inject(['connection'], (transport) => {
    const { fetch } = (transport as Context & { connection: { fetch: HostConnectionFetch } }).connection
    transport.effect(() => registerSidebarFetch(fetch, operations), 'dsh-better-sidebar: authenticated Fetch routes')
    transport.effect(() => registerSidebarBundleRoute(fetch), 'dsh-better-sidebar: authenticated preview chunks')
  })
  ctx.inject(['webServer', 'webRuntime'], (web) => {
    const ctx = web as Context
    const fence = (req: SidebarHttpRequest): boolean => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts)
    ctx.effect(() => registerSidebarWebAliases(ctx.webServer, fence, operations), 'dsh-better-sidebar: Web aliases')
    ctx.effect(() => registerBundleRoute(ctx, fence), 'dsh-better-sidebar: /sidebar/bundle chunk route')

  })
}
