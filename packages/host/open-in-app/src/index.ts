/**
 * Host Fetch routes for the resolved application catalog, icons, and native
 * launches consumed by `@deepseek-ai/dsh-client-ui-open-in-app`. Connection
 * owns route registration; its Web carrier checks Host/Origin and browser
 * authentication before dispatch, and Desktop's trusted custom-protocol
 * carrier dispatches without an HTTP listener.
 *
 * The open route validates every carrier's request: an `application/json`
 * media type, a 64 KiB ceiling, string `app`/`path` fields, a resolved-available
 * catalog id, and an absolute path naming an existing directory.
 *
 * The catalog resolves lazily, once per plugin life, on the first request
 * that needs it, into one map of verified launchers: the apps route serves
 * its keys and the open route launches its values, so a click, menu open, or
 * page reload never re-runs detection. A launch that finds its executable
 * gone (`ENOENT`) invalidates that one entry and re-resolves it once.
 */

import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-subprocess'
import { launchedThroughSsh, launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { OPEN_IN_APP_CATALOG, type OpenInAppApp } from './catalog.ts'
import {
  launchResolved, resolveLaunch, resolveOpenInAppApps,
  type OpenInAppInternals, type OpenInAppResolvedLaunch,
} from './resolver.ts'
import { extractAppIcon, type OpenInAppIcon } from './icons.ts'
import { internals } from './internals.ts'
import {
  OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_ICON_PREFIX, OPEN_IN_APP_OPEN_ROUTE,
} from './shared.ts'

export type * from './shared.ts'

/** Cordis function-plugin name. */
export const name = 'open-in-app'
/** The authenticated Fetch registry and the PATH resolver. */
export const inject = ['connection', 'subprocess']

/** Open-in-app host configuration. */
export interface Config {
  /**
   * Per-command deadline in milliseconds for catalog-resolution host
   * commands (`xcode-select`, the Windows registry reads).
   */
  readonly probeTimeoutMs: number
  /**
   * Per-command deadline in milliseconds for icon-extraction host commands
   * (`plutil`/`sips` on macOS, the PowerShell extraction on Windows).
   */
  readonly iconTimeoutMs: number
  /**
   * Early-failure watch window per launch, in milliseconds: a launcher still
   * running when the window closes counts as launched and keeps running, so
   * this bounds how long the open route holds a successful launch, not how
   * long an application may live.
   */
  readonly launchWatchMs: number
}

const boundedMs = (): z<number> => z.number().step(1).min(1).max(600_000).required()

export const Config: z<Config> = z.object({
  probeTimeoutMs: boundedMs(),
  iconTimeoutMs: boundedMs(),
  launchWatchMs: boundedMs(),
})

/** Open-route request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** JSON response (no-store: availability and launch outcomes are live facts). */
function json(status: number, payload: unknown): Response {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Collect at most 64 KiB; the carrier owns unread bytes after a refusal. */
async function readBoundedBody(request: Request): Promise<string | null> {
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, size).toString('utf8')
      size += value.byteLength
      if (size > MAX_BODY_BYTES) return null
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
}

/** Validate one open-route body at the wire: JSON object with string app/path. */
function parseOpenBody(text: string): { app: string; path: string } | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the null case.
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const { app, path } = body as { app?: unknown; path?: unknown }
  return typeof app === 'string' && typeof path === 'string' ? { app, path } : null
}

/**
 * Register catalog, icon, and launch Fetch routes on the authenticated carrier.
 * @param ctx - Host context providing Connection and subprocess resolution.
 * @param config - Validated resolution, icon, and launch deadlines.
 */
export function apply(ctx: Context, config: Config): void {
  const ssh = launchedThroughSsh(launchEnvironmentOf(ctx))
  /** Test-seam facts completed with the composition's PATH resolver. */
  const catalogInternals = (): OpenInAppInternals => ({
    ssh,
    resolveExecutable: async (name) => {
      try {
        return await ctx.subprocess.resolveExecutable(name)
      } catch {
        // Swallows the provider's not-found rejection: for detection, a name
        // that does not resolve has exactly one meaning — unavailable.
        return null
      }
    },
    ...internals.catalog,
  })
  /** Lazy once-per-plugin-life resolution; the map is the mutable authority. */
  let resolutions: Promise<Map<string, OpenInAppResolvedLaunch>> | undefined
  const availability = (): Promise<Map<string, OpenInAppResolvedLaunch>> =>
    resolutions ??= resolveOpenInAppApps(config.probeTimeoutMs, catalogInternals())
  /** Per-app icon promise cache (null = resolved as unavailable). */
  const icons = new Map<string, Promise<OpenInAppIcon | null>>()
  const iconOf = (app: OpenInAppApp, resolved: OpenInAppResolvedLaunch): Promise<OpenInAppIcon | null> => {
    let cached = icons.get(app.id)
    if (cached === undefined) {
      cached = extractAppIcon(app, resolved, config.iconTimeoutMs, catalogInternals())
      icons.set(app.id, cached)
    }
    return cached
  }
  /**
   * Replace one stale resolution after a missing-executable launch: the
   * entry (and its icon) re-resolves once; an entry that no longer resolves
   * leaves the map and the next apps read no longer offers it.
   */
  const refreshResolution = async (app: OpenInAppApp): Promise<OpenInAppResolvedLaunch | undefined> => {
    const map = await availability()
    const fresh = await resolveLaunch(app, config.probeTimeoutMs, catalogInternals())
    icons.delete(app.id)
    if (fresh === null) {
      map.delete(app.id)
      return undefined
    }
    map.set(app.id, fresh)
    return fresh
  }
  ctx.connection.fetch.register({
    path: OPEN_IN_APP_APPS_ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(200, { apps: [...(await availability()).keys()] }),
  })

  ctx.connection.fetch.register({
    match: 'prefix',
    path: `${OPEN_IN_APP_ICON_PREFIX}/`,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const id = new URL(request.url).pathname.slice(OPEN_IN_APP_ICON_PREFIX.length + 1)
      const noIcon = (): Response => json(404, { code: 'not-found', message: `no icon for ${id}` })
      const app = OPEN_IN_APP_CATALOG.find(entry => entry.id === id)
      if (app === undefined) return noIcon()
      const resolved = (await availability()).get(app.id)
      if (resolved === undefined) return noIcon()
      const icon = await iconOf(app, resolved)
      if (icon === null) return noIcon()
      return new Response(new Uint8Array(icon.bytes), {
        headers: { 'content-type': icon.contentType, 'cache-control': 'public, max-age=3600' },
      })
    },
  })

  ctx.connection.fetch.register({
    path: OPEN_IN_APP_OPEN_ROUTE,
    methods: ['POST'],
    requestBody: 'streaming',
    fetch: async (request) => {
      const essence = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (essence !== 'application/json') {
        return json(415, { code: 'unsupported-media-type', message: 'content-type must be application/json' })
      }
      let text: string | null
      try {
        text = await readBoundedBody(request)
      } catch {
        // Swallows request-stream errors: the incomplete body cannot be parsed.
        return json(400, { code: 'bad-request', message: 'request body unreadable' })
      }
      if (text === null) {
        return json(413, { code: 'payload-too-large', message: 'request body is too large' })
      }
      const parsed = parseOpenBody(text)
      if (parsed === null) {
        return json(400, { code: 'bad-request', message: 'request body must be JSON with string "app" and "path"' })
      }
      const app = OPEN_IN_APP_CATALOG.find(entry => entry.id === parsed.app)
      const resolved = app === undefined ? undefined : (await availability()).get(app.id)
      if (app === undefined || resolved === undefined) {
        return json(400, { code: 'bad-request', message: `unknown or unavailable app: ${parsed.app}` })
      }
      if (parsed.path === '' || !isAbsolute(parsed.path)) {
        return json(400, { code: 'bad-request', message: 'path must be an absolute directory path' })
      }
      let directory: boolean
      try {
        directory = (await stat(parsed.path)).isDirectory()
      } catch {
        // Swallows ENOENT/EACCES: both mean there is no directory to open.
        directory = false
      }
      if (!directory) {
        return json(404, { code: 'not-found', message: `directory does not exist: ${parsed.path}` })
      }
      let outcome = await launchResolved(resolved, parsed.path, config.launchWatchMs, catalogInternals())
      if (outcome === 'missing') {
        // The verified launcher is gone (uninstalled since resolution):
        // refresh this one entry and retry once with the fresh launcher.
        const fresh = await refreshResolution(app)
        outcome = fresh === undefined
          ? 'failed'
          : await launchResolved(fresh, parsed.path, config.launchWatchMs, catalogInternals())
      }
      return outcome === 'launched'
        ? json(200, { ok: true })
        : json(502, { code: 'launch-failed', message: `failed to launch ${app.id}` })
    },
  })
}
