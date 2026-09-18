/** Shell-owned command dispatch excludes editor focus and portaled overlays. */
import type { KeyboardEvent } from 'react'
import type { KeyEventFacts } from '@deepseek-ai/dsh-client-keyboard/client'

declare module '@deepseek-ai/dsh-client-keyboard/client' {
  interface KeyboardCommandMap { 'shell.toggleSidebar': { scope: 'shell' } }
}

/** Plain event matcher supplied by the layout plugin's apply closure. */
export interface ShellShortcutInjected { matchesSidebarShortcut: (facts: KeyEventFacts) => boolean }

/**
 * Handle the shell command only from the frame's own DOM subtree.
 * @param event - React key event at the shell root.
 * @param matches - event-time effective shortcut matcher.
 * @param toggle - real sidebar visibility action.
 */
export function handleSidebarShortcut(event: KeyboardEvent<HTMLElement>, matches: ShellShortcutInjected['matchesSidebarShortcut'], toggle: () => void): void {
  const target = event.target
  if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
  if (event.currentTarget.closest('[inert]') !== null) return
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="menu"]') !== null) return
  const native = event.nativeEvent
  const facts = { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
    isComposing: native.isComposing, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
    // oxlint-disable-next-line typescript/no-deprecated
    keyCode: native.keyCode, altGraph: event.getModifierState('AltGraph') }
  if (!matches(facts)) return
  event.preventDefault()
  toggle()
}
