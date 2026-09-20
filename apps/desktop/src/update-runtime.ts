/** Main-process update presentation and policy lifetime, independent of the native Host carrier. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, type BrowserWindow, type MessageBoxReturnValue } from 'electron'
import type { DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, type DesktopLocale } from './locale.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
import { DesktopUpdateSchedule, resolveDesktopUpdateScheduleConfig } from './update-schedule.ts'
import { DesktopUpdateDialog, type UpdateDialogOptions } from './update-dialog.ts'
import { DesktopMandatoryUpdateWindow } from './mandatory-update-window.ts'
import { DesktopMandatoryUpdatePolicy, resolveDesktopPolicyConfig, type DesktopPolicyState } from './mandatory-update-policy.ts'
import { DesktopPolicyTestAuth } from './policy-test-auth.ts'
import { DesktopUpdateJournal, type DesktopUpdateJournalAction } from './update-journal.ts'
import { desktopUpdateErrorSummary } from './update-presentation.ts'
import { desktopErrorState } from './startup-error.ts'

/** Native lifecycle operations remain owned by the application's existing startup and Host controller. */
export interface DesktopUpdateRuntimeOptions {
  readonly locale: DesktopLocale
  readonly window: () => BrowserWindow | undefined
  readonly publish: (state: DesktopUpdateState) => void
  readonly beforeRestart: () => Promise<boolean>
  readonly policyChanged: (blocking: boolean) => void
  readonly bundledVersion: () => Promise<string>
}

/** One updater, policy client, and set of confirmations for every Desktop entry point. */
export class DesktopUpdateRuntime {
  private readonly updates: DesktopUpdateCoordinator
  private readonly schedule: DesktopUpdateSchedule
  private readonly dialog: DesktopUpdateDialog
  private readonly journal: DesktopUpdateJournal | undefined
  private policy: DesktopMandatoryUpdatePolicy | undefined
  private mandatory: DesktopMandatoryUpdateWindow | undefined
  private auth: DesktopPolicyTestAuth | undefined
  private disposed = false
  private disposal: Promise<void> | undefined
  private prompt: Promise<void> | undefined
  private authentication: Promise<DesktopPolicyState | undefined> | undefined
  private authenticationQueued = false
  private readonly ordinaryDialogs = new Set<AbortController>()
  private readonly shownErrors = new WeakMap<DesktopUpdateState, Promise<void>>()

  /** @param options - Main-owned window, release identity, and lifecycle callbacks. */
  constructor(private readonly options: DesktopUpdateRuntimeOptions) {
    const directory = process.env.DSH_DESKTOP_UPDATE_JOURNAL_DIR
    this.journal = directory === undefined ? undefined : new DesktopUpdateJournal(directory, app.getVersion())
    this.dialog = new DesktopUpdateDialog(fileURLToPath(new URL('./preload-update-dialog.cjs', import.meta.url)), options.locale)
    this.updates = new DesktopUpdateCoordinator((state) => {
      this.journal?.state(state)
      this.mandatory?.sync()
      options.publish(state)
      if (state.phase === 'error' && state.failedOperation !== 'check') {
        void this.showFailure(state).catch((error: unknown) => { console.error(error) })
      }
      return state
    }, options.beforeRestart)
    this.schedule = new DesktopUpdateSchedule(this.updates, resolveDesktopUpdateScheduleConfig(process.env))
  }

  /** Main-owned state shared by shell and product presentation. */
  get state(): DesktopUpdateState { return this.updates.state }

  /** Whether a confirmed mandatory decision blocks product interactions. */
  get blocking(): boolean { return this.policy?.state.blocking === true }

  /** @param action - Fixed evidence milestone without user or diagnostic data. */
  record(action: DesktopUpdateJournalAction): void { this.journal?.action(action) }

  /** Read packaged policy identity and start queries after the primary window exists. */
  async start(): Promise<void> {
    const developmentInput = process.env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG
    const manifest: unknown = app.isPackaged
      ? JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8')) : {}
    if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop policy: invalid application manifest')
    const input: unknown = app.isPackaged
      ? ('dshMandatoryUpdatePolicy' in manifest ? manifest.dshMandatoryUpdatePolicy : undefined)
      : developmentInput === undefined ? undefined : JSON.parse(developmentInput) as unknown
    const config = resolveDesktopPolicyConfig(input, !app.isPackaged)
    if (config !== undefined) {
      const bundleId = app.isPackaged
        ? ('dshDesktopAppId' in manifest ? manifest.dshDesktopAppId : undefined) : process.env.DSH_DESKTOP_APP_ID
      if (typeof bundleId !== 'string' || bundleId.trim() === '') throw new Error('desktop policy: missing application bundle ID')
      if (!['win32', 'darwin'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) {
        throw new Error('desktop policy: unsupported platform')
      }
      const bundledDshVersion = await this.options.bundledVersion()
      if (this.disposed) return
      if (config.authentication === 'feishu-test') {
        this.auth = new DesktopPolicyTestAuth(config.origin, this.options.locale,
          () => this.mandatory?.confirmationWindow ?? this.options.window(), (event) =>{  this.record(
            event === 'opened' ? 'policy-login-opened' : event === 'returned' ? 'policy-login-returned'
              : event === 'cancelled' ? 'policy-login-cancelled' : 'policy-login-failed') })
      }
      let wasBlocking = false
      this.policy = new DesktopMandatoryUpdatePolicy(config, {
        platform: process.platform === 'win32' ? 'desktop-win' : 'desktop-mac', arch: process.arch as 'x64' | 'arm64',
        version: app.getVersion(), bundledDshVersion, bundleId, locale: this.options.locale.id,
      }, (state) => {
        if (state.error !== 'authentication-required') this.authenticationQueued = false
        if (state.blocking) {
          for (const controller of this.ordinaryDialogs) controller.abort()
          if (!wasBlocking) this.dialog.cancel()
        }
        this.mandatory?.sync()
        this.options.policyChanged(state.blocking)
        if (state.blocking && !wasBlocking) {
          void this.schedule.check(false, true).catch((error: unknown) => { console.error(error) })
        }
        wasBlocking = state.blocking
      }, this.auth?.request)
      const policy = this.policy
      this.mandatory = new DesktopMandatoryUpdateWindow({
        preload: fileURLToPath(new URL('./preload-mandatory.cjs', import.meta.url)), locale: this.options.locale,
        allowedPageOrigins: config.allowedPageOrigins, parent: this.options.window,
        policy: () => policy.state, update: () => this.state,
        refresh: async () => { await Promise.all([this.checkPolicy(), this.schedule.check(true)]) },
        download: version => this.download(version), install: version => this.updates.install(version),
      })
      void this.policy.check('launch').then((state) => {
        if (app.isPackaged && state.error === 'authentication-required' && !this.disposed) this.queueAuthentication()
      }).catch((error: unknown) => { console.error(error) })
    }
    if (!this.disposed) this.automaticCheck()
  }

  /** Join due checks from primary-window focus and system resume. */
  automaticCheck = (): void => {
    if (this.disposed) return
    void this.policy?.check('foreground-or-resume').catch((error: unknown) => { console.error(error) })
    void this.schedule.check().catch((error: unknown) => { console.error(error) })
  }

  /** Focus the existing mandatory decision without granting task-stop or installation permission. */
  focus(): void { this.mandatory?.focus() }

  /**
   * Confirm only a main-owned downloaded version after inspecting live tasks.
   * @param version - Prepared artifact version.
   * @param active - Whether the current Host has running or queued work.
   * @returns Explicit consent; closing, replacement, or policy arrival cancels ordinary consent.
   */
  async confirm(version: string, active: boolean): Promise<boolean> {
    if (this.disposed || this.state.version !== version) return false
    if (this.blocking) return await this.mandatory?.confirm(version, active) ?? false
    const messages = this.options.locale.messages
    const result = await this.message({ type: active ? 'warning' : 'info', title: messages.updateTitle,
      message: active ? messages.updateActiveTasks : formatDesktopMessage(messages.updateDownloadedTitle, { version }),
      detail: active ? messages.updateActiveTasksDetail : messages.updateDownloadedDetail,
      buttons: active ? [messages.updateStopTasks, messages.updateLater] : [messages.installAndRestart],
      defaultId: 1, cancelId: 1 })
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
    return result.response === 0 && !this.blocking && !this.disposed
  }

  /** @param active - Whether the accepted installation stops live tasks. */
  preparingRestart(active: boolean): void { this.mandatory?.preparingRestart(active) }

  /**
   * Open the single update flow; product clicks cannot supply a target or URL.
   * @param manual - Explicit check from the application menu or Settings.
   * @returns Settlement of the displayed flow, including cancellation and recoverable errors.
   */
  open(manual = false): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.authentication !== undefined) { this.auth?.focus(); this.dialog.focus() }
    let failedOperation: 'check' | 'download' | 'install' = 'check'
    this.prompt ??= Promise.resolve().then(async () => {
      if (manual) this.record('check-requested')
      const joinedAuthentication = this.authentication !== undefined
      if (joinedAuthentication) await this.authenticate()
      if (this.disposed) return
      if (this.blocking) {
        this.focus()
        if (manual) await Promise.all([this.checkPolicy(), this.schedule.check(true)])
        return
      }
      let state = this.state
      const messages = this.options.locale.messages
      if (manual || state.phase === 'idle' || (state.phase === 'error' && state.failedOperation === 'check')) {
        const controller = new AbortController()
        this.ordinaryDialogs.add(controller)
        const window = this.options.window()
        const progress = window === undefined ? Promise.resolve() : this.dialog.show(window, {
          type: 'info', title: messages.updateCheckTitle, message: messages.updateChecking,
          buttons: [messages.later], cancelId: 0, signal: controller.signal })
        try {
          if (!joinedAuthentication) void this.checkPolicy('deferred').catch((error: unknown) => { console.error(error) })
          state = await this.schedule.check(true)
        } finally { controller.abort(); this.ordinaryDialogs.delete(controller); await progress }
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
      if (this.disposed) return
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
      if (this.blocking) { this.focus(); return }
      if (state.phase === 'error' && state.failedOperation === 'check') { await this.showFailure(state); return }
      if (state.phase === 'idle') {
        await this.message({ type: 'info', title: messages.updateCheckTitle,
          message: formatDesktopMessage(messages.updateCurrent, { version: app.getVersion() }) })
        return
      }
      if (state.phase === 'ready' || (state.phase === 'error' && state.failedOperation === 'install')) {
        if (state.version !== undefined) { failedOperation = 'install'; await this.showFailure(await this.updates.install(state.version)) }
        return
      }
      if (state.phase !== 'available' && !(state.phase === 'error' && state.failedOperation === 'download')) return
      if (manual) {
        const result = await this.message({ title: messages.updateCheckTitle, message: messages.updateAvailable,
          detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
          buttons: [messages.updateDownload], cancelId: 1 })
        if (result.response !== 0) return
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
      if (!this.disposed && !this.blocking && state.version !== undefined) {
        failedOperation = 'download'
        await this.showFailure(await this.download(state.version))
      }
    }).catch((error: unknown) => this.showFailure({ phase: 'error', failedOperation, message: desktopErrorState(error).message }))
      .finally(() => { this.prompt = undefined; this.flushAuthentication() })
    return this.prompt
  }

  /** Close prompts and login immediately, abort policy requests, and await request and Session cleanup. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.schedule.dispose()
    for (const controller of this.ordinaryDialogs) controller.abort()
    this.dialog.dispose()
    this.mandatory?.dispose()
    this.updates.dispose()
    const policyStopped = this.policy?.dispose()
    const authenticationClosed = this.auth?.dispose()
    this.disposal = Promise.all([policyStopped, authenticationClosed, this.authentication]).then(() => {})
    return this.disposal
  }

  private async download(version: string): Promise<DesktopUpdateState> {
    this.record('download-requested')
    const state = await this.updates.download(version)
    return state.phase === 'ready' && !this.disposed ? this.updates.install(version) : state
  }

  private async message(options: UpdateDialogOptions): Promise<MessageBoxReturnValue> {
    const window = this.options.window()
    if (window === undefined || this.disposed) return { response: options.cancelId ?? 0, checkboxChecked: false }
    const controller = new AbortController()
    this.ordinaryDialogs.add(controller)
    try { return await this.dialog.show(window, { ...options, signal: controller.signal }) }
    finally { this.ordinaryDialogs.delete(controller) }
  }

  private showFailure(state: DesktopUpdateState): Promise<void> {
    if (state.phase !== 'error' || this.disposed) return Promise.resolve()
    if (this.blocking) { this.mandatory?.sync(); return Promise.resolve() }
    let shown = this.shownErrors.get(state)
    if (shown === undefined) {
      shown = this.message({ type: 'error', title: this.options.locale.messages.updateFailedTitle,
        message: desktopUpdateErrorSummary(state, this.options.locale.messages),
        technicalDetails: state.technicalDetails ?? state.message ?? '' }).then(() => {})
      this.shownErrors.set(state, shown)
    }
    return shown
  }

  private queueAuthentication(): void {
    if (this.authentication !== undefined) { this.auth?.focus(); this.dialog.focus(); return }
    this.authenticationQueued = true
    this.flushAuthentication()
  }

  private flushAuthentication(): void {
    if (!this.authenticationQueued || this.prompt !== undefined || this.authentication !== undefined
      || this.blocking || this.disposed) return
    this.authenticationQueued = false
    void this.authenticate().catch((error: unknown) => { console.error(error) })
  }

  private authenticate(): Promise<DesktopPolicyState | undefined> {
    if (this.authentication !== undefined) { this.auth?.focus(); this.dialog.focus() }
    this.authentication ??= this.runAuthentication().finally(() => { this.authentication = undefined })
    return this.authentication
  }

  private async runAuthentication(): Promise<DesktopPolicyState | undefined> {
    const parent = this.mandatory?.confirmationWindow ?? this.options.window()
    if (this.auth === undefined || this.policy === undefined || parent === undefined || this.disposed) return undefined
    const messages = this.options.locale.messages
    const consent = await this.dialog.show(parent, { type: 'info', title: messages.policyLoginTitle,
      message: messages.policyLoginRequired, buttons: [messages.policyLogin, messages.later], cancelId: 1 })
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
    if (consent.response !== 0 || this.disposed) return undefined
    const outcome = await this.auth.login()
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
    if (this.disposed || outcome === 'cancelled') return undefined
    if (outcome === 'failed') {
      await this.dialog.show(parent, { type: 'error', title: messages.policyLoginTitle,
        message: messages.policyLoginFailed, buttons: [messages.updateAcknowledge], cancelId: 0 })
      return undefined
    }
    await this.policy.check('login-return')
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Awaited work can publish policy or shutdown.
    return this.disposed ? undefined : this.policy.check('login-return', true)
  }

  private async checkPolicy(authentication: 'immediate' | 'deferred' = 'immediate'): Promise<DesktopPolicyState | undefined> {
    if (this.authentication !== undefined) return this.authenticate()
    const state = await this.policy?.check('manual', true)
    if (state?.error !== 'authentication-required') return state
    if (authentication === 'immediate') return this.authenticate()
    this.queueAuthentication()
    return state
  }
}
