/** Structured shortcut normalization and browser reservation rules. */
import type { KeyBinding, KeyCapture, KeyEventFacts } from '../types.ts'

const ALIASES: Readonly<Record<string, string>> = { esc: 'escape', spacebar: ' ', space: ' ', del: 'delete', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' }
const MODIFIERS = new Set(['control', 'shift', 'alt', 'meta', 'altgraph', 'os'])
const UNUSABLE = new Set(['', 'dead', 'unidentified', 'process'])

/** @param key - persisted or event key. @returns normalized logical key. */
export function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  return ALIASES[lower] ?? lower
}

/** @param binding - persisted shortcut. @param mac - current platform. @returns canonical equality key. */
export function bindingIdentity(binding: KeyBinding, mac: boolean): string {
  const m = binding.modifiers
  return [normalizeKey(binding.key), !!m.ctrl || (!!m.mod && !mac), !!m.shift, !!m.alt, !!m.meta || (!!m.mod && mac)].join('|')
}

/**
 * @param binding - proposed shortcut.
 * @param mac - current platform.
 * @param scope - owner focus scope, including intrinsic composer reservations.
 * @returns invalid/reserved status, if any.
 */
export function bindingIssue(binding: KeyBinding, mac: boolean, scope?: string): 'invalid' | 'reserved' | undefined {
  const key = normalizeKey(binding.key)
  if (UNUSABLE.has(key) || MODIFIERS.has(key)) return 'invalid'
  const m = binding.modifiers
  const ctrl = !!m.ctrl || (!!m.mod && !mac)
  const meta = !!m.meta || (!!m.mod && mac)
  if (scope?.startsWith('composer') === true && key === 'enter' && m.shift) return 'reserved'
  if (['f5', 'f11', 'f12'].includes(key)) return 'reserved'
  if ((ctrl || meta) && ['l', 't', 'n', 'w', 'r', 'q', 'h', 'j', 'tab'].includes(key)) return 'reserved'
  if ((ctrl && m.shift && ['i', 'c'].includes(key)) || (meta && m.alt && ['i', 'j', 'c'].includes(key))) return 'reserved'
  if ((m.alt && ['f4', 'arrowleft', 'arrowright'].includes(key)) || (meta && key === ' ')) return 'reserved'
  return undefined
}

/** @param facts - local event facts. @returns whether composition or a prior consumer owns this event. */
export function ignoresEvent(facts: KeyEventFacts): boolean {
  return facts.defaultPrevented || facts.isComposing || facts.keyCode === 229 || facts.altGraph === true
}

/** @param facts - recorder event facts. @param mac - current platform. @returns a portable binding or refusal. */
export function captureBinding(facts: KeyEventFacts, mac: boolean): KeyCapture {
  if (ignoresEvent(facts) || facts.repeat || MODIFIERS.has(normalizeKey(facts.key))) return { kind: 'ignored' }
  const binding: KeyBinding = {
    key: facts.key,
    modifiers: {
      mod: mac ? facts.metaKey : facts.ctrlKey,
      ctrl: mac && facts.ctrlKey,
      meta: !mac && facts.metaKey,
      alt: facts.altKey,
      shift: facts.shiftKey,
    },
  }
  const issue = bindingIssue(binding, mac)
  return issue === undefined ? { kind: 'binding', binding } : { kind: issue }
}

/** @param binding - shortcut to display. @param mac - current platform. @returns modifier and key tokens, with no product copy. */
export function bindingLabel(binding: KeyBinding, mac: boolean): string {
  const m = binding.modifiers
  const parts: string[] = []
  if (m.ctrl || (m.mod && !mac)) parts.push('Ctrl')
  if (m.alt) parts.push(mac ? '⌥' : 'Alt')
  if (m.shift) parts.push(mac ? '⇧' : 'Shift')
  if (m.meta || (m.mod && mac)) parts.push(mac ? '⌘' : 'Meta')
  parts.push(binding.key === ' ' ? '␣' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  return parts.join(' + ')
}
