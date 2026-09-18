/** Registered keyboard command and durable override types. */
import type { KeyboardCommandMap } from './client/index.ts'

/** Persisted key and exact modifier flags; mod follows the current platform. */
export interface KeyBinding {
  key: string
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; mod?: boolean }
}

/** An existing command id remains stored even while its owner is unloaded. */
export interface KeybindingOverride {
  commandId: string
  binding: KeyBinding | null
}

/** Durable preferences in the existing keybindings namespace. */
export interface KeybindingsSettings { overrides: KeybindingOverride[] }

/** Stable command ids registered by the composed owners. */
export type KeyboardCommandId = Extract<keyof KeyboardCommandMap, string>

/** Focus scope fixed by the command's owning package. */
export type KeyboardCommandScope<K extends KeyboardCommandId> = KeyboardCommandMap[K] extends { scope: infer S extends string } ? S : never

/** Plain event facts passed by a local editor or shell handler. */
export interface KeyEventFacts {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  isComposing: boolean
  repeat: boolean
  defaultPrevented: boolean
  /** Legacy IME sentinel copied at the DOM event owner. */
  keyCode?: number
  /** AltGraph text entry must remain with the editor. */
  altGraph?: boolean
}

/** Bare reactive availability source, owned by the registering plugin. */
export interface CommandAvailability {
  /** Read the owning capability's availability. @returns whether the action can be dispatched. */
  getSnapshot(): boolean
  /**
   * Observe changes to capability availability.
   * @param listener - callback after the availability value changes.
   * @returns disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
}

/** Owner-provided command defaults and localized presentation. */
export interface KeyboardCommandDefinition<K extends KeyboardCommandId> {
  id: K
  scope: KeyboardCommandScope<K>
  /** Read the command label. @returns owner-localized action name. */
  label: () => string
  /** Read the command explanation. @returns owner-localized action description. */
  description: () => string
  /** Every default alias belongs to this same command; one override replaces them. */
  defaultBindings: readonly KeyBinding[]
  available?: CommandAvailability
  /** Repeated keys are admitted only for commands such as menu navigation. */
  allowRepeat?: boolean
}

/** A binding that cannot dispatch is represented explicitly in the settings list. */
export type KeyboardCommandStatus = 'available' | 'unavailable' | 'reserved' | 'invalid' | 'conflict'

/** Localized effective command settings; no callback or DOM object is published. */
export interface EffectiveKeyboardCommand {
  id: string
  scope: string
  label: string
  description: string
  bindings: readonly KeyBinding[]
  bindingLabels: readonly string[]
  overridden: boolean
  registered: boolean
  status: KeyboardCommandStatus
  conflicts: readonly string[]
}

/** Renderer-bindable view over command registration and accepted Host settings. */
export interface KeyboardSnapshot {
  commands: readonly EffectiveKeyboardCommand[]
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  hasOverrides: boolean
}

/** Recorder outcome; ignored keys leave the recorder active. */
export type KeyCapture = { kind: 'binding'; binding: KeyBinding } | { kind: 'ignored' | 'reserved' | 'invalid' }

/** Preference mutations report failures without optimistically changing bindings. */
export type KeyboardWriteResult = { ok: true } | { ok: false; reason: 'unavailable' | 'reserved' | 'invalid' | 'conflict' | 'failed' }

/** Shared registry and matcher; event listeners and actions remain with consumers. */
export interface KeyboardService {
  /**
   * Read registered commands and accepted shortcut preferences.
   * @returns The same snapshot object until registration, locale, or settings change.
   */
  getSnapshot(): KeyboardSnapshot
  /**
   * Observe effective command changes.
   * @param listener - snapshot invalidation callback.
   * @returns listener disposer.
   */
  subscribe(listener: () => void): () => void
  /**
   * Contribute one action and its owned defaults.
   * @param definition - typed owner defaults and availability.
   * @returns registration disposer.
   */
  register<K extends KeyboardCommandId>(definition: KeyboardCommandDefinition<K>): () => void
  /**
   * Match an effective shortcut against the current key event.
   * @param id - command owned by this local handler.
   * @param facts - plain current key event facts.
   * @returns whether this command may handle the event.
   */
  matches(id: KeyboardCommandId, facts: KeyEventFacts): boolean
  /**
   * Interpret a local recorder event.
   * @param facts - recorder event facts.
   * @returns a binding or the reason the event is ignored/refused.
   */
  capture(facts: KeyEventFacts): KeyCapture
  /**
   * Persist a shortcut override after validating availability and conflicts.
   * @param commandId - registered action to customize.
   * @param binding - shortcut, or null to disable it.
   * @returns accepted-state result.
   */
  setBinding(commandId: string, binding: KeyBinding | null): Promise<KeyboardWriteResult>
  /**
   * Remove a user override without writing the default binding.
   * @param commandId - override to remove.
   * @returns accepted-state result.
   */
  resetBinding(commandId: string): Promise<KeyboardWriteResult>
  /**
   * Restore every registered command's default shortcut.
   * @returns The accepted-state result after unsetting the entire overrides leaf.
   */
  resetAll(): Promise<KeyboardWriteResult>
}
