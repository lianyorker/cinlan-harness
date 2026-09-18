/** Reactive command registration and serialized preference mutations. */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  EffectiveKeyboardCommand, KeyBinding, KeyEventFacts, KeybindingsSettings,
  KeyboardCommandDefinition, KeyboardCommandId, KeyboardService, KeyboardSnapshot, KeyboardWriteResult,
} from '../types.ts'
import { bindingIdentity, bindingIssue, bindingLabel, captureBinding, ignoresEvent } from './bindings.ts'

type Definition = Omit<KeyboardCommandDefinition<KeyboardCommandId>, 'id' | 'scope'> & { id: string; scope: string }

/** Internal service implementation; consumers receive only its declared methods. */
export class KeyboardController implements KeyboardService {
  private readonly definitions = new Map<string, Definition>()
  private readonly availabilityDisposers = new Map<string, () => void>()
  private readonly listeners = new Set<() => void>()
  private snapshot: KeyboardSnapshot
  private readonly offSettings: () => void
  private pending: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly settings: SettingsScope<KeybindingsSettings>, private readonly mac: boolean) {
    this.snapshot = this.buildSnapshot()
    this.offSettings = settings.subscribe(() => { this.refresh() })
  }

  getSnapshot(): KeyboardSnapshot { return this.snapshot }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  register<K extends KeyboardCommandId>(definition: KeyboardCommandDefinition<K>): () => void {
    if (this.definitions.has(definition.id)) throw new Error('keyboard command already registered: ' + String(definition.id))
    if (this.disposed) throw new Error('keyboard service is disposed')
    for (const binding of definition.defaultBindings) {
      const issue = bindingIssue(binding, this.mac, definition.scope)
      if (issue !== undefined) throw new Error('keyboard command has a ' + issue + ' default: ' + String(definition.id))
    }
    this.definitions.set(definition.id, definition)
    if (definition.available !== undefined) {
      this.availabilityDisposers.set(definition.id, definition.available.subscribe(() => { this.refresh() }))
    }
    this.refresh()
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      this.availabilityDisposers.get(definition.id)?.()
      this.availabilityDisposers.delete(definition.id)
      this.definitions.delete(definition.id)
      this.refresh()
    }
  }

  matches(id: KeyboardCommandId, facts: KeyEventFacts): boolean {
    if (this.disposed || this.snapshot.status !== 'ready' || ignoresEvent(facts)) return false
    const definition = this.definitions.get(id)
    if (definition === undefined || (facts.repeat && definition.allowRepeat !== true)) return false
    const command = this.snapshot.commands.find(candidate => candidate.id === id)
    if (command?.status !== 'available') return false
    const pressed: KeyBinding = { key: facts.key,
      modifiers: { ctrl: facts.ctrlKey, meta: facts.metaKey, alt: facts.altKey, shift: facts.shiftKey } }
    return command.bindings.some(binding => bindingIdentity(binding, this.mac) === bindingIdentity(pressed, this.mac))
  }

  capture(facts: KeyEventFacts) { return captureBinding(facts, this.mac) }

  setBinding(commandId: string, binding: KeyBinding | null): Promise<KeyboardWriteResult> {
    binding = binding === null ? null : structuredClone(binding)
    return this.enqueue(async () => {
      const definition = this.definitions.get(commandId)
      if (definition === undefined || definition.available?.getSnapshot() === false) return { ok: false, reason: 'unavailable' }
      if (binding !== null) {
        const issue = bindingIssue(binding, this.mac, definition.scope)
        if (issue !== undefined) return { ok: false, reason: issue }
        const identity = bindingIdentity(binding, this.mac)
        if (this.snapshot.commands.some(command => command.id !== commandId && command.scope === definition.scope
          && command.status !== 'unavailable' && command.bindings.some(candidate => bindingIdentity(candidate, this.mac) === identity))) {
          return { ok: false, reason: 'conflict' }
        }
      }
      const raw = this.settings.getSnapshot().user as Partial<KeybindingsSettings> | undefined
      const saved = new Map(raw?.overrides?.map(override => [override.commandId, override]))
      const next = this.overrides().filter(override => override.commandId !== commandId)
        .map(override => saved.get(override.commandId) ?? override)
      next.push({ commandId, binding })
      return this.persist(next)
    })
  }

  resetBinding(commandId: string): Promise<KeyboardWriteResult> {
    return this.enqueue(() => {
      const raw = this.settings.getSnapshot().user as Partial<KeybindingsSettings> | undefined
      return this.persist(raw?.overrides?.filter(override => override.commandId !== commandId))
    })
  }

  resetAll(): Promise<KeyboardWriteResult> {
    return this.enqueue(() => this.persist(undefined))
  }

  /** Republish localized labels after the owning locale source changes. */
  refresh(): void {
    if (this.disposed) return
    this.snapshot = this.buildSnapshot()
    for (const listener of [...this.listeners]) listener()
  }

  /** Release all settings and availability subscriptions with the plugin. */
  dispose(): void {
    this.disposed = true
    this.offSettings()
    for (const dispose of this.availabilityDisposers.values()) dispose()
    this.availabilityDisposers.clear()
    this.definitions.clear()
    this.listeners.clear()
  }

  private overrides() { return this.settings.getSnapshot().value?.overrides ?? [] }

  private buildSnapshot(): KeyboardSnapshot {
    const settings = this.settings.getSnapshot()
    const overrides = new Map(this.overrides().map(override => [override.commandId, override]))
    const user = settings.user as Partial<KeybindingsSettings> | undefined
    const savedIds = new Set(user?.overrides?.map(override => override.commandId))
    const commands: EffectiveKeyboardCommand[] = []
    for (const definition of this.definitions.values()) {
      const override = overrides.get(definition.id)
      const bindings = override === undefined ? definition.defaultBindings : override.binding === null ? [] : [override.binding]
      const status = definition.available?.getSnapshot() === false ? 'unavailable'
        : bindings.map(binding => bindingIssue(binding, this.mac, definition.scope)).find(issue => issue !== undefined) ?? 'available'
      commands.push({
        id: definition.id, scope: definition.scope, label: definition.label(), description: definition.description(),
        bindings, bindingLabels: bindings.map(binding => bindingLabel(binding, this.mac)),
        overridden: savedIds.has(definition.id),
        registered: true, status, conflicts: [],
      })
      overrides.delete(definition.id)
    }
    for (const override of overrides.values()) {
      const bindings = override.binding === null ? [] : [override.binding]
      commands.push({ id: override.commandId, scope: 'unavailable', label: override.commandId, description: '', bindings,
        bindingLabels: bindings.map(binding => bindingLabel(binding, this.mac)),
        overridden: savedIds.has(override.commandId), registered: false, status: 'unavailable', conflicts: [] })
    }
    for (const command of commands) {
      if (command.status === 'unavailable' || command.status === 'invalid' || command.status === 'reserved') continue
      const identities = new Set(command.bindings.map(binding => bindingIdentity(binding, this.mac)))
      const conflicts = commands.filter(candidate => candidate.id !== command.id && candidate.scope === command.scope
        && candidate.status !== 'unavailable' && candidate.status !== 'invalid' && candidate.status !== 'reserved'
        && candidate.bindings.some(binding => identities.has(bindingIdentity(binding, this.mac))))
      if (conflicts.length !== 0) {
        command.status = 'conflict'
        command.conflicts = conflicts.map(candidate => candidate.id)
      }
    }
    return { commands, status: settings.status, writable: settings.writable,
      hasOverrides: user !== undefined && Object.hasOwn(user, 'overrides') }
  }

  private enqueue(operation: () => Promise<KeyboardWriteResult>): Promise<KeyboardWriteResult> {
    const run = this.pending.then(async (): Promise<KeyboardWriteResult> => {
      const snapshot = this.settings.getSnapshot()
      if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable) return { ok: false, reason: 'unavailable' }
      try { return await operation() } catch {
        // Rejected settings writes stay visible as a retryable failure.
        return { ok: false, reason: 'failed' }
      }
    })
    this.pending = run
    return run
  }

  private async persist(overrides: KeybindingsSettings['overrides'] | undefined): Promise<KeyboardWriteResult> {
    const before = this.settings.getSnapshot()
    const target = overrides?.length === 0 ? undefined : overrides
    const raw = before.user as Partial<KeybindingsSettings> | undefined
    const effectiveSignature = (value: KeybindingsSettings['overrides'] | undefined): string => JSON.stringify(
      (value ?? []).map(item => [item.commandId, item.binding === null ? null : bindingIdentity(item.binding, this.mac)]))
    const confirmsEffective = (snapshot: ReturnType<SettingsScope<KeybindingsSettings>['getSnapshot']>): boolean => {
      const base = snapshot.base as Partial<KeybindingsSettings> | undefined
      return effectiveSignature(snapshot.value?.overrides) === effectiveSignature(target ?? base?.overrides)
    }
    if (JSON.stringify(raw?.overrides) === JSON.stringify(target)) {
      return confirmsEffective(before) ? { ok: true } : { ok: false, reason: 'failed' }
    }
    if (target === undefined) await this.settings.unset('overrides')
    else await this.settings.set('overrides', target)
    if (this.disposed) return { ok: false, reason: 'unavailable' }
    const after = this.settings.getSnapshot()
    const user = after.user as Partial<KeybindingsSettings> | undefined
    const accepted = after.status === 'ready' && before.revision !== undefined
      && after.revision !== undefined && after.revision > before.revision
      && JSON.stringify(user?.overrides) === JSON.stringify(target) && confirmsEffective(after)
    return accepted ? { ok: true } : { ok: false, reason: 'failed' }
  }
}
