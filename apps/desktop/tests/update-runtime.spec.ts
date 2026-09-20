import type { BrowserWindow, MessageBoxReturnValue } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { UpdateDialogOptions } from '../src/update-dialog.ts'
import type { MandatoryUpdateWindowOptions } from '../src/mandatory-update-window.ts'
import type { DesktopPolicyLoginResult } from '../src/policy-test-auth.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn<() => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>>(),
    downloadUpdate: vi.fn<() => Promise<string[]>>(), quitAndInstall: vi.fn(),
  })
  class Dialog {
    readonly views: UpdateDialogOptions[] = []
    active: { options: UpdateDialogOptions; finish: (response: number) => void } | undefined
    readonly focus = vi.fn()
    constructor() { state.dialog = this }
    show(_parent: BrowserWindow, options: UpdateDialogOptions): Promise<MessageBoxReturnValue> {
      this.cancel()
      this.views.push(options)
      return new Promise((resolve) => {
        const abort = (): void => { this.cancel() }
        this.active = { options, finish: (response) => {
          this.active = undefined
          options.signal?.removeEventListener('abort', abort)
          resolve({ response, checkboxChecked: false })
        } }
        options.signal?.addEventListener('abort', abort, { once: true })
      })
    }
    cancel(): void { this.active?.finish(this.active.options.cancelId ?? 0) }
    dispose(): void { this.cancel() }
  }
  class Mandatory {
    readonly confirmationWindow = undefined
    readonly sync = vi.fn()
    readonly focus = vi.fn()
    readonly confirm = vi.fn(async (_version: string, _active: boolean) => false)
    readonly preparingRestart = vi.fn()
    readonly dispose = vi.fn()
    constructor(readonly options: MandatoryUpdateWindowOptions) { state.mandatory = this }
  }
  class Auth {
    readonly pending = Promise.withResolvers<DesktopPolicyLoginResult>()
    readonly focus = vi.fn()
    readonly login = vi.fn(() => this.pending.promise)
    readonly request: typeof fetch = (...args) => state.request(...args)
    readonly dispose = vi.fn(async () => { this.pending.resolve('cancelled'); await state.authCleanup })
    constructor() { state.auth = this }
  }
  const state = {
    updater, Dialog, Mandatory, Auth,
    config: undefined as unknown, dialog: undefined as Dialog | undefined,
    mandatory: undefined as Mandatory | undefined, auth: undefined as Auth | undefined,
    request: vi.fn<typeof fetch>(), authCleanup: Promise.resolve(),
  }
  return state
})

vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '1.0.0', getAppPath: () => '/runtime' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: native.updater } }))
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, existsSync: (path: import('node:fs').PathLike) => String(path).endsWith('app-update.yml') || fs.existsSync(path) }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: async (path: Parameters<typeof fs.readFile>[0], options: Parameters<typeof fs.readFile>[1]) => {
    if (typeof path === 'string' && path.replaceAll('\\', '/') === '/runtime/package.json') {
      return JSON.stringify({ dshDesktopAppId: 'com.cinlan.harness', dshMandatoryUpdatePolicy: native.config })
    }
    return fs.readFile(path, options)
  } }
})
vi.mock('../src/update-dialog.ts', () => ({ DesktopUpdateDialog: native.Dialog }))
vi.mock('../src/mandatory-update-window.ts', () => ({ DesktopMandatoryUpdateWindow: native.Mandatory }))
vi.mock('../src/policy-test-auth.ts', () => ({ DesktopPolicyTestAuth: native.Auth }))

const { DesktopUpdateRuntime } = await import('../src/update-runtime.ts')
const messages = resolveDesktopLocale('en').messages
const runtimes: InstanceType<typeof DesktopUpdateRuntime>[] = []
const processFields = new Map(['platform', 'arch', 'resourcesPath'].map(key => [key, Object.getOwnPropertyDescriptor(process, key)]))

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function noForce(): Response { return response({ code: 0, data: { biz_code: 0, biz_data: null } }) }
function force(): Response { return response({ code: 40005, data: { show_content: { title: 'Required' } } }) }
function authenticationRequired(): Response { return response({ error: { code: 'UNAUTHENTICATED' } }, 401) }
function configurePolicy(authentication: 'anonymous' | 'feishu-test' = 'anonymous', intervalMs = 600_000): void {
  native.config = { origin: 'https://policy.example.com', allowedPageOrigins: ['https://downloads.example.com'],
    authentication, intervalMs, maxBackoffMs: Math.max(intervalMs, 600_000), jitter: 0 }
}

beforeEach(() => {
  for (const [key, value] of Object.entries({ platform: 'win32', arch: 'x64', resourcesPath: '/runtime/resources' })) {
    Object.defineProperty(process, key, { configurable: true, value })
  }
  vi.stubEnv('DSH_DESKTOP_UPDATE_JOURNAL_DIR', undefined)
  vi.stubEnv('DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS', '1000')
  vi.stubEnv('DSH_DESKTOP_UPDATE_CHECK_MAX_BACKOFF_MS', '1000')
  vi.stubEnv('DSH_DESKTOP_UPDATE_CHECK_JITTER', '0')
  vi.stubEnv('DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS', '1000')
  native.config = undefined
  native.dialog = undefined
  native.mandatory = undefined
  native.auth = undefined
  native.authCleanup = Promise.resolve()
  native.updater.checkForUpdates.mockReset().mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '1.1.0' } })
  native.updater.downloadUpdate.mockReset().mockImplementation(async () => {
    native.updater.emit('download-progress', { percent: 100 })
    native.updater.emit('update-downloaded', { version: '1.1.0' })
    return ['verified-package']
  })
  native.updater.quitAndInstall.mockReset()
  native.request.mockReset().mockImplementation(async () => noForce())
  vi.stubGlobal('fetch', native.request)
})

afterEach(async () => {
  try { await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose())) }
  finally {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    for (const [key, descriptor] of processFields) {
      if (descriptor === undefined) Reflect.deleteProperty(process, key)
      else Object.defineProperty(process, key, descriptor)
    }
  }
})

function fixture(bundledVersion = async () => '1.0.0') {
  const publish = vi.fn()
  const policyChanged = vi.fn()
  const stopped = vi.fn()
  let active = false
  const beforeRestart = vi.fn(async () => {
    const approved = await runtime.confirm(runtime.state.version!, active)
    if (approved) stopped()
    return approved
  })
  const runtime = new DesktopUpdateRuntime({
    locale: resolveDesktopLocale('en'), window: () => ({ isDestroyed: () => false } as BrowserWindow),
    publish, beforeRestart, policyChanged, bundledVersion,
  })
  runtimes.push(runtime)
  return { runtime, publish, policyChanged, beforeRestart, stopped, active: () => { active = true } }
}

async function dialog(message: string): Promise<UpdateDialogOptions> {
  await vi.waitFor(() =>{  expect(native.dialog?.active?.options.message).toBe(message) })
  return native.dialog!.active!.options
}
function choose(index: number): void {
  expect(native.dialog?.active).toBeDefined()
  native.dialog!.active!.finish(index)
}

it('joins launch, focus, and periodic metadata checks without downloading or interrupting work', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const checked = Promise.withResolvers<{ isUpdateAvailable: boolean; updateInfo: { version: string } }>()
  native.updater.checkForUpdates.mockReturnValueOnce(checked.promise)
  await f.runtime.start()
  f.runtime.automaticCheck()
  f.runtime.automaticCheck()
  try {
    await vi.waitFor(() =>{  expect(native.updater.checkForUpdates).toHaveBeenCalledOnce() })
  } finally { checked.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.1.0' } }) }
  await vi.waitFor(() =>{  expect(f.runtime.state.phase).toBe('available') })
  await vi.advanceTimersByTimeAsync(1000)
  expect(native.updater.checkForUpdates).toHaveBeenCalledTimes(2)
  expect(native.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(f.beforeRestart).not.toHaveBeenCalled()
  expect(native.dialog!.views).toEqual([])
})

it('joins manual prompts, binds download approval to the shown version, and separately confirms installation', async () => {
  const f = fixture()
  const first = f.runtime.open(true)
  expect(f.runtime.open(true)).toBe(first)
  const available = await dialog(messages.updateAvailable)
  expect(available.detail).toContain('1.1.0')
  expect(native.updater.downloadUpdate).not.toHaveBeenCalled()
  choose(0)
  await dialog('DeepSeek Harness v1.1.0 downloaded')
  expect(await f.runtime.confirm('1.0.9', false)).toBe(false)
  expect(native.dialog!.active!.options.message).toBe('DeepSeek Harness v1.1.0 downloaded')
  expect(native.updater.downloadUpdate).toHaveBeenCalledOnce()
  expect(f.stopped).not.toHaveBeenCalled()
  expect(native.updater.quitAndInstall).not.toHaveBeenCalled()
  choose(1)
  await first
  expect(f.runtime.state).toEqual({ phase: 'ready', version: '1.1.0' })
  f.active()
  const retry = f.runtime.open()
  const confirmation = await dialog(messages.updateActiveTasks)
  expect(confirmation.buttons).toEqual([messages.updateStopTasks, messages.updateLater])
  choose(0)
  await retry
  expect(f.stopped).toHaveBeenCalledOnce()
  expect(native.updater.downloadUpdate).toHaveBeenCalledOnce()
  expect(native.updater.quitAndInstall).toHaveBeenCalledWith(true, true)
})

it('rejects a download approval after a periodic check replaces its candidate', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const pending = f.runtime.open(true)
  await dialog(messages.updateAvailable)
  native.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '1.2.0' } })
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.runtime.state.version).toBe('1.2.0')
  choose(0)
  await dialog(messages.updateDownloadFailed)
  choose(0)
  await pending
  expect(native.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(f.stopped).not.toHaveBeenCalled()
})

it('preempts ordinary installation consent on mandatory policy arrival and requires a fresh modal consent', async () => {
  configurePolicy()
  const f = fixture()
  await f.runtime.start()
  await vi.waitFor(() =>{  expect(f.runtime.state.phase).toBe('available') })
  const pending = f.runtime.open()
  await dialog('DeepSeek Harness v1.1.0 downloaded')
  native.request.mockImplementation(async () => force())
  await native.mandatory!.options.refresh()
  await pending
  expect(f.runtime.blocking).toBe(true)
  expect(f.policyChanged).toHaveBeenLastCalledWith(true)
  expect(f.stopped).not.toHaveBeenCalled()
  expect(native.updater.quitAndInstall).not.toHaveBeenCalled()
  native.mandatory!.confirm.mockResolvedValueOnce(true)
  await native.mandatory!.options.install('1.1.0')
  expect(native.mandatory!.confirm).toHaveBeenCalledWith('1.1.0', false)
  expect(native.updater.quitAndInstall).toHaveBeenCalledOnce()
})

it('cancels download consent when policy becomes mandatory without starting a transfer', async () => {
  configurePolicy()
  const f = fixture()
  await f.runtime.start()
  const pending = f.runtime.open(true)
  await dialog(messages.updateAvailable)
  native.request.mockImplementation(async () => force())
  await native.mandatory!.options.refresh()
  await pending
  expect(f.runtime.blocking).toBe(true)
  expect(native.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(f.beforeRestart).not.toHaveBeenCalled()
})

it('coalesces login consent and sign-in callers, then evaluates fresh policy without downloading', async () => {
  configurePolicy('feishu-test')
  native.request.mockImplementation(async () => authenticationRequired())
  native.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } })
  const f = fixture()
  await f.runtime.start()
  await dialog(messages.policyLoginRequired)
  expect(native.auth!.login).not.toHaveBeenCalled()
  const first = f.runtime.open(true)
  expect(f.runtime.open(true)).toBe(first)
  choose(0)
  await vi.waitFor(() =>{  expect(native.auth!.login).toHaveBeenCalledOnce() })
  expect(f.runtime.open(true)).toBe(first)
  native.request.mockImplementation(async () => noForce())
  native.auth!.pending.resolve('returned')
  await dialog('No updates available. Current version: V1.0.0')
  choose(0)
  await first
  expect(native.dialog!.views.filter(view => view.message === messages.policyLoginRequired)).toHaveLength(1)
  expect(native.auth!.login).toHaveBeenCalledOnce()
  expect(native.request.mock.calls.some(([url]) => (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes('scenario=login-return'))).toBe(true)
  expect(native.updater.downloadUpdate).not.toHaveBeenCalled()
})

it('does not open sign-in when its consent is dismissed', async () => {
  configurePolicy('feishu-test', 1000)
  native.request.mockImplementation(async () => authenticationRequired())
  vi.useFakeTimers()
  const f = fixture()
  await f.runtime.start()
  await dialog(messages.policyLoginRequired)
  choose(1)
  await f.runtime.dispose()
  expect(native.auth!.login).not.toHaveBeenCalled()
})

it('closes an active login immediately while aborted policy work and Session cleanup settle', async () => {
  vi.useFakeTimers()
  configurePolicy('feishu-test', 1000)
  native.request.mockImplementation(async () => authenticationRequired())
  const f = fixture()
  await f.runtime.start()
  await dialog(messages.policyLoginRequired)
  choose(0)
  await vi.waitFor(() =>{  expect(native.auth!.login).toHaveBeenCalledOnce() })
  const pendingResponse = Promise.withResolvers<Response>()
  const cleanup = Promise.withResolvers<undefined>()
  native.authCleanup = cleanup.promise
  let signal: AbortSignal | null | undefined
  native.request.mockImplementationOnce((_url, init) => { signal = init?.signal; return pendingResponse.promise })
  try {
    await vi.advanceTimersByTimeAsync(2000)
    expect(signal).toBeDefined()
    const opening = f.runtime.open(true)
    const disposal = f.runtime.dispose()
    let disposed = false
    void disposal.then(() => { disposed = true })
    expect(signal!.aborted).toBe(true)
    expect(native.auth!.dispose).toHaveBeenCalledOnce()
    expect(f.runtime.dispose()).toBe(disposal)
    await expect(opening).resolves.toBeUndefined()
    expect(disposed).toBe(false)
  } finally {
    pendingResponse.resolve(noForce())
    cleanup.resolve(undefined)
    await f.runtime.dispose()
  }
  const published = f.publish.mock.calls.length
  await vi.advanceTimersByTimeAsync(600_000)
  expect(f.publish).toHaveBeenCalledTimes(published)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not create policy or login owners after shutdown during release identity resolution', async () => {
  configurePolicy('feishu-test')
  const identity = Promise.withResolvers<string>()
  const f = fixture(() => identity.promise)
  const starting = f.runtime.start()
  await f.runtime.dispose()
  identity.resolve('1.0.0')
  await starting
  expect(native.auth).toBeUndefined()
  expect(native.request).not.toHaveBeenCalled()
  expect(native.updater.checkForUpdates).not.toHaveBeenCalled()
})
