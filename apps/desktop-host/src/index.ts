/**
 * Electron child-process entry: boots the desktop project without a listening
 * socket and carries API plus validated Web assets over framed byte pipes.
 * @module @deepseek-ai/dsh-desktop-host
 */

import { createRequire } from 'node:module'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import * as desktopOffice from './office.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  composeEntries,
  loadLayeredEnv,
  loadProfileDirectory,
  loadOverlayPatches,
  reconcileProfilePatches,
  runProfileConfiguration,
  type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import type { PluginManagementHost } from '@deepseek-ai/dsh-plugin-manager/types'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type { ConnectionFetchHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-modules'
import { renderIndexInjections, type IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  type DesktopHostRequestFrame,
} from './wire.ts'
import { installDesktopUpdateTaskControl, type DesktopUpdateTaskAction } from './update-tasks.ts'

export { DESKTOP_HOST_PROTOCOL_VERSION } from './wire.ts'

/** One request forwarded from Electron's `dsh-app://` handler. */
export interface DesktopHostFetchCommand {
  readonly streamId: number
  readonly request: {
    readonly url: string
    readonly method: string
    readonly headers: readonly [string, string][]
  }
}

/** Commands accepted by the desktop child process. */
export type DesktopHostCommand = {
  readonly type: 'shutdown'
} | {
  readonly type: 'update-tasks'
  readonly requestId: number
  readonly action: DesktopUpdateTaskAction
}

/** Events emitted by the desktop child process. */
export type DesktopHostEvent = {
  readonly type: 'ready'
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly dshVersion: string
} | {
  readonly type: 'fatal'
  readonly message: string
} | {
  readonly type: 'shutdown-complete'
} | {
  readonly type: 'update-tasks'
  readonly requestId: number
  readonly active: boolean
  readonly error?: string
}

/** Controller returned to tests and the self-executing process entry. */
export interface DesktopHostController {
  /** Installed dsh version carried by this host. */
  readonly dshVersion: string
  /** Dispatch one custom-protocol request and stream its response to the response pipe. */
  fetch(command: DesktopHostFetchCommand, body: ReadableStream<Uint8Array> | null): Promise<void>
  /** Abort one in-flight request. */
  cancel(streamId: number): void
  /** Inspect tasks or change native API admission for installation. */
  updateTasks(action: DesktopUpdateTaskAction): Promise<boolean>
  /** Stop accepting messages and await complete host teardown. */
  dispose(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDesktopHostCommand(message: unknown): message is DesktopHostCommand {
  if (!isRecord(message)) return false
  return message.type === 'shutdown' || (message.type === 'update-tasks'
    && Number.isSafeInteger(message.requestId) && (message.requestId as number) > 0
    && (message.action === 'inspect' || message.action === 'lock' || message.action === 'unlock'))
}

interface PackageManifest {
  readonly name?: string
  readonly version?: string
}

const DESKTOP_PATCH = fileURLToPath(new URL('../config/desktop.cordis.patch.yml', import.meta.url))
const ROOT_CONFIG = '# Electron desktop composition root; package transactions own this file.\n[]\n'
const ROOT_CONFIG_FILENAME = 'desktop.cordis.yml'
const DESKTOP_STREAM_PATH = '/.dsh/remote-stream'

const DESKTOP_TRANSPORT_SCRIPT = `globalThis.__DSH_TRANSPORT__={
  ownsHost:true,
  async *openStream(endpoint,payload,signal){
    const response=await fetch(${JSON.stringify(DESKTOP_STREAM_PATH)},{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint,payload}),signal
    })
    if(!response.ok||response.body===null)throw new Error('desktop stream transport failed: HTTP '+response.status)
    const reader=response.body.getReader(),decoder=new TextDecoder()
    let pending=''
    for(;;){
      const {done,value}=await reader.read()
      pending+=decoder.decode(value,{stream:!done})
      let newline
      while((newline=pending.indexOf('\\n'))!==-1){
        const line=pending.slice(0,newline);pending=pending.slice(newline+1)
        if(line!=='')yield JSON.parse(line)
      }
      if(done)break
    }
    if(pending!=='')yield JSON.parse(pending)
  }
}`

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

function readManifest(path: string): PackageManifest {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(value)) throw new Error(`dsh desktop: ${path} must contain a package manifest`)
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
  }
}

function packageManifestPath(projectDir: string, packageName: string): string {
  const path = join(projectDir, 'node_modules', ...packageName.split('/'), 'package.json')
  if (!existsSync(path)) throw new Error(`dsh desktop: installed package ${JSON.stringify(packageName)} has no manifest`)
  return path
}

function isProjectPath(projectDir: string, target: string): boolean {
  const root = realpathSync(projectDir)
  const path = realpathSync(target)
  return path === root || path.startsWith(root + sep)
}

/** Compose installed Desktop bundles under the mandatory native transport overlay.
 * @param projectDir Active or staged shell-owned project.
 * @param allowLinkedPackages Permit workspace links only in an isolated development project.
 * @returns Detached patches used by both initial boot and live configuration changes.
 */
export function desktopPatches(projectDir: string, allowLinkedPackages: boolean): PatchOptions[] {
  const dshRoot = dirname(packageManifestPath(projectDir, '@deepseek-ai/dsh'))
  const profile = loadProfileDirectory('dsh desktop', projectDir, join(dshRoot, 'package.json'))
  for (const layer of profile.layers) {
    if (!allowLinkedPackages && !isProjectPath(projectDir, layer.packageDir)) {
      throw new Error(`dsh desktop: profile bundle ${JSON.stringify(layer.packageName)} resolved outside the desktop profile`)
    }
  }
  const layers = [
    ...profile.layers.map(layer => layer.patches),
    profile.patches,
    loadOverlayPatches('dsh desktop', DESKTOP_PATCH),
  ]
  const rows = new Map(composeEntries(layers).flatMap(row => typeof row.id === 'string' ? [[row.id, row] as const] : []))
  const agentPresets = rows.get('agent-presets')
  if (agentPresets !== undefined) {
    layers.push([{
      id: 'agent-presets',
      config: {
        ...(agentPresets.config ?? {}) as Record<string, unknown>,
        roots: [{ path: join(dshRoot, 'config', 'agent-presets'), trust: 'system' }],
      },
    }])
  }
  return layers.flat()
}

function dshVersion(projectDir: string): string {
  const manifest = readManifest(packageManifestPath(projectDir, '@deepseek-ai/dsh'))
  if (typeof manifest.version !== 'string') throw new Error('dsh desktop: installed dsh manifest has no version')
  return manifest.version
}

function assetHandler(ctx: Context, projectDir: string): ConnectionFetchHandler {
  const require = createRequire(join(projectDir, 'package.json'))
  const distIndex = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  const distRoot = realpathSync(dirname(distIndex))
  const renderIndex = async (): Promise<Response> => {
    const rows: IndexInjection[] = [{ kind: 'script', placement: 'head', text: DESKTOP_TRANSPORT_SCRIPT }]
    ctx.emit('webserver/index-inject', rows)
    const body = renderIndexInjections(await readFile(distIndex, 'utf8'), rows)
    return new Response(body, { headers: { 'content-type': MIME['.html'] ?? 'text/html; charset=utf-8' } })
  }
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request): Promise<Response> {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      if (url.pathname.startsWith('/plugins/')) return ctx.clientModules.fetchBundle(request)
      let pathname: string
      try {
        pathname = decodeURIComponent(url.pathname)
      } catch {
        return new Response(null, { status: 400 })
      }
      if (pathname === '/' || pathname === '/index.html') return renderIndex()
      const target = resolve(normalize(join(distRoot, pathname)))
      if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
      try {
        const realTarget = realpathSync(target)
        if (realTarget !== distRoot && !realTarget.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
        return new Response(request.method === 'HEAD' ? null : await readFile(realTarget), {
          headers: { 'content-type': MIME[extname(realTarget)] ?? 'application/octet-stream' },
        })
      } catch {
        return renderIndex()
      }
    },
  }
}

function remoteStreamHandler(ctx: Context): ConnectionFetchHandler {
  return {
    requestBodyMode: () => 'buffered',
    async fetch(request): Promise<Response> {
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      const gateway = ctx.get('typertGateway')
      if (gateway === undefined) return new Response('gateway unavailable', { status: 503 })
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      if (!isRecord(body) || typeof body.endpoint !== 'string') {
        return new Response('invalid stream request', { status: 400 })
      }
      const abort = new AbortController()
      const signal = AbortSignal.any([request.signal, abort.signal])
      const encoder = new TextEncoder()
      const values = await gateway.wireStream.open(body.endpoint, body.payload, signal)
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const value of values) {
              controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        },
        cancel(reason) {
          abort.abort(reason)
        },
      })
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
    },
  }
}

interface NodeRequestInit extends RequestInit {
  readonly duplex?: 'half'
}

/**
 * Boot one installed desktop npm project.
 * @param projectDir - active or staged Electron-owned desktop profile.
 * @param writeResponse - serialized response-pipe writer that applies byte backpressure.
 * @param options - Bundled Office payload and development-only allowance for workspace links.
 * @returns controller after every Host and client-manifest row is active.
 */
export async function runDesktopHost(
  projectDir: string,
  writeResponse: (frame: Buffer) => Promise<void>,
  options: { primaryRuntime: string; allowLinkedPackages?: boolean },
): Promise<DesktopHostController> {
  const absoluteProject = resolve(projectDir)
  mkdirSync(absoluteProject, { recursive: true })
  const rootConfig = join(absoluteProject, ROOT_CONFIG_FILENAME)
  writeFileSync(rootConfig, ROOT_CONFIG)
  const environment = loadLayeredEnv('dsh desktop')
  const disposeProxy = await installProxyFromEnvironment(environment, (message) => {
    process.stderr.write(`dsh desktop: ${message}\n`)
  })
  let current: Context | undefined
  const requests = new Map<number, AbortController>()
  let updateTasks: ReturnType<typeof installDesktopUpdateTaskControl> | undefined
  let disposing: Promise<void> | undefined
  const dispose = (): Promise<void> => disposing ??= (async () => {
    updateTasks?.dispose()
    for (const controller of requests.values()) controller.abort()
    requests.clear()
    try {
      await current?.fiber.dispose()
    } finally {
      current = undefined
      await disposeProxy()
    }
  })()

  try {
    const installAnchor = packageManifestPath(absoluteProject, '@deepseek-ai/dsh')
    const profile = loadProfileDirectory('dsh desktop', absoluteProject, installAnchor)
    const profileContext: ProfileContext = {
      name: 'desktop', dir: absoluteProject, patchPath: profile.patchPath, patchReload: 'live',
      installAnchor, cwd: absoluteProject, home: resolveDshHome(),
      startedBundles: profile.layers.map(layer => layer.packageName),
      overlays: loadOverlayPatches('dsh desktop', DESKTOP_PATCH),
      telemetryDisabledEnv: environment.get('DSH_TELEMETRY_DISABLED')?.value,
    }
    const management: PluginManagementHost = {
      protectedIds: ['timer', 'hmr', 'plugin-manager', 'ui-plugin-manager', 'web-startup', 'webserver',
        'web-runtime', 'client-hmr', 'directory-picker', 'directory-picker-native', 'ui-directory-picker-native', 'connection'],
      readPatches: () => desktopPatches(absoluteProject, options.allowLinkedPackages === true),
    }
    const ctx = await boot('dsh desktop', rootConfig, management.readPatches(), (hostCtx) => {
      current = hostCtx
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
      hostCtx.provide('dshProfileName', 'desktop')
      hostCtx.provide('profileContext', profileContext)
      hostCtx.provide('pluginManagementHost', management)
      provideCmdline(hostCtx, { args: [], exit: () => {} })
    })
    current = ctx
    const connection = ctx.get('connection')
    if (connection === undefined || ctx.get('clientModules') === undefined || ctx.get('typertGateway') === undefined) {
      throw new Error('dsh desktop: composition did not provide connection, typertGateway, and clientModules')
    }
    const hmr = ctx.get('hmr')
    if (hmr === undefined || hmr.config.root.length !== 0) {
      throw new Error('dsh desktop: live configuration requires config-only HMR')
    }
    await hmr.registerConfig(profile.patchPath, () => runProfileConfiguration(ctx, async () => {
      await reconcileProfilePatches(ctx, management.readPatches(), 'dsh desktop')
    }))
    // Close the gap between initial composition and the exact-path subscription.
    await runProfileConfiguration(ctx, async () => {
      await reconcileProfilePatches(ctx, management.readPatches(), 'dsh desktop')
    })
    await ctx.plugin(desktopOffice, {
      source: options.primaryRuntime,
      root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
    })
    const api = connection.createSharedFetchHandler('/api')
    const assets = assetHandler(ctx, absoluteProject)
    const streams = remoteStreamHandler(ctx)
    const taskControl = installDesktopUpdateTaskControl(ctx)
    updateTasks = taskControl

    return {
      dshVersion: dshVersion(absoluteProject),
      updateTasks: action => disposing === undefined
        ? taskControl.run(action)
        : Promise.reject(new Error('desktop update: Host is stopping')),
      cancel(streamId) {
        requests.get(streamId)?.abort()
      },
      async fetch(command, body) {
        if (disposing !== undefined) throw new Error('dsh desktop: host is disposing')
        const controller = new AbortController()
        requests.set(command.streamId, controller)
        try {
          const url = new URL(command.request.url)
          const init: NodeRequestInit = {
            method: command.request.method,
            headers: new Headers(command.request.headers.map(([name, value]) => [name, value] as [string, string])),
            ...(body === null ? {} : { body, duplex: 'half' }),
            signal: controller.signal,
          }
          const request = new Request(url, init)
          const response = url.pathname === DESKTOP_STREAM_PATH
            ? await taskControl.dispatch(() => streams.fetch(request))
            : url.pathname === '/api' || url.pathname.startsWith('/api/')
              ? await taskControl.dispatch(() => api.fetch(request))
              : await assets.fetch(request)
          await writeResponse(encodeDesktopResponseStart(command.streamId, {
            status: response.status,
            headers: [...response.headers.entries()],
            hasBody: response.body !== null,
          }))
          if (response.body !== null) {
            for await (const chunk of response.body) {
              const bytes = Buffer.from(chunk)
              for (let offset = 0; offset < bytes.byteLength; offset += DESKTOP_PIPE_CHUNK_BYTES) {
                await writeResponse(encodeDesktopResponseData(
                  command.streamId,
                  bytes.subarray(offset, offset + DESKTOP_PIPE_CHUNK_BYTES),
                ))
              }
            }
          }
          await writeResponse(encodeDesktopResponseEnd(command.streamId))
        } catch (error) {
          if (!controller.signal.aborted) {
            await writeResponse(encodeDesktopResponseError(
              command.streamId,
              error instanceof Error ? error.message : String(error),
            ))
          }
        } finally {
          requests.delete(command.streamId)
        }
      },
      dispose,
    }
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'dsh desktop: boot and cleanup failed')
    }
    throw error
  }
}

async function main(): Promise<void> {
  const projectDir = process.argv[2]
  if (projectDir === undefined || process.send === undefined) {
    throw new Error('dsh desktop: expected project directory, byte pipes, and a Node IPC channel')
  }
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { 'primary-runtime': { type: 'string' }, 'allow-linked-profile': { type: 'boolean' } },
  })
  const primaryRuntime = values['primary-runtime']
  if (primaryRuntime === undefined || !isAbsolute(primaryRuntime)) {
    throw new Error('dsh desktop: --primary-runtime requires an absolute bundled payload directory')
  }
  const requestPipe = createReadStream('', { fd: DESKTOP_REQUEST_PIPE_FD, autoClose: false })
  const responsePipe = createWriteStream('', { fd: DESKTOP_RESPONSE_PIPE_FD, autoClose: false })
  let responseWriteTail: Promise<void> = Promise.resolve()
  const writeResponse = (frame: Buffer): Promise<void> => {
    const write = responseWriteTail.then(async () => {
      if (responsePipe.destroyed) throw new Error('dsh desktop: Electron response pipe is unavailable')
      if (!responsePipe.write(frame)) await once(responsePipe, 'drain')
    })
    responseWriteTail = write.catch(() => undefined)
    return write
  }
  const send = (event: DesktopHostEvent): void => {
    if (process.send === undefined || !process.connected) return
    try {
      process.send(event)
    } catch (error) {
      // A concurrent parent disconnect owns teardown; only that closed-channel
      // condition is safe to discard while streamed responses unwind.
      if ((error as NodeJS.ErrnoException).code !== 'ERR_IPC_CHANNEL_CLOSED') throw error
    }
  }
  const controller = await runDesktopHost(projectDir, writeResponse, { primaryRuntime, allowLinkedPackages: values['allow-linked-profile'] === true })
  send({
    type: 'ready',
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    dshVersion: controller.dshVersion,
  })
  const decoder = new DesktopHostRequestDecoder()
  const requestBodies = new Map<number, ReadableStreamDefaultController<Uint8Array>>()
  const blockedRequests = new Set<number>()
  const discardedRequestBodies = new Set<number>()
  const runs = new Set<Promise<void>>()
  let lastStreamId = 0
  let requestedExitCode = 0
  let stopping: Promise<void> | undefined

  const resumeRequestPipe = (): void => {
    if (blockedRequests.size === 0) requestPipe.resume()
  }

  const stop = (exitCode = 0): Promise<void> => {
    requestedExitCode = Math.max(requestedExitCode, exitCode)
    stopping ??= (async () => {
      requestPipe.pause()
      requestPipe.removeAllListeners('data')
      const stopped = new Error('dsh desktop: Host is stopping')
      for (const body of requestBodies.values()) body.error(stopped)
      requestBodies.clear()
      blockedRequests.clear()
      discardedRequestBodies.clear()
      const requestClosed = once(requestPipe, 'close')
      requestPipe.destroy()
      await requestClosed
      await controller.dispose()
      await Promise.allSettled([...runs])
      await responseWriteTail.catch(() => undefined)
      if (!responsePipe.destroyed) {
        await new Promise<void>((resolvePromise) => { responsePipe.end(resolvePromise) })
        const responseClosed = once(responsePipe, 'close')
        responsePipe.destroy()
        await responseClosed
      }
      const sendShutdown = process.send?.bind(process)
      if (requestedExitCode === 0 && process.connected && sendShutdown !== undefined) {
        await new Promise<void>((resolveSend, reject) => {
          sendShutdown( { type: 'shutdown-complete' } satisfies DesktopHostEvent, (error) => {
            if (error === null) resolveSend(); else reject(error)
          })
        })
      }
      if (process.connected) process.disconnect()
      process.exitCode = requestedExitCode
    })()
    return stopping
  }

  const failTransport = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error)
    send({ type: 'fatal', message })
    void stop(1)
  }

  const beginRequest = (frame: Extract<DesktopHostRequestFrame, { type: 'start' }>): void => {
    if (frame.streamId <= lastStreamId) {
      throw new Error(`dsh desktop: Electron reused or reordered request stream ${String(frame.streamId)}`)
    }
    lastStreamId = frame.streamId
    let body: ReadableStream<Uint8Array> | null = null
    if (frame.hasBody) {
      body = new ReadableStream<Uint8Array>({
        start(controllerOfBody) {
          requestBodies.set(frame.streamId, controllerOfBody)
        },
        pull() {
          blockedRequests.delete(frame.streamId)
          resumeRequestPipe()
        },
        cancel() {
          requestBodies.delete(frame.streamId)
          blockedRequests.delete(frame.streamId)
          controller.cancel(frame.streamId)
          resumeRequestPipe()
        },
      })
    }
    const run = controller.fetch({
      streamId: frame.streamId,
      request: {
        url: frame.url,
        method: frame.method,
        headers: frame.headers,
      },
    }, body)
    runs.add(run)
    void run.catch(failTransport).finally(() => {
      runs.delete(run)
      const openBody = requestBodies.get(frame.streamId)
      if (openBody === undefined) return
      openBody.error(new Error('dsh desktop: response completed before the request body ended'))
      requestBodies.delete(frame.streamId)
      blockedRequests.delete(frame.streamId)
      discardedRequestBodies.add(frame.streamId)
      resumeRequestPipe()
    })
  }

  const handleRequestFrame = (frame: DesktopHostRequestFrame): void => {
    switch (frame.type) {
      case 'start':
        beginRequest(frame)
        return
      case 'data': {
        const body = requestBodies.get(frame.streamId)
        if (body === undefined) {
          if (discardedRequestBodies.has(frame.streamId)) return
          throw new Error(`dsh desktop: Electron sent body data for inactive stream ${String(frame.streamId)}`)
        }
        body.enqueue(frame.data)
        if ((body.desiredSize ?? 0) <= 0) {
          blockedRequests.add(frame.streamId)
          requestPipe.pause()
        }
        return
      }
      case 'end': {
        const body = requestBodies.get(frame.streamId)
        if (body === undefined) {
          if (discardedRequestBodies.delete(frame.streamId)) return
          throw new Error(`dsh desktop: Electron ended inactive body stream ${String(frame.streamId)}`)
        }
        body.close()
        requestBodies.delete(frame.streamId)
        blockedRequests.delete(frame.streamId)
        resumeRequestPipe()
        return
      }
      case 'cancel': {
        if (frame.streamId > lastStreamId) {
          throw new Error(`dsh desktop: Electron canceled unknown stream ${String(frame.streamId)}`)
        }
        const body = requestBodies.get(frame.streamId)
        body?.error(new Error('dsh desktop: Electron canceled the request'))
        requestBodies.delete(frame.streamId)
        blockedRequests.delete(frame.streamId)
        discardedRequestBodies.delete(frame.streamId)
        controller.cancel(frame.streamId)
        resumeRequestPipe()
        return
      }
      default:
        frame satisfies never
    }
  }

  requestPipe.on('data', (chunk: string | Buffer) => {
    try {
      for (const frame of decoder.push(Buffer.from(chunk))) handleRequestFrame(frame)
    } catch (error) {
      failTransport(error)
    }
  })
  requestPipe.once('end', () => {
    if (stopping !== undefined) return
    try {
      decoder.finish()
      failTransport(new Error('dsh desktop: Electron request pipe ended'))
    } catch (error) {
      failTransport(error)
    }
  })
  requestPipe.once('error', failTransport)
  responsePipe.once('error', failTransport)
  process.on('message', (message: unknown) => {
    if (!isDesktopHostCommand(message)) {
      send({ type: 'fatal', message: 'dsh desktop: invalid Electron IPC command' })
      void stop(1)
      return
    }
    if (message.type === 'update-tasks') {
      void controller.updateTasks(message.action).then(
        (active) =>{  send({ type: 'update-tasks', requestId: message.requestId, active }) },
        (error: unknown) =>{  send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) }) },
      ).catch(failTransport)
      return
    }
    void stop()
  })
  process.once('disconnect', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (process.send !== undefined) process.send({ type: 'fatal', message } satisfies DesktopHostEvent)
    else process.stderr.write(`dsh desktop: ${message}\n`)
    process.exitCode = 1
  })
}
