/**
 * Smoke spec: mounts the Host plugin through Loader with test-owned services and
 * exercises the real integrations — route registration, git against the
 * actual repository, and a real directory listing. Runs with `pnpm test`.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SettingsConflictError, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalGitRuntime from '@deepseek-ai/dsh-git-local'
import * as SidebarHost from '../src/index.ts'
import { mediaTypeForPath } from '../src/index.ts'
import type { GitDiffRequest, GitDiffResult } from '@deepseek-ai/dsh-sidebar-git/types'
import { cleanup as cleanupGit, harness as gitHarness } from '../../../git/sidebar-git/tests/fixture.ts'
import { listDirectory } from '../src/fs-tree.ts'
import { defaultShell, PtyManager, type SidebarPty } from '../src/pty-manager.ts'
import type { SidebarHttpRequest, SidebarHttpResponse, SidebarWebRoute, SidebarWebUpgradeRoute } from '../src/context-types.ts'

const PACKAGE_ROOT = resolvePath(import.meta.dirname, '..')

interface SmokeContextOptions {
  readonly sessions?: { get: (id: string) => { header: { cwd?: string } } | undefined }
  readonly settings?: unknown
  readonly tools?: { define: typeof defineTool; register: (tool: unknown) => () => void }
}

interface SmokeFixture {
  readonly ctx: CordisContext
  readonly routes: SidebarWebRoute[]
  readonly upgrades: SidebarWebUpgradeRoute[]
  readonly dispose: () => Promise<void>
}

/** Mount the real Host plugin through Loader with test-owned route faces. */
async function createSmokeContext(options: SmokeContextOptions = {}): Promise<SmokeFixture> {
  const ctx = new CordisContext()
  const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-smoke-'))
  const dispose = async (): Promise<void> => {
    try { await ctx.fiber.dispose() } finally { rmSync(root, { recursive: true, force: true }) }
  }
  onTestFinished(dispose)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const routes: SidebarWebRoute[] = []
  const upgrades: SidebarWebUpgradeRoute[] = []
  const sessions = options.sessions ?? { get: () => undefined }
  const tools = options.tools ?? { define: defineTool, register: () => () => {} }
  const webServer = {
    register: (route: SidebarWebRoute) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    registerUpgrade: (route: SidebarWebUpgradeRoute) => {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
  }
  const config = join(root, 'cordis.yml')
  writeFileSync(config, [
    '- name: cordis:smoke-services',
    '- name: "@deepseek-ai/dsh-client-ui-better-sidebar"',
    '',
  ].join('\n'))
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins['smoke-services'] = (services: CordisContext) => {
    services.provide('sessions', sessions)
    services.provide('tools', tools)
    services.provide('webServer', webServer)
    services.provide('webRuntime', { trustedHosts: [] })
    if (options.settings !== undefined) services.provide('settings', options.settings)
  }
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier !== '@deepseek-ai/dsh-client-ui-better-sidebar') throw new Error('Unexpected smoke import: ' + specifier)
      return SidebarHost
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  return { ctx, routes, upgrades, dispose }
}

/**
 * The login-shell test spawns a real pty whose bash may still be writing to
 * the temp HOME (history files, etc.) when `disposeAll()` returns — `close()`
 * only requests the kill and the process exit lands asynchronously in
 * `onExit`. Deleting the directory immediately then races the shell and
 * fails with ENOTEMPTY on CI. Wait for the spawned handle to report `exited`
 * (bounded), then remove with a short retry loop as a belt-and-braces
 * fallback for any straggler fd.
 */
async function rmTempDirAfterPtyExit(handle: { exited: boolean }, dir: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline && !handle.exited) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === 'ENOTEMPTY' || (error as NodeJS.ErrnoException).code === 'EBUSY'
      if (!busy || attempt >= 4) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

describe('host plugin smoke', () => {
  it('serves PDF with the browser-native content type', () => {
    expect(mediaTypeForPath('/work/report.PDF')).toBe('application/pdf')
    expect(mediaTypeForPath('/work/archive.bin')).toBe('application/octet-stream')
  })

  it('mounts the fenced routes', async () => {
    const fixture = await createSmokeContext()
    expect(fixture.routes.map(route => route.path)).toEqual([
      '/sidebar/api',
      '/sidebar/upload',
      '/sidebar/file',
      '/sidebar/html',
      '/sidebar/bundle',
    ])
    expect(fixture.upgrades).toEqual([])
    expect(fixture.ctx.get('sidebarTerminals')).toBeDefined()
    await fixture.dispose()
    expect(fixture.ctx.get('sidebarTerminals')).toBeUndefined()
    expect(fixture.routes).toEqual([])
    expect(fixture.upgrades).toEqual([])
  })

  it('pty manager releases the quota on close and respawns after exit', async () => {
    const manager = new PtyManager(defaultShell(), 3)
    try {
      const first = manager.open('s1', 't1', process.cwd(), 80, 24)
      expect(manager.keysOf('s1')).toHaveLength(1)
      // Tab-close semantics (close frame): quota released immediately.
      manager.scheduleClose(first.key, 0)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(manager.keysOf('s1')).toHaveLength(0)
      // Reopen spawns a fresh process.
      const second = manager.open('s1', 't1', process.cwd(), 80, 24)
      expect(second).not.toBe(first)
      expect(manager.keysOf('s1')).toHaveLength(1)
      // After the shell exits, a reconnect respawns instead of reusing the dead handle.
      second.pty.write('exit\r')
      const deadline = Date.now() + 5000
      while (!second.exited && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      expect(second.exited).toBe(true)
      const third = manager.open('s1', 't1', process.cwd(), 80, 24)
      expect(third.exited).toBe(false)
      expect(third).not.toBe(second)
    } finally {
      manager.disposeAll()
    }
  })

  it('pty manager: exited zombie handles do not consume the quota', async () => {
    const manager = new PtyManager(defaultShell(), 1)
    try {
      const first = manager.open('s3', 't1', process.cwd(), 80, 24)
      first.pty.write('exit\r')
      const deadline = Date.now() + 5000
      while (!first.exited && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      expect(first.exited).toBe(true)
      // Quota is 1; the exited handle is swept, so a NEW tab can still spawn.
      const second = manager.open('s3', 't2', process.cwd(), 80, 24)
      expect(second.exited).toBe(false)
      expect(manager.keysOf('s3')).toHaveLength(1)
    } finally {
      manager.disposeAll()
    }
  })

  it('pty manager: a reconnect within the grace period cancels the pending close', async () => {
    const manager = new PtyManager(defaultShell(), 3)
    try {
      const handle = manager.open('s2', 't1', process.cwd(), 80, 24)
      manager.scheduleClose(handle.key, 200)
      manager.open('s2', 't1', process.cwd(), 80, 24)
      await new Promise(resolve => setTimeout(resolve, 400))
      expect(manager.get(handle.key)).toBeDefined()
    } finally {
      manager.disposeAll()
    }
  })

  it('pty manager: a parked pty survives past the reconnect grace (session switch)', async () => {
    const manager = new PtyManager(defaultShell(), 3)
    try {
      const handle = manager.open('s2', 't1', process.cwd(), 80, 24)
      manager.park(handle.key)
      expect(manager.isParked(handle.key)).toBe(true)
      // A parked pty does NOT enter the grace countdown — it stays alive
      // well past any realistic reconnectGraceMs.
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(manager.get(handle.key)).toBeDefined()
      expect(manager.isParked(handle.key)).toBe(true)
    } finally {
      manager.disposeAll()
    }
  })

  it('pty manager: a reconnecting view clears the parked state (switch back)', () => {
    const manager = new PtyManager(defaultShell(), 3)
    try {
      const handle = manager.open('s2', 't1', process.cwd(), 80, 24)
      manager.park(handle.key)
      expect(manager.isParked(handle.key)).toBe(true)
      // open() calls cancelClose(), which clears the parked state — the
      // user switched back to the session and the view reattached.
      manager.open('s2', 't1', process.cwd(), 80, 24)
      expect(manager.isParked(handle.key)).toBe(false)
      expect(manager.get(handle.key)).toBeDefined()
    } finally {
      manager.disposeAll()
    }
  })

  it('pty manager: an explicit close frame on a parked pty still kills it', async () => {
    const manager = new PtyManager(defaultShell(), 3)
    try {
      const handle = manager.open('s2', 't1', process.cwd(), 80, 24)
      manager.park(handle.key)
      // The user switched back and closed the tab — scheduleClose (the
      // close-frame handler) clears the parked state and kills the pty.
      manager.scheduleClose(handle.key, 0)
      expect(manager.isParked(handle.key)).toBe(false)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(manager.get(handle.key)).toBeUndefined()
    } finally {
      manager.disposeAll()
    }
  })

  it('pty manager: park on an unknown key is a no-op', () => {
    const manager = new PtyManager(defaultShell(), 3)
    expect(() => manager.park('s2:nonexistent')).not.toThrow()
    expect(manager.isParked('s2:nonexistent')).toBe(false)
  })

  it('pty manager: reopening with a different cwd respawns in the new directory', async () => {
    const manager = new PtyManager(defaultShell(), 3)
    // A real second directory: os.tmpdir() exists on every platform ('/tmp'
    // does not exist on Windows).
    const other = tmpdir()
    try {
      const first = manager.open('s4', 't1', process.cwd(), 80, 24)
      // The hydrate race: the first connect fell back to the process cwd,
      // the reconnect carries the session's real cwd — the shell must move.
      const second = manager.open('s4', 't1', other, 80, 24)
      expect(second).not.toBe(first)
      expect(second.cwd).toBe(other)
      expect(manager.keysOf('s4')).toHaveLength(1)
      // A same-cwd reconnect reattaches without respawning.
      const third = manager.open('s4', 't1', other, 80, 24)
      expect(third).toBe(second)
      expect(manager.keysOf('s4')).toHaveLength(1)
    } finally {
      manager.disposeAll()
    }
  })

  it.skipIf(process.platform === 'win32')('spawns the shell as a login shell (loads ~/.profile)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-sidebar-login-'))
    const previousHome = process.env.HOME
    let handle: SidebarPty | undefined
    try {
      // A login bash reads ~/.profile (a non-login interactive bash reads
      // ~/.bashrc instead), so this marker proves the spawn used a login
      // argv — the terminal-emulator behavior the tab should match.
      writeFileSync(join(home, '.profile'), 'export DSH_LOGIN_MARKER=loaded-from-profile\n')
      process.env.HOME = home
      const manager = new PtyManager('/bin/bash', 3)
      try {
        handle = manager.open('s5', 't1', process.cwd(), 80, 24)
        handle.pty.write('echo $DSH_LOGIN_MARKER\r')
        const deadline = Date.now() + 5000
        while (!handle.transcript.includes('loaded-from-profile') && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        expect(handle.transcript).toContain('loaded-from-profile')
      } finally {
        manager.disposeAll()
      }
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      await rmTempDirAfterPtyExit(handle ?? { exited: true }, home)
    }
  })

  it('lists the sidebar package root level', async () => {
    const listing = await listDirectory(PACKAGE_ROOT, 1000)
    expect(listing.entries.some(entry => entry.name === 'src' && entry.isDir)).toBe(true)
    expect(listing.entries.some(entry => entry.name === 'package.json' && !entry.isDir)).toBe(true)
    expect(listing.truncated).toBe(false)
  })
})

describe('session cwd resolution over the API route', () => {
  const mountGit = async () => {
    onTestFinished(cleanupGit)
    const routes: SidebarWebRoute[] = []
    const upgrades: SidebarWebUpgradeRoute[] = []
    const h = await gitHarness({}, { subdirectory: true, extra: [
      { name: 'test-http-services', module: { apply(ctx: CordisContext) {
        ctx.provide('tools', { define: defineTool, register: () => () => {} })
        ctx.provide('webServer', {
          register: (route: SidebarWebRoute) => {
            routes.push(route)
            return () => { routes.splice(routes.indexOf(route), 1) }
          },
          registerUpgrade: (route: SidebarWebUpgradeRoute) => {
            upgrades.push(route)
            return () => { upgrades.splice(upgrades.indexOf(route), 1) }
          },
        })
        ctx.provide('webRuntime', { trustedHosts: [] })
      } } },
      { name: '@deepseek-ai/dsh-fs-local', module: LocalFileSystem },
      { name: '@deepseek-ai/dsh-git-local', module: LocalGitRuntime, config: {
        executable: 'git', maxOutputBytes: 8 * 1024 * 1024, maxLogEntries: 500, graceMs: 2_000,
      } },
      { name: '@deepseek-ai/dsh-client-ui-better-sidebar', module: SidebarHost },
    ] })
    const route = routes.find(candidate => candidate.path === '/sidebar/api')
    if (route === undefined) throw new Error('Sidebar API route was not registered')
    return { ...h, route }
  }

  type GitReadResults = {
    'git.diff': GitDiffResult
    'fs.read': unknown
  }

  const invokeGit = async <Method extends keyof GitReadResults>(route: SidebarWebRoute, method: Method, payload: unknown): Promise<{
    ok: boolean
    value?: GitReadResults[Method]
    error?: { code: string; message: string }
  }> => {
    const body = Buffer.from(JSON.stringify(payload))
    const request: SidebarHttpRequest = {
      method: 'POST', url: '/sidebar/api/' + method, headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () { yield body },
    }
    let responseBody = ''
    const response: SidebarHttpResponse = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status },
      end(chunk) { responseBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? []).toString('utf8') },
    }
    await route.handler(request, response)
    return JSON.parse(responseBody) as { ok: boolean; value?: GitReadResults[Method]; error?: { code: string; message: string } }
  }

  interface CtxOverrides {
    sessions?: { get: (id: string) => { header: { cwd?: string } } | undefined }
  }

  const mount = async (overrides: CtxOverrides = {}): Promise<SidebarWebRoute> => {
    const fixture = await createSmokeContext({ sessions: overrides.sessions })
    return fixture.routes.find(route => route.path === '/sidebar/api')!
  }

  const invoke = async (
    route: SidebarWebRoute,
    method: string,
    payload: unknown,
  ): Promise<{ ok: boolean; value?: { cwd: string }; error?: { message: string } }> => {
    const body = Buffer.from(JSON.stringify(payload))
    const req = {
      method: 'POST',
      url: `/sidebar/api/${method}`,
      headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () { yield body },
    } as never
    const out: { status: number; body: string } = { status: 200, body: '' }
    const res = {
      writeHead: (status: number) => { out.status = status },
      end: (chunk: unknown) => { out.body += String(chunk ?? '') },
    } as never
    await route.handler(req, res)
    return JSON.parse(out.body) as { ok: boolean; value?: { cwd: string }; error?: { message: string } }
  }

  it('refuses caller cwd when execution ownership is unavailable', async () => {
    const route = await mount()
    const result = await invoke(route, 'session.cwd', { sessionId: 's-detached', cwd: '/tmp/summary-cwd' })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/Execution bindings are not available/)
  })

  it('never substitutes the Host process cwd for missing execution ownership', async () => {
    const route = await mount()
    const result = await invoke(route, 'session.cwd', { sessionId: 's-unknown' })
    expect(result.ok).toBe(false)
    expect(result.value).toBeUndefined()
  })

  it('does not admit an attached header without the execution binding service', async () => {
    const route = await mount({
      sessions: {
        get: id => id === 's-attached' ? { header: { cwd: '/attached-cwd' } } : undefined,
      },
    })
    const result = await invoke(route, 'session.cwd', { sessionId: 's-attached', cwd: '/tmp/summary-cwd' })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/Execution bindings are not available/)
  })

  it('rejects a non-absolute client cwd', async () => {
    const route = await mount()
    const result = await invoke(route, 'session.cwd', { sessionId: 's-detached', cwd: 'relative/path' })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/Execution bindings are not available/)
  })

  it('git.diff resolves repo-relative paths through the attached nested Session and ignores caller cwd', async () => {
    const h = await mountGit()
    writeFileSync(join(h.repository, 'tracked.txt'), 'route change\n')
    const request: GitDiffRequest & { cwd: string } = {
      ...h.request, path: 'tracked.txt', staged: false, cwd: join(h.root, 'wrong-caller-cwd'),
    }
    const result = await invokeGit(h.route, 'git.diff', request)
    expect(result.ok).toBe(true)
    expect(result.value?.diff).toContain('diff --git a/tracked.txt b/tracked.txt')
    expect(result.value?.diff).toContain('-base')
    expect(result.value?.diff).toContain('+route change')
  }, 90_000)

  it('fs.read resolves repo-relative paths through the attached nested Session (untracked diff fallback)', async () => {
    const h = await mountGit()
    const result = await invokeGit(h.route, 'fs.read', {
      ...h.request, path: 'tracked.txt', cwd: join(h.root, 'wrong-caller-cwd'),
    })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.value).toEqual({ kind: 'text', content: 'base\n', truncated: false })
  }, 90_000)
})

describe('side card settings routes', () => {
  /** A minimal settings seam: register/describe/update with the revision guard. */
  const createFakeSettings = (pre?: Record<string, Record<string, unknown>>) => {
    const namespaces = new Map<string, {
      schema: unknown
      value: Record<string, unknown> | undefined
      revision: number
    }>()
    for (const [ns, value] of Object.entries(pre ?? {})) {
      namespaces.set(ns, { schema: (input: unknown) => input, value, revision: 0 })
    }
    const resolve = (entry: { schema: unknown; value: Record<string, unknown> | undefined }): unknown => {
      const schema = entry.schema as (input: unknown) => unknown
      return entry.value === undefined ? schema(undefined) : schema(entry.value)
    }
    return {
      register(ns: string, schema: unknown) {
        namespaces.set(ns, { schema, value: undefined, revision: 0 })
        return { get: () => ({}), watch: () => () => {}, update: async () => {}, replace: async () => {} }
      },
      describe() {
        return [...namespaces.entries()].map(([ns, entry]) => ({
          ns,
          value: resolve(entry),
          applies: 'live' as const,
          revision: entry.revision,
        }))
      },
      async update(ns: string, patch: Record<string, unknown>, expectedRevision?: number) {
        const entry = namespaces.get(ns)
        if (entry === undefined) throw new Error(`settings namespace "${ns}" is not registered`)
        if (expectedRevision !== undefined && expectedRevision !== entry.revision) {
          throw new SettingsConflictError(ns as SettingsNamespace, expectedRevision, entry.revision)
        }
        entry.value = { ...entry.value, ...patch }
        entry.revision += 1
      },
    }
  }

  const mountWithSettings = async (settings?: unknown): Promise<SidebarWebRoute> => {
    const fixture = await createSmokeContext({ settings })
    return fixture.routes.find(route => route.path === '/sidebar/api')!
  }

  const invoke = async (route: SidebarWebRoute, method: string, payload: unknown): Promise<{
    ok: boolean
    value?: unknown
    error?: { code?: string; message: string }
  }> => {
    const body = Buffer.from(JSON.stringify(payload))
    const req = {
      method: 'POST',
      url: `/sidebar/api/${method}`,
      headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () { yield body },
    } as never
    const out: { status: number; body: string } = { status: 200, body: '' }
    const res = {
      writeHead: (status: number) => { out.status = status },
      end: (chunk: unknown) => { out.body += String(chunk ?? '') },
    } as never
    await route.handler(req, res)
    return JSON.parse(out.body) as { ok: boolean; value?: unknown; error?: { code?: string; message: string } }
  }

  it('serves the schema defaults when the settings service is absent', async () => {
    const route = await mountWithSettings(undefined)
    const result = await invoke(route, 'settings.get', {})
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ value: undefined, revision: undefined, externalDisable: false })
  })

  it('reports externalDisable false when the aionui namespace is absent', async () => {
    const route = await mountWithSettings(createFakeSettings())
    const result = await invoke(route, 'settings.get', {})
    expect(result.ok).toBe(true)
    expect((result.value as { externalDisable?: boolean }).externalDisable).toBe(false)
  })

  it('reports externalDisable true while the aionui provider is selected', async () => {
    const route = await mountWithSettings(createFakeSettings({ 'aionui-panel': { rightPanel: 'aionui-panel' } }))
    const result = await invoke(route, 'settings.get', {})
    expect(result.ok).toBe(true)
    expect((result.value as { externalDisable?: boolean }).externalDisable).toBe(true)
  })

  it('serves the effective terminal shell and its display name', async () => {
    const route = await mountWithSettings(undefined)
    const result = await invoke(route, 'shell.get', {})
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({
      shell: expect.any(String),
      name: expect.any(String),
    })
    expect(String((result.value as { name: unknown }).name).length).toBeGreaterThan(0)
  })

  it('reads the resolved prefs and writes a patch through the seam', async () => {
    const route = await mountWithSettings(createFakeSettings())
    const read = await invoke(route, 'settings.get', {})
    expect(read.ok).toBe(true)
    expect(read.value).toEqual({
      value: {
        openByDefault: false,
        defaultWidthPercent: 35,
        autoOpenSubagent: true,
        autoOpenJobs: true,
        agentTerminalTools: false,
        bottomPanelAutoTerminal: true,
        terminalFontFamily: '',
        terminalFontSize: 13,
        terminalScrollback: 4000,
        terminalCursorStyle: 'block',
        terminalCursorBlink: true,
        interceptOpenPath: true,
        editorExplorer: false,
        terminalShell: '',
        terminalShellArgs: '',
        titleBarCompat: false,
        titleBarStripPx: 40,
        htmlViewerNoSandbox: false,
        htmlViewerDefaultUnsafe: false,
        browserNoSandbox: false,
        browserInterceptLinks: true,
        browserInterceptHttp: true,
        browserInterceptHttps: false,
        // The enable-switch maps default to {} (everything on).
        tabsEnabled: {},
        viewersEnabled: {},
        // The plugin-owned settings map defaults to {} too.
        pluginSettings: {},
      },
      revision: 0,
      externalDisable: false,
    })

    const written = await invoke(route, 'settings.update', { patch: { openByDefault: true } })
    expect(written.ok).toBe(true)
    const view = written.value as { value: { openByDefault: boolean; defaultWidthPercent: number }; revision: number }
    expect(view.value.openByDefault).toBe(true)
    expect(view.value.defaultWidthPercent).toBe(35)
    expect(view.revision).toBe(1)
  })

  it('refuses a stale write with settings-conflict (409)', async () => {
    const route = await mountWithSettings(createFakeSettings())
    await invoke(route, 'settings.update', { patch: { openByDefault: false } })
    // The second write carries the pre-write revision: the seam refuses it.
    const stale = await invoke(route, 'settings.update', {
      patch: { defaultWidthPercent: 40 },
      expectedRevision: 0,
    })
    expect(stale.ok).toBe(false)
    expect(stale.error?.code).toBe('settings-conflict')
    expect(stale.error?.message).toMatch(/changed since it was read/)
  })

  it('rejects a non-object patch as bad-request', async () => {
    const route = await mountWithSettings(createFakeSettings())
    const result = await invoke(route, 'settings.update', { patch: 'nope' })
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/plain object/)
  })
  /** Fake fetch responses shaped like what the route consumes. */
  const respond = (status: number, headers: Record<string, string>): Response =>
    ({ status, url: 'https://site.example/', headers: new Headers(headers) }) as unknown as Response

  it('reports X-Frame-Options and frame-ancestors from the target headers', async () => {
    const route = await mountWithSettings(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => respond(200, {
      'x-frame-options': 'SAMEORIGIN',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    })))
    try {
      const result = await invoke(route, 'browser.probe', { url: 'https://arxiv.org/' })
      expect(result.ok).toBe(true)
      expect(result.value).toEqual({
        reachable: true,
        url: 'https://site.example/',
        status: 200,
        xFrameOptions: 'SAMEORIGIN',
        frameAncestors: ["'none'"],
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retries a 405 HEAD as GET', async () => {
    const route = await mountWithSettings(undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respond(405, {}))
      .mockResolvedValueOnce(respond(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await invoke(route, 'browser.probe', { url: 'https://example.com/' })
      expect(result.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result.value).toMatchObject({ reachable: true, status: 200 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports an unreachable target as reachable:false', async () => {
    const route = await mountWithSettings(undefined)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND') }))
    try {
      const result = await invoke(route, 'browser.probe', { url: 'https://example.com/' })
      expect(result.ok).toBe(true)
      expect(result.value).toEqual({ reachable: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses non-http(s) and loopback URLs', async () => {
    const route = await mountWithSettings(undefined)
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://127.0.0.1:8080/', 'http://localhost/']) {
      const result = await invoke(route, 'browser.probe', { url })
      expect(result.ok, url).toBe(false)
      expect(result.error?.code, url).toBe('bad-request')
    }
  })
})


describe('agent terminal tool gating', () => {
  it('injects the eight tools only when the side-card setting is enabled (default off)', async () => {
    let registered = 0
    let disposed = 0
    // The tools currently registered (registered minus disposed).
    const live = (): number => registered - disposed
    // A ref container: the watch callback is only assigned inside a closure,
    // which TypeScript's control-flow analysis ignores (the bare variable
    // would narrow to null and refuse the optional call).
    const watcherRef: { current: (() => void) | null } = { current: null }
    let enabled = false
    const settings = {
      register() {
        return {
          get: () => ({ agentTerminalTools: enabled }),
          watch: (callback: () => void) => { watcherRef.current = callback; return () => {} },
          update: async () => {},
          replace: async () => {},
        }
      },
      describe: () => [],
      async update() {},
    }
    const fixture = await createSmokeContext({
      settings,
      tools: { define: defineTool, register: () => { registered += 1; return () => { disposed += 1 } } },
    })
    // Default off: no tools are registered even though the settings service is mounted.
    expect(live()).toBe(0)
    // Flipping the setting on registers all eight tools.
    enabled = true
    watcherRef.current?.()
    expect(live()).toBe(8)
    expect(disposed).toBe(0)
    // Flipping it back off unregisters them (and releases any agent terminals).
    enabled = false
    watcherRef.current?.()
    expect(live()).toBe(0)
    expect(disposed).toBe(8)
    // And a redundant toggle registers them fresh (no double-registration per
    // flip: the guard only skips when the tools are already live).
    enabled = true
    watcherRef.current?.()
    expect(live()).toBe(8)
    expect(registered).toBe(16)
    await fixture.dispose()
    expect(live()).toBe(0)
    expect(disposed).toBe(16)
  })


})
