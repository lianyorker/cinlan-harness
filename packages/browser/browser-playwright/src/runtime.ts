/** Host-owned pinned Chromium installation; Remote observers never own task lifetime. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { runtimeMetadata, systemExecutable } from './runtime-metadata.ts'
import type { BrowserPreferences, BrowserRuntimeStatus, BrowserRuntimeTask, BrowserRuntimeTaskId } from './types.ts'

/** Installation storage and subprocess bounds; independent of browser activation. */
export interface Config {
  /** Application-private binary storage, separate from persistent browser profiles. */
  readonly storageDir?: string
  /** Maximum installer duration in milliseconds. */
  readonly installTimeoutMs?: number
  /** Process-range termination grace in milliseconds. */
  readonly processGraceMs?: number
  /** Bounded installer output retained only to derive numeric progress. */
  readonly maxOutputBytes?: number
}
interface ProviderSelection {
  readonly channel: BrowserPreferences['browserChannel']
  readonly executablePath?: string | undefined
  readonly state: () => BrowserRuntimeStatus['browserState']
  readonly close?: () => Promise<void>
}
interface Operation { value: BrowserRuntimeTask; abort: AbortController; done: Promise<void>; progress: (() => number | null) | null }

declare module '@deepseek-ai/cordis' {
  interface Context { /** Native browser binary management independent from provider activation. */ browserRuntime: BrowserRuntimeManager }
}
function fileExists(path: string | undefined): boolean {
  if (!path) return false
  try { return statSync(path).isFile() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Own one installer task and provider selection per Host. */
export default class BrowserRuntimeManager extends Service {
  static inject = ['subprocess']
  static Config: z<Config> = z.object({
    storageDir: z.string().default(dshHomePath('browser', 'runtime')),
    installTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(600_000),
    processGraceMs: z.number().step(1).min(1).max(60_000).default(3_000),
    maxOutputBytes: z.number().step(1).min(1024).max(1024 * 1024).default(16_384),
  })
  private readonly config: Required<Config>
  private selection: ProviderSelection | undefined
  private operation: Operation | undefined
  private disposed = false

  /** @param ctx - Host subprocess owner.
   * @param config - Private storage and installer bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserRuntime')
    const resolved = BrowserRuntimeManager.Config(config) as Required<Config>
    this.config = { ...resolved, storageDir: resolve(resolved.storageDir) }
    ctx.effect(() => async () => {
      this.disposed = true
      this.operation?.abort.abort()
      await this.operation?.done
    })
  }

  /** Publish the active provider selection without adding an activation flag.
   * @param selection - Provider-owned configuration and live context observation.
   * @returns Disposer tied to the provider fiber.
   */
  attach(selection: ProviderSelection): () => void {
    if (this.selection) throw new Error('Native browser provider is already attached')
    this.selection = selection
    return () => { if (this.selection === selection) this.selection = undefined }
  }

  /** Reserve shared runtime storage for a live browser before executable resolution.
   * @returns Async release; caller holds it until the native context has closed.
   */
  async acquireBrowserLease(): Promise<() => Promise<void>> {
    if (this.disposed || this.operation?.value.state === 'running') throw new Error('Browser runtime operation is in progress')
    await mkdir(this.config.storageDir, { recursive: true, mode: 0o700 })
    const lock = join(this.config.storageDir, 'operation.lock')
    await mkdir(lock)
    let released = false
    return async () => {
      if (released) return
      await rm(lock, { recursive: true })
      released = true
    }
  }

  /** Close the attached native context while keeping the provider active.
   * @returns Settlement after native context and runtime lease cleanup.
   */
  async closeBrowser(): Promise<void> {
    await this.selection?.close?.()
  }

  private async removeGeneration(path: string): Promise<void> {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) await unlink(path)
    else await rm(path, { recursive: true, force: true })
  }

  private activeDirectory(): string | undefined {
    const pointer = join(this.config.storageDir, 'active-' + runtimeMetadata.revision + '.json')
    if (!existsSync(pointer)) return undefined
    const value: unknown = JSON.parse(readFileSync(pointer, 'utf8'))
    if (typeof value !== 'string' || !/^generation-[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid managed browser generation')
    return join(this.config.storageDir, value)
  }

  /** Resolve the exact installed managed executable before launching.
   * @returns Managed executable or a missing-component error; never starts a process.
   */
  executablePath(): string {
    if (this.disposed || this.operation?.value.state === 'running') throw new Error('Browser runtime operation is in progress')
    const directory = this.activeDirectory()
    if (!directory
      || !fileExists(join(directory, runtimeMetadata.markerRelative))
      || !fileExists(join(directory, runtimeMetadata.executableRelative))) {
      throw new Error('Managed Chromium is missing; install the browser component in Settings')
    }
    return join(directory, runtimeMetadata.executableRelative)
  }

  /** Inspect binary files and provider state without browser launch or network requests.
   * @returns Independent installation, selection, context, and latest-task facts.
   */
  status(): BrowserRuntimeStatus {
    const directory = this.activeDirectory()
    const managedPath = directory ? join(directory, runtimeMetadata.executableRelative) : undefined
    const managedInstalled = fileExists(managedPath) && !!directory && fileExists(join(directory, runtimeMetadata.markerRelative))
    const channel = this.selection?.channel ?? 'chrome'
    const source = this.selection?.executablePath ? 'custom' : channel === 'chromium' ? 'managed' : 'system'
    const executablePath = this.selection?.executablePath ?? (channel === 'chromium' ? managedPath : systemExecutable(channel))
    return {
      providerActive: this.selection !== undefined, channel, source, executablePath: executablePath ?? null,
      installed: source === 'managed' ? managedInstalled : fileExists(executablePath), managedInstalled,
      browserState: this.selection?.state() ?? 'stopped', playwrightVersion: runtimeMetadata.playwrightVersion,
      browserVersion: runtimeMetadata.browserVersion, revision: runtimeMetadata.revision,
      downloadOrigins: runtimeMetadata.downloadOrigins, task: this.task(),
    }
  }

  /** Read the latest task without consuming installer output.
   * @returns Latest task or null before the first operation.
   */
  task(): BrowserRuntimeTask | null {
    const operation = this.operation
    if (!operation) return null
    return { ...operation.value, progressPercent: operation.progress?.() ?? operation.value.progressPercent }
  }

  /** Admit an explicit component operation; caller detach does not abort it.
   * @param operation - Install the pin, reinstall into a new generation, or remove managed binaries.
   * @returns Exact task identity for observation and cancellation.
   */
  start(operation: BrowserRuntimeTask['operation']): BrowserRuntimeTask {
    if (this.disposed) throw new Error('Browser runtime is disposed')
    if (this.operation?.value.state === 'running') throw new Error('Browser runtime operation is in progress')
    if ((this.selection?.state() ?? 'stopped') !== 'stopped') throw new Error('Close the native browser before managing its component')
    const task: Operation = {
      value: { taskId: randomUUID() as BrowserRuntimeTaskId, operation, state: 'running', phase: 'preparing', progressPercent: null, errorCode: null },
      abort: new AbortController(), done: Promise.resolve(), progress: null,
    }
    this.operation = task
    task.done = this.run(task)
    return { ...task.value }
  }

  /** Cancel only the named operation and await process-range and staging cleanup.
   * @param taskId - Exact latest operation identity.
   * @returns Its terminal snapshot; committing operations cannot be cancelled.
   */
  async cancel(taskId: BrowserRuntimeTaskId): Promise<BrowserRuntimeTask> {
    const task = this.operation
    if (!task || task.value.taskId !== taskId) throw new Error('Browser runtime task does not match')
    if (task.value.phase === 'committing') throw new Error('Browser runtime commit cannot be cancelled')
    task.abort.abort()
    await task.done
    return { ...task.value }
  }

  private async run(task: Operation): Promise<void> {
    const root = this.config.storageDir
    const lock = join(root, 'operation.lock')
    let locked = false
    let staging: string | undefined
    let pointerTemp: string | undefined
    const timeout = new Error('Installer deadline elapsed')
    const timer = setTimeout(() =>{  task.abort.abort(timeout) }, this.config.installTimeoutMs)
    let terminal: Partial<BrowserRuntimeTask> = { state: 'succeeded', phase: 'complete', progressPercent: 100 }
    const update = (value: Partial<BrowserRuntimeTask>) => { task.value = { ...task.value, ...value } }
    try {
      await mkdir(root, { recursive: true, mode: 0o700 })
      await mkdir(lock)
      locked = true
      task.abort.signal.throwIfAborted()
      const pointer = join(root, 'active-' + runtimeMetadata.revision + '.json')
      if (task.value.operation === 'remove') {
        update({ phase: 'committing' })
        await rm(pointer, { force: true })
        for (const name of await readdir(root)) {
          if (/^generation-[a-zA-Z0-9_-]+$/.test(name)) await this.removeGeneration(join(root, name))
        }
      } else if (task.value.operation === 'install' && this.status().managedInstalled) {
        update({ phase: 'complete' })
      } else {
        staging = await mkdtemp(join(root, 'generation-'))
        task.abort.signal.throwIfAborted()
        update({ phase: 'downloading' })
        const child = this.ctx.subprocess.spawn({
          argv: [process.execPath, runtimeMetadata.cliPath, 'install', 'chromium', '--no-shell'], cwd: staging,
          env: { PLAYWRIGHT_BROWSERS_PATH: staging, PLAYWRIGHT_SKIP_BROWSER_GC: '1', PLAYWRIGHT_DOWNLOAD_NO_PROGRESS: undefined, CI: '1', NODE_OPTIONS: undefined },
          stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxOutputBytes }, stderr: { maxBytes: this.config.maxOutputBytes } },
          graceMs: this.config.processGraceMs, signal: task.abort.signal,
        })
        task.progress = () => {
          const text = child.collected.stdout?.readFrom(0).text ?? ''
          const matches = [...text.matchAll(/([0-9]{1,3})%/g)]
          const last = matches.at(-1)
          return last ? Math.min(100, Number(last[1])) : null
        }
        try {
          const outcome = await child.done
          task.abort.signal.throwIfAborted()
          if (outcome.exitCode !== 0 || outcome.signal !== null) throw new Error('Playwright installer failed')
        } finally {
          child.terminate()
          await child.waitForExit()
          task.progress = null
        }
        if (!fileExists(join(staging, runtimeMetadata.executableRelative)) || !fileExists(join(staging, runtimeMetadata.markerRelative))) throw new Error('Playwright installation is incomplete')
        task.abort.signal.throwIfAborted()
        update({ phase: 'committing' })
        pointerTemp = join(root, task.value.taskId + '.json')
        await writeFile(pointerTemp, JSON.stringify(basename(staging)), { flag: 'wx', mode: 0o600 })
        await rename(pointerTemp, pointer)
        pointerTemp = undefined
        staging = undefined
        // Old generations remain usable until pointer commit; removal is an explicit separate operation.
      }
    } catch {
      const cancelled = task.abort.signal.aborted && task.abort.signal.reason !== timeout
      terminal = { state: cancelled ? 'cancelled' : 'failed', errorCode: cancelled ? null : task.value.phase === 'downloading' ? 'download-failed' : 'filesystem-failed', phase: 'complete' }
    } finally {
      clearTimeout(timer)
      try {
        if (staging) await this.removeGeneration(staging)
        if (pointerTemp) await rm(pointerTemp, { force: true })
      } catch { terminal = { state: 'failed', phase: 'complete', errorCode: 'filesystem-failed' } }
      if (locked) {
        try { await rm(lock, { recursive: true }) } catch { terminal = { state: 'failed', phase: 'complete', errorCode: 'filesystem-failed' } }
      }
      update(terminal)
    }
  }
}
