/**
 * Loader compositions exercise Connection's authenticated Web carrier and
 * its listener-free Desktop Fetch carrier. Host commands, launches, PATH
 * resolution, and credential storage are faked; Connection's trust checks,
 * route registry, and the filesystem are real.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import {
  createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentLayerInput,
} from '@deepseek-ai/dsh-launch-environment'
import * as OpenInApp from '../src/index.ts'
import { internals } from '../src/internals.ts'
import type { OpenInAppLauncher } from '../src/resolver.ts'

let root: string | undefined
let context: Context | undefined
let carrier: 'web' | 'desktop'
let cookie = ''

async function fetch(input: string, init?: RequestInit): Promise<Response> {
  if (carrier === 'desktop') {
    return (context as Context).connection.createSharedFetchHandler('/api').fetch(new Request(input, init))
  }
  const headers = new Headers(init?.headers)
  headers.set('cookie', cookie)
  return globalThis.fetch(input, { ...init, headers })
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  internals.catalog = {}
  cookie = ''
  vi.unstubAllEnvs()
})

/** PATH-resolution fake answering from a fixed name-to-path table. */
function pathTable(entries: Record<string, string> = {}): (name: string) => Promise<string | null> {
  return name => Promise.resolve(entries[name] ?? null)
}

/** Boot the shared Fetch routes with an optional Web listener through the Loader. */
async function boot(layers: readonly LaunchEnvironmentLayerInput[] = []): Promise<string> {
  internals.catalog = { env: {}, ...internals.catalog }
  root ??= await mkdtemp(join(tmpdir(), 'dsh-open-in-app-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    ...(carrier === 'web' ? [
      "- name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '127.0.0.1'",
      '    port: 0',
    ] : []),
    "- name: '@deepseek-ai/dsh-client-connection'",
    "- name: '@deepseek-ai/dsh-host-open-in-app'",
    '  config:',
    '    probeTimeoutMs: 5000',
    '    iconTimeoutMs: 5000',
    '    launchWatchMs: 1000',
    '',
  ].join('\n'))

  context = new Context()
  context.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot(layers))
  context.baseUrl = pathToFileURL(root).href + '/'
  const credentials: Pick<Context['credentials'], 'modifyRecord'> = {
    modifyRecord: (_key, mutate) => mutate(undefined),
  }
  context.provide('credentials', credentials as Context['credentials'])
  // The plugin resolves PATH names through the composition's subprocess
  // capability; the not-found rejection is the provider's real signal.
  context.provide('subprocess', {
    resolveExecutable: () => Promise.reject(new Error('spec host resolves nothing')),
  } as never)
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-host-open-in-app', OpenInApp],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  expect([...context.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  if (carrier === 'desktop') {
    expect(context.get('webServer')).toBeUndefined()
    return 'dsh-app://app'
  }
  const base = 'http://127.0.0.1:' + String(context.webServer.port)
  const responseHeaders = new Headers()
  expect(context.connection.authorizeIndex({
    method: 'GET',
    url: context.connection.authenticatedUrl(base),
    headers: { host: new URL(base).host },
  }, {
    writeHead(_status, headers) {
      for (const [name, value] of Object.entries(headers ?? {})) responseHeaders.set(name, value)
    },
    end() {},
  })).toBe(false)
  cookie = responseHeaders.get('set-cookie')?.split(';', 1)[0] ?? ''
  expect(cookie).not.toBe('')
  return base
}

/**
 * macOS host with a Cursor bundle (carrying an icon) under the temp
 * application root; the injected launcher records every spawn.
 */
function darwinFixture(home: string, launches: string[][]): void {
  const run: NativeCommandRunner = async (command, args) => {
    if (command === 'plutil') return { stdout: JSON.stringify({ CFBundleIconFile: 'AppIcon' }), stderr: '' }
    if (command === 'sips') {
      const out = args[args.length - 1]
      if (typeof out !== 'string') throw new Error('missing sips --out')
      await writeFile(out, 'png-bytes')
      return { stdout: '', stderr: '' }
    }
    throw new Error(`fixture rejects: ${command} ${args.join(' ')}`)
  }
  const launch: OpenInAppLauncher = (command, args) => {
    launches.push([command, ...args])
    return Promise.resolve()
  }
  internals.catalog = {
    platform: 'darwin',
    applicationRoots: [join(home, 'Applications')],
    run,
    launch,
    resolveExecutable: pathTable(),
  }
}

/** Create the Cursor bundle fixture with an icns under the temp home. */
async function cursorBundle(home: string): Promise<void> {
  await mkdir(join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources'), { recursive: true })
  await writeFile(join(home, 'Applications', 'Cursor.app', 'Contents', 'Resources', 'AppIcon.icns'), 'icns')
}

describe.each(['web', 'desktop'] as const)('open-in-app %s routes (real Loader composition)', (transport) => {
  beforeEach(() => { carrier = transport })
  it.each(['project-env', 'user-env'] as const)('ignores materialized SSH markers from %s', async (source) => {
    vi.stubEnv('SSH_CONNECTION', 'stale-connection')
    vi.stubEnv('SSH_TTY', '/dev/pts/stale')
    internals.catalog = {
      platform: 'darwin', applicationRoots: [], env: process.env,
      run: () => Promise.reject(new Error('fixture rejects')), resolveExecutable: pathTable(),
    }
    const base = await boot([{ source, values: { SSH_CONNECTION: 'stale-connection', SSH_TTY: '/dev/pts/stale' } }])

    expect(await (await fetch(`${base}/api/open-in-app/apps`)).json()).toEqual({ apps: ['finder', 'terminal'] })
  })

  it.each([
    { SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22' },
    { SSH_TTY: '/dev/pts/3' },
  ])('returns an empty catalog and refuses icons and launches over SSH: %j', async (env) => {
    const run = vi.fn<NativeCommandRunner>()
    const launch = vi.fn<OpenInAppLauncher>()
    const resolveExecutable = vi.fn(pathTable())
    internals.catalog = { platform: 'darwin', env, run, launch, resolveExecutable }
    const base = await boot([{ source: 'process', values: env }])

    const apps = await fetch(`${base}/api/open-in-app/apps`)
    expect(apps.status).toBe(200)
    expect(await apps.json()).toEqual({ apps: [] })
    expect((await fetch(`${base}/api/open-in-app/icon/finder`)).status).toBe(404)
    const open = await fetch(`${base}/api/open-in-app/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'finder', path: root }),
    })
    expect(open.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
    expect(resolveExecutable).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('keeps the function-plugin runtime surface to Loader exports', () => {
    expect(Object.keys(OpenInApp).sort()).toEqual(['Config', 'apply', 'inject', 'name'])
  })

  it.skipIf(transport !== 'web')('rejects unauthenticated, cross-site, and untrusted-host requests before resolution', async () => {
    const run = vi.fn<NativeCommandRunner>()
    const launch = vi.fn<OpenInAppLauncher>()
    const resolveExecutable = vi.fn(pathTable())
    internals.catalog = { platform: 'darwin', run, launch, resolveExecutable }
    const base = await boot()
    for (const [path, method] of [
      ['/api/open-in-app/apps', 'GET'],
      ['/api/open-in-app/icon/finder', 'GET'],
      ['/api/open-in-app/open', 'POST'],
    ] as const) {
      const url = base + path
      expect((await globalThis.fetch(url, { method })).status).toBe(401)
      expect((await globalThis.fetch(url, {
        method, headers: { cookie, origin: 'https://untrusted.example' },
      })).status).toBe(403)
      // Fetch derives Host from the URL; node:http preserves this hostile wire header.
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(url, { method, headers: { cookie, host: 'untrusted.example' } }, (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode) })
          response.on('error', reject)
        })
        request.on('error', reject)
        request.end()
      })
      expect(status).toBe(403)
    }
    expect(run).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(resolveExecutable).not.toHaveBeenCalled()
    expect((await fetch(base + '/api/open-in-app/apps')).status).toBe(200)
  })

  it('serves the resolved catalog, one cached icon, and launches from the same resolution', async () => {
    const launches: string[][] = []
    const home = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-home-'))
    const workspace = join(home, 'workspace')
    await cursorBundle(home)
    await mkdir(workspace, { recursive: true })
    darwinFixture(home, launches)
    const base = await boot()
    try {
      const apps = await fetch(`${base}/api/open-in-app/apps`)
      expect(apps.status).toBe(200)
      expect(apps.headers.get('cache-control')).toBe('no-store')
      expect(await apps.json()).toEqual({ apps: ['finder', 'cursor', 'terminal'] })

      const icon = await fetch(`${base}/api/open-in-app/icon/cursor`)
      expect(icon.status).toBe(200)
      expect(icon.headers.get('content-type')).toBe('image/png')
      expect(await icon.text()).toBe('png-bytes')
      // Second read serves the per-process cache (same bytes, no re-extraction).
      expect(await (await fetch(`${base}/api/open-in-app/icon/cursor`)).text()).toBe('png-bytes')

      expect((await fetch(`${base}/api/open-in-app/icon/nonesuch`)).status).toBe(404)

      const open = await fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'cursor', path: workspace }),
      })
      expect(open.status).toBe(200)
      expect(await open.json()).toEqual({ ok: true })
      // The launcher is the resolution's verified bundle, not a re-probe.
      expect(launches).toEqual([['open', '-a', join(home, 'Applications', 'Cursor.app'), workspace]])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('resolves the catalog once: list reads, menu opens, and launches share the pass', async () => {
    const launches: string[][] = []
    const home = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-home-'))
    const workspace = join(home, 'workspace')
    await cursorBundle(home)
    await mkdir(workspace, { recursive: true })
    darwinFixture(home, launches)
    const resolveExecutable = vi.fn(pathTable())
    internals.catalog = { ...internals.catalog, resolveExecutable }
    const base = await boot()
    try {
      // Two list reads and a launch: detection ran once (macOS resolution
      // here is filesystem-only; the PATH resolver seat is the witness that
      // no second pass started).
      await fetch(`${base}/api/open-in-app/apps`)
      await fetch(`${base}/api/open-in-app/apps`)
      const open = await fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'cursor', path: workspace }),
      })
      expect(open.status).toBe(200)
      expect(launches).toHaveLength(1)
      expect(resolveExecutable).not.toHaveBeenCalled()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('refreshes one entry after a missing launcher and drops it when it no longer resolves', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-home-'))
    const workspace = join(home, 'workspace')
    await cursorBundle(home)
    await mkdir(workspace, { recursive: true })
    const attempts: string[][] = []
    const enoent = (): Promise<void> => Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    // First launch attempt: the resolved executable is gone; after the
    // refresh, the retried launch succeeds. Outcomes are thunks so no
    // rejection exists before the launcher consumes it.
    let launchOutcomes = [enoent, (): Promise<void> => Promise.resolve()]
    const launch: OpenInAppLauncher = (command, args) => {
      attempts.push([command, ...args])
      const next = launchOutcomes.shift()
      if (next === undefined) throw new Error('unexpected launch attempt')
      return next()
    }
    internals.catalog = {
      platform: 'darwin',
      applicationRoots: [join(home, 'Applications')],
      run: () => Promise.reject(new Error('fixture rejects')),
      launch,
      resolveExecutable: pathTable(),
    }
    const base = await boot()
    const openCursor = (): Promise<Response> => fetch(`${base}/api/open-in-app/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'cursor', path: workspace }),
    })
    try {
      expect((await openCursor()).status).toBe(200)
      // Two attempts: the stale launcher, then the freshly resolved one.
      expect(attempts).toHaveLength(2)

      // Remove the bundle: the next missing launch cannot re-resolve, the
      // route reports the failure, and the entry leaves the served list.
      await rm(join(home, 'Applications', 'Cursor.app'), { recursive: true, force: true })
      launchOutcomes = [enoent]
      expect((await openCursor()).status).toBe(502)
      expect(await (await fetch(`${base}/api/open-in-app/apps`)).json())
        .toEqual({ apps: ['finder', 'terminal'] })
      // The unresolved entry also stops serving an icon.
      expect((await fetch(`${base}/api/open-in-app/icon/cursor`)).status).toBe(404)
      expect((await openCursor()).status).toBe(400)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('rejects wrong methods, non-JSON content, malformed bodies, unknown apps, and bad paths', async () => {
    const launches: string[][] = []
    const home = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-home-'))
    await cursorBundle(home)
    darwinFixture(home, launches)
    const base = await boot()
    try {
      const wrongMethodApps = await fetch(`${base}/api/open-in-app/apps`, { method: 'POST' })
      expect(wrongMethodApps.status).toBe(404)
      expect((await fetch(`${base}/api/open-in-app/icon/cursor`, { method: 'POST' })).status).toBe(404)
      const wrongMethodOpen = await fetch(`${base}/api/open-in-app/open`)
      expect(wrongMethodOpen.status).toBe(404)

      // Body-format validation: only an application/json ESSENCE is accepted;
      // a parameter smuggling the token elsewhere does not count.
      const form = await fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'app=cursor',
      })
      expect(form.status).toBe(415)
      const smuggled = await fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;x=application/json' },
        body: JSON.stringify({ app: 'cursor', path: home }),
      })
      expect(smuggled.status).toBe(415)

      const post = (body: string): Promise<Response> => fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body,
      })
      expect((await post('not json')).status).toBe(400)
      expect((await post('7')).status).toBe(400)
      expect((await post('null')).status).toBe(400)
      expect((await post(JSON.stringify(['array'])) ).status).toBe(400)
      expect((await post(JSON.stringify({ app: 7, path: '/tmp' }))).status).toBe(400)
      expect((await post(JSON.stringify({ app: 'vscode', path: home }))).status).toBe(400)
      expect((await post(JSON.stringify({ app: 'nonesuch', path: home }))).status).toBe(400)
      expect((await post(JSON.stringify({ app: join(home, 'arbitrary.exe'), path: home }))).status).toBe(400)
      expect((await post(JSON.stringify({ app: 'cursor', path: 'relative/dir' }))).status).toBe(400)
      expect((await post(JSON.stringify({ app: 'cursor', path: '' }))).status).toBe(400)
      expect((await post(JSON.stringify({ app: 'cursor', path: join(home, 'missing') }))).status).toBe(404)
      const file = join(home, 'ordinary-file')
      await writeFile(file, '')
      expect((await post(JSON.stringify({ app: 'cursor', path: file }))).status).toBe(404)
      const oversize = await post(JSON.stringify({ app: 'cursor', path: '/'.padEnd(70_000, 'x') }))
      expect(oversize.status).toBe(413)
      expect(launches).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('accepts exactly 64 KiB and rejects oversized streamed UTF-8 bodies before launching', async () => {
    const launches: string[][] = []
    const base = await boot()
    await cursorBundle(root as string)
    darwinFixture(root as string, launches)
    const body = JSON.stringify({ app: 'cursor', path: root })
    const exact = body + ' '.repeat(64 * 1024 - Buffer.byteLength(body))
    const post = (value: string): Promise<Response> => fetch(base + '/api/open-in-app/open', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: value,
    })
    expect((await post(exact)).status).toBe(200)
    expect(launches).toHaveLength(1)
    expect((await post(exact + ' ')).status).toBe(413)
    const bytes = new TextEncoder().encode('界'.repeat(22_000))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.byteLength; at += 4096) controller.enqueue(bytes.slice(at, at + 4096))
        controller.close()
      },
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half',
    }
    const oversized = await fetch(base + '/api/open-in-app/open', init)
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toMatchObject({ code: 'payload-too-large' })
    expect(launches).toHaveLength(1)
  })

  it.skipIf(transport !== 'desktop')('refuses empty or unreadable Fetch bodies', async () => {
    const launch = vi.fn<OpenInAppLauncher>()
    internals.catalog = { platform: 'darwin', applicationRoots: [], launch, resolveExecutable: pathTable() }
    const base = await boot()
    const empty = await fetch(base + '/api/open-in-app/open', {
      method: 'POST', headers: { 'content-type': 'application/json' },
    })
    expect(empty.status).toBe(400)
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST', headers: { 'content-type': 'application/json' }, duplex: 'half',
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('body interrupted')) } }),
    }
    const unreadable = await fetch(base + '/api/open-in-app/open', init)
    expect(unreadable.status).toBe(400)
    expect(await unreadable.json()).toMatchObject({ message: 'request body unreadable' })
    expect(launch).not.toHaveBeenCalled()
  })

  it('reports a failed launcher as 502 and an empty catalog on a platform without entries', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-home-'))
    const workspace = join(home, 'workspace')
    await mkdir(workspace, { recursive: true })
    internals.catalog = {
      platform: 'darwin',
      applicationRoots: [join(home, 'Applications')],
      run: () => Promise.reject(new Error('down')),
      launch: () => Promise.reject(new Error('down')),
      resolveExecutable: pathTable(),
    }
    const base = await boot()
    try {
      // finder/terminal resolve (fixed entries) but their launch fails.
      const open = await fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'finder', path: workspace }),
      })
      expect(open.status).toBe(502)
      // An unresolved entry stays rejected as unavailable.
      expect((await fetch(`${base}/api/open-in-app/icon/cursor`)).status).toBe(404)
    } finally {
      await rm(home, { recursive: true, force: true })
    }

    await context?.fiber.dispose()
    context = undefined
    internals.catalog = { platform: 'aix', resolveExecutable: pathTable() }
    const emptyBase = await boot()
    expect(await (await fetch(`${emptyBase}/api/open-in-app/apps`)).json()).toEqual({ apps: [] })
  })

  it('serves a Linux catalog resolved in-process and its desktop-entry SVG icon', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-open-in-app-home-'))
    const workspace = join(home, 'workspace')
    await mkdir(workspace, { recursive: true })
    const applications = join(home, '.local', 'share', 'applications')
    await mkdir(applications, { recursive: true })
    const svg = join(home, 'code.svg')
    await writeFile(svg, '<svg/>')
    await writeFile(join(applications, 'code.desktop'), `[Desktop Entry]\nExec=code\nIcon=${svg}\n`)
    const launches: string[][] = []
    const launch: OpenInAppLauncher = (command, args) => {
      launches.push([command, ...args])
      return Promise.resolve()
    }
    internals.catalog = {
      platform: 'linux',
      home,
      env: { XDG_DATA_DIRS: join(home, 'xdg-empty'), DISPLAY: ':0' },
      run: () => Promise.reject(new Error('fixture rejects')),
      launch,
      resolveExecutable: pathTable({ 'xdg-open': '/usr/bin/xdg-open', code: '/usr/bin/code' }),
    }
    const base = await boot()
    try {
      expect(await (await fetch(`${base}/api/open-in-app/apps`)).json())
        .toEqual({ apps: ['filemanager', 'vscode'] })
      // The icon follows the desktop entry; xdg-open declares none.
      const icon = await fetch(`${base}/api/open-in-app/icon/vscode`)
      expect(icon.status).toBe(200)
      expect(icon.headers.get('content-type')).toBe('image/svg+xml')
      expect(await icon.text()).toBe('<svg/>')
      expect((await fetch(`${base}/api/open-in-app/icon/filemanager`)).status).toBe(404)

      const open = await fetch(`${base}/api/open-in-app/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'vscode', path: workspace }),
      })
      expect(open.status).toBe(200)
      expect(launches).toEqual([['/usr/bin/code', workspace]])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it.skipIf(transport !== 'web')('survives a connection closing mid-body', async () => {
    internals.catalog = { platform: 'aix', resolveExecutable: pathTable() }
    const base = await boot()
    const port = Number(new URL(base).port)
    // A declared body the client never finishes: destroying the socket makes
    // the request stream error inside readBoundedBody.
    const status = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write([
          'POST /api/open-in-app/open HTTP/1.1',
          `host: 127.0.0.1:${String(port)}`,
          `cookie: ${cookie}`,
          'content-type: application/json',
          'content-length: 100',
          '',
          '{"app":',
        ].join('\r\n'))
        setTimeout(() => { socket.destroy() }, 50)
      })
      let answer = ''
      socket.on('data', (chunk) => { answer += String(chunk) })
      socket.on('close', () => { resolve(answer) })
      socket.on('error', reject)
    })
    // The server sent its refusal before our destroy landed, or the exchange
    // simply died first — either way the handler must not crash the process.
    expect(status === '' || status.startsWith('HTTP/1.1 400')).toBe(true)
    expect((await fetch(`${base}/api/open-in-app/apps`)).status).toBe(200)
  })

  it('resolves PATH names through the composition subprocess capability when the seam does not override it', async () => {
    internals.catalog = {
      platform: 'linux',
      env: { XDG_DATA_DIRS: '/nonexistent-xdg' },
      home: '/nonexistent-home',
      run: () => Promise.reject(new Error('fixture rejects')),
    }
    const base = await boot()
    // The spec host's subprocess stub rejects every lookup, which the plugin
    // reads as not-on-PATH: the catalog resolves empty instead of failing.
    expect(await (await fetch(`${base}/api/open-in-app/apps`)).json()).toEqual({ apps: [] })
  })

  it('removes all three routes when the plugin row is disposed (HMR safety)', async () => {
    internals.catalog = { platform: 'aix', resolveExecutable: pathTable() }
    const base = await boot()
    expect((await fetch(`${base}/api/open-in-app/apps`)).status).toBe(200)
    const entry = [...(context as Context).loader.entries()]
      .find(candidate => candidate.options.name === '@deepseek-ai/dsh-host-open-in-app')
    await entry?.fiber?.dispose()
    // Connection survives the feature; its route registry no longer dispatches these paths.
    expect((await fetch(`${base}/api/open-in-app/apps`)).status).toBe(404)
    expect((await fetch(`${base}/api/open-in-app/icon/cursor`)).status).toBe(404)
    expect((await fetch(`${base}/api/open-in-app/open`, { method: 'POST' })).status).toBe(404)
  })
})
