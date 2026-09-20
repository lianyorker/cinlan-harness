/** Host-owned Android component installation and explicit human mirror sessions. */
import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-mobile-device'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { Config as ConfigSchema, resolveConfig } from './config.ts'
import { catalog } from './catalog.ts'
import { downloadArchive } from './download.ts'
import { extractArchive } from './archive.ts'
import { MobileResourceStore } from './store.ts'
import { probe } from './process.ts'
import type { Config, MobileConnectedDevice, MobileExecutableLease, MobileMirrorId, MobileMirrorStatus, MobileResourceRequest, MobileResourceTask, MobileResourceTaskId, MobileRuntimeStatus } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { /** Host-owned native Android resource and mirror lifecycle. */ mobileRuntime: MobileRuntimeManager }
}
interface Task { value: MobileResourceTask; abort: AbortController; done: Promise<void> }
interface Mirror { value: MobileMirrorStatus; abort: AbortController; done: Promise<void> }

/** Own private installed tools separately from Provider activation and custom SDK installations. */
export default class MobileRuntimeManager extends Service {
  static inject = ['subprocess']
  static Config = ConfigSchema
  private readonly config: Required<Config>
  private readonly store: MobileResourceStore
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private task: Task | undefined
  private mirror: Mirror | undefined
  private disposed = false
  /** @param ctx - Host subprocess owner; settings and model Provider are optional.
   * @param config - Private storage, explicit proxy, and lifecycle bounds.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mobileRuntime')
    this.config = resolveConfig(config)
    this.store = new MobileResourceStore(this.config.storageDir, this.config.lockWaitMs)
    ctx.effect(() => async () => {
      this.disposed = true; this.lifetime.abort(); this.task?.abort.abort(); this.mirror?.abort.abort()
      await Promise.allSettled([...this.pending, this.task?.done, this.mirror?.done])
    })
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Mobile runtime is disposed'))
    const task = operation(); this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }
  private sdkPath(): string { return this.ctx.get('mobileDevice')?.getPreferences().androidSdkPath ?? '' }
  /** Pin the selected executable and immutable managed bytes for a complete operation.
   * @param selection - Explicit deployment command and saved SDK path; custom choices take precedence.
   * @param signal - Cancellation while acquiring the selection.
   * @returns Executable and release callback held through subprocess and device-file cleanup.
   */
  async acquireAdb(selection: { command?: string; sdkPath?: string }, signal: AbortSignal): Promise<MobileExecutableLease> {
    signal.throwIfAborted()
    if (this.disposed) throw new Error('Mobile runtime is disposed')
    if (selection.command) return { executable: selection.command, release: async () => {} }
    const sdk = selection.sdkPath ?? this.sdkPath()
    if (sdk) {
      if (!isAbsolute(sdk) || sdk.trim() !== sdk || /[\r\n\u0000]/.test(sdk)) throw new Error('Android SDK path must be absolute')
      const adb = process.platform === 'win32' ? 'adb.exe' : 'adb'
      const leaf = basename(sdk).toLowerCase()
      return { executable: leaf === adb ? sdk : leaf === 'platform-tools' ? join(sdk, adb) : join(sdk, 'platform-tools', adb), release: async () => {} }
    }
    const status = await this.store.inspect(catalog['platform-tools'], signal)
    if (status.integrity === 'invalid') throw new Error('Managed Android tools failed verification')
    if (status.installedPath) return this.store.acquire(catalog['platform-tools'], signal)
    return { executable: 'adb', release: async () => {} }
  }
  private async devices(executable: string, signal: AbortSignal): Promise<MobileConnectedDevice[]> {
    const text = await probe(this.ctx, this.config, executable, ['devices', '-l'], signal)
    const lines = text.replace(/\r\n/g, '\n').trim().split('\n')
    if (lines.shift() !== 'List of devices attached') throw new Error('Invalid Android device inventory')
    const serials = new Set<string>(); const transports = new Set<string>()
    return lines.filter(Boolean).map((line) => {
      const fields = line.trim().split(/\s+/); const serial = fields.shift() ?? ''; const state = fields.shift() ?? ''
      if (!/^[A-Za-z0-9_.:-]+$/.test(serial) || serial.startsWith('-') || serials.has(serial)) throw new Error('Invalid Android device identity')
      serials.add(serial)
      const ids = fields.filter(field => field.startsWith('transport_id:')).map(field => field.slice(13))
      const transportId = ids[0] ?? null
      if (ids.length > 1 || (transportId !== null && (!/^[1-9][0-9]*$/.test(transportId) || !Number.isSafeInteger(Number(transportId)) || transports.has(transportId)))) throw new Error('Invalid Android transport identity')
      if (transportId) transports.add(transportId)
      return { id: 'android:' + serial, serial, state, transportId, available: state === 'device' && transportId !== null }
    })
  }
  /** Observe resource provenance and independently probe Android executable and connections.
   * @param signal - Read cancellation; never cancels an installation or mirror.
   * @returns Managed component, process, and connection facts.
   */
  status(signal: AbortSignal): Promise<MobileRuntimeStatus> {
    return this.track(async () => {
      const bound = AbortSignal.any([signal, this.lifetime.signal])
      await mkdir(this.config.storageDir, { recursive: true, mode: 0o700 })
      const resources = await Promise.all(Object.values(catalog).map(def => this.store.inspect(def, bound)))
      const custom = this.sdkPath(); const managed = resources.find(item => item.definition.id === 'platform-tools')
      let path = custom || managed?.installedPath || 'adb'; let version: string | null = null; let error: string | null = null
      let devices: MobileConnectedDevice[] = []
      try {
        if (this.task?.value.state === 'running') throw new Error('Resource operation in progress')
        const lease = await this.acquireAdb({ sdkPath: custom }, bound)
        try { path = lease.executable; version = (await probe(this.ctx, this.config, path, ['version'], bound)).trim(); devices = await this.devices(path, bound) }
        finally { await lease.release() }
      } catch (_probeFailure) { bound.throwIfAborted(); error = 'adb-unavailable' }
      return { platform: process.platform + '-' + process.arch, resources, task: this.task?.value ?? null,
        adb: { source: custom ? 'custom' : managed?.installedPath ? 'managed' : 'path', path, version, error },
        devices, mirror: this.mirror?.value ?? null, iosSupported: false }
    })
  }
  /** Admit a Host-owned resource transaction against the displayed durable revision.
   * @param request - Fixed resource operation and explicit license acceptance.
   * @param signal - Admission cancellation; receipt ownership remains with the Host.
   * @returns Exact task receipt for observation and cancellation.
   */
  start(request: MobileResourceRequest, signal: AbortSignal): MobileResourceTask {
    signal.throwIfAborted()
    if (this.disposed || this.task?.value.state === 'running') throw new Error('Mobile resource operation is busy')
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Managed mobile resources are unsupported on this platform')
    if (request.operation !== 'remove' && !request.acceptLicense) throw new Error('Accept the upstream resource license before installation')
    const definition = catalog[request.resourceId]
    const task: Task = { value: { id: randomUUID() as MobileResourceTaskId, resourceId: request.resourceId, operation: request.operation,
      state: 'running', phase: 'preparing', downloadedBytes: 0, totalBytes: definition.bytes, error: null }, abort: new AbortController(), done: Promise.resolve() }
    this.task = task
    task.done = this.install(task, request)
    return task.value
  }
  private async install(task: Task, request: MobileResourceRequest): Promise<void> {
    const bound = deadline(AbortSignal.any([task.abort.signal, this.lifetime.signal]), this.config.installTimeoutMs, 'Mobile installation timed out')
    let stage: string | undefined; let transport: string | undefined
    let terminal: Partial<MobileResourceTask> = { state: 'succeeded', phase: 'complete' }
    const set = (patch: Partial<MobileResourceTask>): void => { task.value = { ...task.value, ...patch } }
    try {
      const definition = catalog[request.resourceId]
      const before = await this.store.inspect(definition, bound.signal)
      if (before.revision !== request.expectedRevision) throw new Error('Mobile resource revision changed; refresh before retrying')
      if (request.operation === 'install' && before.installedPath) throw new Error('Mobile resource is already installed')
      if (request.operation === 'update' && !before.updateAvailable) throw new Error('No reviewed mobile resource update is available')
      if (before.leased) throw new Error('Mobile resource is in use')
      if (request.operation === 'remove') {
        set({ phase: 'committing' }); await this.store.remove(definition, request.expectedRevision, bound.signal)
      } else {
        stage = await this.store.stage(definition, bound.signal)
        transport = await mkdtemp(join(this.config.storageDir, 'download-'))
        const archive = join(transport, 'resource.zip')
        set({ phase: 'downloading' })
        await downloadArchive(definition, archive, this.config.downloadProxyUrl, bound.signal,
          (bytes) => { set({ downloadedBytes: bytes }) })
        set({ phase: 'extracting' })
        await extractArchive(archive, stage, definition.archiveRoot,
          { maxFiles: this.config.maxArchiveFiles, maxExpandedBytes: this.config.maxExpandedBytes }, bound.signal)
        set({ phase: 'verifying' })
        const version = await probe(this.ctx, this.config, join(stage, definition.executable), definition.id === 'scrcpy' ? ['--version'] : ['version'], bound.signal)
        if (!version.includes(definition.version)) throw new Error('Installed component version differs from the reviewed release')
        set({ phase: 'committing' })
        await this.store.commit(definition, stage, request.expectedRevision, bound.signal); stage = undefined
      }
    } catch (_operationFailure) {
      terminal = { state: task.abort.signal.aborted ? 'cancelled' : 'failed', error: task.abort.signal.aborted ? null : 'Mobile resource operation failed; refresh status and retry' }
    } finally {
      const cleanup = await Promise.allSettled([stage ? this.store.cleanup(stage) : undefined,
        transport ? rm(transport, { recursive: true, force: true }) : undefined])
      if (cleanup.some(result => result.status === 'rejected')) terminal = { state: 'failed', error: 'Mobile staging cleanup failed' }
      bound[Symbol.dispose]()
      set(terminal)
    }
  }
  /** Cancel only the exact observed task before its publication phase.
   * @param taskId - Current task identity.
   * @returns Settled task after all download, extraction, and cleanup work stops.
   */
  async cancel(taskId: MobileResourceTaskId): Promise<MobileResourceTask> {
    const task = this.task
    if (!task || task.value.id !== taskId) throw new Error('Mobile resource task changed')
    if (task.value.state === 'running' && task.value.phase !== 'committing') task.abort.abort()
    await task.done; return task.value
  }
  /** Start a human-requested mirror for one currently authorized exact Android device.
   * @param deviceId - Exact identity from this manager's latest connection inventory.
   * @param signal - Admission cancellation.
   * @returns Host-owned mirror receipt; process state does not claim visual acceptance.
   */
  startMirror(deviceId: string, signal: AbortSignal): MobileMirrorStatus {
    signal.throwIfAborted()
    if (this.disposed || this.mirror?.value.state === 'running' || this.mirror?.value.state === 'starting') throw new Error('A mobile mirror is already active')
    const mirror: Mirror = { value: { id: randomUUID() as MobileMirrorId, deviceId, state: 'starting', error: null }, abort: new AbortController(), done: Promise.resolve() }
    this.mirror = mirror; mirror.done = this.runMirror(mirror); return mirror.value
  }
  private async runMirror(mirror: Mirror): Promise<void> {
    const signal = AbortSignal.any([mirror.abort.signal, this.lifetime.signal])
    let adb: MobileExecutableLease | undefined; let helper: MobileExecutableLease | undefined; let handle: SubprocessHandle | undefined
    let terminal: Pick<MobileMirrorStatus, 'state' | 'error'> = { state: 'closed', error: null }
    try {
      adb = await this.acquireAdb({}, signal); helper = await this.store.acquire(catalog.scrcpy, signal)
      const target = (await this.devices(adb.executable, signal)).find(device => device.id === mirror.value.deviceId && device.available)
      if (!target?.transportId) throw new Error('Selected Android device is unavailable or unauthorized')
      const boot = (await probe(this.ctx, this.config, adb.executable, ['-t', target.transportId, 'shell', 'cat', '/proc/sys/kernel/random/boot_id'], signal)).trim()
      signal.throwIfAborted()
      const executable = await this.ctx.subprocess.resolveExecutable(adb.executable, {}, signal)
      const current = (await this.devices(executable, signal)).find(device => device.id === target.id && device.available)
      if (current?.transportId !== target.transportId
        || (await probe(this.ctx, this.config, executable, ['-t', target.transportId, 'shell', 'cat', '/proc/sys/kernel/random/boot_id'], signal)).trim() !== boot) {
        throw new Error('Android connection changed before mirroring')
      }
      signal.throwIfAborted()
      handle = this.ctx.subprocess.spawn({ argv: [helper.executable, '--serial', target.serial, '--no-audio', '--no-control'],
        cwd: this.config.storageDir, env: { ADB: executable, SCRCPY_SERVER_PATH: join(dirname(helper.executable), 'scrcpy-server') }, signal, graceMs: this.config.processGraceMs,
        stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.maxOutputBytes }, stderr: { maxBytes: this.config.maxOutputBytes } } })
      mirror.value = { ...mirror.value, state: 'running' }
      const exited = new AbortController()
      const done = handle.done.finally(() => { exited.abort() })
      void done.catch(() => undefined)
      const observation = AbortSignal.any([signal, exited.signal])
      while (!observation.aborted) {
        try { await delay(this.config.mirrorPollMs, undefined, { signal: observation }) }
        catch (_mirrorStopped) { break }
        const current = (await this.devices(adb.executable, signal)).find(device => device.id === target.id && device.available)
        const currentBoot = (await probe(this.ctx, this.config, adb.executable, ['-t', target.transportId, 'shell', 'cat', '/proc/sys/kernel/random/boot_id'], signal)).trim()
        if (current?.transportId !== target.transportId || currentBoot !== boot) throw new Error('Android connection changed during mirroring')
      }
      const outcome = await done
      terminal = { state: outcome.exitCode === 0 || mirror.abort.signal.aborted ? 'closed' : 'failed',
        error: outcome.exitCode === 0 || mirror.abort.signal.aborted ? null : 'Mirror process failed' }
    } catch (_mirrorFailure) {
      terminal = { state: mirror.abort.signal.aborted ? 'closed' : 'failed',
        error: mirror.abort.signal.aborted ? null : 'Mobile mirror could not run for the selected device' }
    } finally {
      try { handle?.terminate(); await handle?.done.catch(() => undefined); await handle?.waitForExit() }
      catch (_rangeCleanupFailure) { terminal = { state: 'failed', error: 'Mirror process cleanup failed' } }
      const released = await Promise.allSettled([helper?.release(), adb?.release()])
      if (released.some(result => result.status === 'rejected')) terminal = { state: 'failed', error: 'Mirror resource release failed' }
      mirror.value = { ...mirror.value, ...terminal }
    }
  }
  /** Close the exact owned mirror and await native process exit before releasing resources.
   * @param mirrorId - Current mirror receipt identity.
   * @returns Settled mirror facts.
   */
  async closeMirror(mirrorId: MobileMirrorId): Promise<MobileMirrorStatus> {
    const mirror = this.mirror
    if (!mirror || mirror.value.id !== mirrorId) throw new Error('Mobile mirror identity changed')
    mirror.abort.abort(); await mirror.done; return mirror.value
  }
}
