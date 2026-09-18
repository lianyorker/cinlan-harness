/** Accepted preference effects and exact app-window ownership, independent of React. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceTerminalContext } from '@deepseek-ai/dsh-sidebar-terminals/types'
import type { FloatingWorkspaceSettings } from '../types.ts'
import type { FloatingActions, FloatingSnapshot, FloatingWindowPhase } from './contract.ts'
import type { FloatingWindowEnvironment, OwnedAppWindow } from './window-environment.ts'

/** Owns at most one app window and applies only accepted durable settings. */
export class FloatingRuntime implements FloatingActions {
  private snapshot: FloatingSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Set<Promise<void>>()
  private readonly offSettings: () => void
  private readonly offExit: () => void
  private owned: OwnedAppWindow | undefined
  private offClosed: (() => void) | undefined
  private restoreFocus: (() => void) | undefined
  private disposed = false

  /**
   * @param scope - feature-owned accepted settings mirror.
   * @param environment - exact renderer's app-window operations.
   */
  constructor(private readonly scope: SettingsScope<FloatingWorkspaceSettings>, private readonly environment: FloatingWindowEnvironment) {
    this.snapshot = {
      settings: scope.getSnapshot(), phase: environment.supported ? environment.child ? 'open' : 'closed' : 'unavailable',
      child: environment.child, writeFailed: false, writing: false, targetUnavailable: false, directorySupported: false,
    }
    const acceptPreferences = () => {
      this.publish({ settings: scope.getSnapshot() })
      if (this.snapshot.settings.status === 'ready' && this.snapshot.settings.value?.enabled === false) {
        if (environment.child) environment.closeSelf()
        else this.close()
      }
    }
    this.offSettings = scope.subscribe(acceptPreferences)
    this.offExit = environment.onPageExit(() => { this.close(false) })
    acceptPreferences()
  }

  /** @returns identical snapshot until an accepted preference or window transition. */
  getSnapshot = (): FloatingSnapshot => this.snapshot
  /**
   * Observe window and accepted preference facts.
   * @param listener - framework subscriber.
   * @returns disposer for that subscription.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @returns whether accepted preferences and the platform permit the main-window command. */
  available = (): boolean => this.enabledPreferences() !== undefined

  /**
   * Apply one explicit preference through the canonical revisioned mutation owner.
   * @param key - owned preference key; the unsupported directory cannot be changed here.
   * @param value - requested schema-valid scalar.
   * @returns settlement after accepted-state confirmation or a published failure.
   */
  set = <K extends keyof FloatingWorkspaceSettings>(key: K, value: FloatingWorkspaceSettings[K]): Promise<void> => {
    if (this.disposed || this.snapshot.writing) return Promise.resolve()
    const state = this.scope.getSnapshot()
    if ((key === 'terminalDirectory' && !this.snapshot.directorySupported) || state.status !== 'ready' || !state.writable) {
      this.publish({ writeFailed: true })
      return Promise.resolve()
    }
    if (state.value?.[key] === value) return Promise.resolve()
    this.publish({ writing: true, writeFailed: false })
    const operation = this.write(key, value)
    this.pending.add(operation)
    void operation.then(() => { this.pending.delete(operation) })
    return operation
  }

  /** Open synchronously within a user gesture, or close this exact owner's existing window. */
  toggle = (): void => {
    if (this.environment.child) { this.close(); return }
    if (!this.available()) return
    if (this.owned !== undefined && !this.owned.closed) { this.close(); return }
    this.close(false)
    const prefs = this.enabledPreferences()
    if (prefs === undefined) return
    this.restoreFocus = this.environment.captureFocus()
    let target: OwnedAppWindow | null
    try { target = this.environment.open(prefs.floatDefaultWidth, prefs.floatDefaultHeight) }
    catch { this.phase('unavailable'); return }
    if (target === null) { this.phase('blocked'); return }
    this.owned = target
    this.offClosed = this.environment.observeClosed(target, () => {
      if (this.owned === target) this.close()
    })
    this.phase('open')
  }

  /**
   * Release only this activation's window and its close observer.
   * @param focus - whether a live originating element should regain focus.
   */
  close = (focus = true): void => {
    if (this.environment.child) { this.environment.closeSelf(); return }
    const target = this.owned
    this.owned = undefined
    this.offClosed?.(); this.offClosed = undefined
    if (target !== undefined && !target.closed) target.close()
    const restore = this.restoreFocus
    this.restoreFocus = undefined
    this.phase(this.environment.supported ? 'closed' : 'unavailable')
    if (focus && target !== undefined) restore?.()
  }

  /**
   * Publish the actual terminal consumer's lifecycle.
   * @param supported - whether the installed renderer consumes the preference for new terminals.
   */
  setDirectorySupported(supported: boolean): void { this.publish({ directorySupported: supported }) }

  /** @returns validated window identity immediately, then accepted directory facts once preferences are ready. */
  terminalContext = (): FloatingWorkspaceTerminalContext | undefined => {
    if (this.disposed) return undefined
    const windowId = this.environment.readWindowId()
    if (windowId === undefined) return undefined
    const settings = this.snapshot.settings
    if (settings.status === 'ready' && settings.value?.enabled === true) {
      return { windowId, status: 'ready', directory: settings.value.terminalDirectory }
    }
    return { windowId, status: settings.status === 'loading' ? 'loading' : 'unavailable' }
  }

  /**
   * Report the result of initial catalog navigation.
   * @param unavailable - whether the requested initial Session is absent from the accepted catalog.
   */
  setTargetUnavailable(unavailable: boolean): void { this.publish({ targetUnavailable: unavailable }) }

  /**
   * Close the owned window, remove observations, and silence subscribers.
   * @returns settlement after outstanding preference mutations finish.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.offSettings(); this.offExit()
    this.close(false)
    this.listeners.clear()
    await Promise.allSettled(this.pending)
  }

  private async write<K extends keyof FloatingWorkspaceSettings>(key: K, value: FloatingWorkspaceSettings[K]): Promise<void> {
    let accepted = false
    try { accepted = await this.scope.mutate([{ op: 'set', path: [key], value }]) }
    catch { /* The settings owner recovers latest state; the localized failure contains no Host details. */ }
    const state = this.scope.getSnapshot()
    const raw = state.user
    const confirmed = accepted && state.value?.[key] === value
      && typeof raw === 'object' && raw !== null && Object.hasOwn(raw, key) && Reflect.get(raw, key) === value
    this.publish({ settings: state, writing: false, writeFailed: !confirmed })
  }
  private enabledPreferences(): FloatingWorkspaceSettings | undefined {
    if (this.disposed || this.environment.child || !this.environment.supported || this.snapshot.settings.status !== 'ready') return undefined
    return this.snapshot.settings.value?.enabled === true ? this.snapshot.settings.value : undefined
  }
  private phase(phase: FloatingWindowPhase): void { this.publish({ phase }) }
  private publish(patch: Partial<FloatingSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    notifySubscribers(this.listeners, '[floating-workspace]')
  }
}
