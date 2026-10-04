/** Accepted preference effects and the one panel this activation owns, independent of React. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceTerminalContext, FloatingWorkspaceWindowId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import type { FloatingWorkspaceSettings } from '../types.ts'
import type { FloatingActions, FloatingSnapshot, FloatingWindowPhase } from './contract.ts'

/** Environmental facts the panel owner reads, kept out of render props. */
export interface FloatingPanelEnvironment {
  readonly supported: boolean
  /** @returns validated floating window identity, or undefined in the main window. */
  readWindowId(): FloatingWorkspaceWindowId | undefined
}

/** Owns at most one in-app panel and applies only accepted durable settings. */
export class FloatingRuntime implements FloatingActions {
  private snapshot: FloatingSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Set<Promise<void>>()
  private readonly offSettings: () => void
  private disposed = false

  /**
   * @param scope - feature-owned accepted settings mirror.
   * @param environment - renderer facts the entry and terminal context read.
   */
  constructor(private readonly scope: SettingsScope<FloatingWorkspaceSettings>, private readonly environment: FloatingPanelEnvironment) {
    this.snapshot = {
      settings: scope.getSnapshot(), phase: environment.supported ? 'closed' : 'unavailable',
      open: false, writeFailed: false, writing: false, directorySupported: false,
    }
    const acceptPreferences = () => {
      this.publish({ settings: scope.getSnapshot() })
      if (this.snapshot.settings.status === 'ready' && this.snapshot.settings.value?.enabled === false) this.close(false)
    }
    this.offSettings = scope.subscribe(acceptPreferences)
    acceptPreferences()
  }

  /** @returns identical snapshot until an accepted preference or panel transition. */
  getSnapshot = (): FloatingSnapshot => this.snapshot
  /**
   * Observe panel and accepted preference facts.
   * @param listener - framework subscriber.
   * @returns disposer for that subscription.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** @returns whether accepted preferences and the platform permit the panel control. */
  available = (): boolean => this.enabledPreferences() !== undefined

  /**
   * Apply one explicit preference through the canonical revisioned mutation owner.
   * @param key - owned preference key.
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

  /** Open this activation's panel, or close it when it is already open. */
  toggle = (): void => {
    if (this.disposed) return
    if (this.snapshot.open) { this.close(); return }
    if (this.enabledPreferences() === undefined) return
    this.publish({ open: true, phase: 'open' })
  }

  /**
   * Close this activation's panel.
   * @param focus - retained for callers that also restore focus themselves.
   */
  close = (focus = true): void => {
    void focus
    if (!this.snapshot.open) { this.phase(this.environment.supported ? 'closed' : 'unavailable'); return }
    this.publish({ open: false, phase: this.environment.supported ? 'closed' : 'unavailable' })
  }

  /**
   * Publish the actual terminal consumer's lifecycle.
   * @param supported - whether the installed renderer consumes the preference for new terminals.
   */
  setDirectorySupported(supported: boolean): void { this.publish({ directorySupported: supported }) }

  /** @returns validated panel identity immediately, then accepted directory facts once preferences are ready. */
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
   * Remove observations and silence subscribers.
   * @returns settlement after outstanding preference mutations finish.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.offSettings()
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
    if (this.disposed || !this.environment.supported || this.snapshot.settings.status !== 'ready') return undefined
    return this.snapshot.settings.value?.enabled === true ? this.snapshot.settings.value : undefined
  }
  private phase(phase: FloatingWindowPhase): void { this.publish({ phase }) }
  private publish(patch: Partial<FloatingSnapshot>): void {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    notifySubscribers(this.listeners, '[floating-workspace]')
  }
}
