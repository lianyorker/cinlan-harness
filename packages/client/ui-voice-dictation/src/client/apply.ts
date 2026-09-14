/** Voice settings, visible composer button, and global Ctrl+Shift+E dictation plugin. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DictationController } from './dictation-controller.ts'
import { en, zh, type VoiceSettingsKey } from './locales.ts'
import { VoiceButton, type VoiceButtonInjected } from './VoiceButton.tsx'
import { VoiceSettingsSection, type VoiceSettingsInjected } from './VoiceSettingsSection.tsx'
import { createVoiceSettingsStore, type VoiceSettings } from './voice-settings.ts'

export type { VoiceModelRow } from './api.ts'
export type { MicrophonePermissionState } from './microphone.ts'
export type { VoiceSettings, DictationMode } from './voice-settings.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Voice settings and dictation-trigger copy. */
    'settings.voice': VoiceSettingsKey
  }
}

const NS = 'settings.voice'

/** Services required by Settings, composer slots, and current-session resolution. */
export const inject = ['slots', 'locale', 'sessions', 'conversation']

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
    || target.closest('[contenteditable="true"]') !== null
}

type SettingsStore = ReturnType<typeof createVoiceSettingsStore>

function registerDictationShortcut(ctx: ClientContext, controller: DictationController, settingsStore: SettingsStore): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || event.key.toLowerCase() !== 'e' || !event.shiftKey || event.altKey || event.metaKey) return
    if (event.repeat || event.isComposing || event.defaultPrevented || isEditableTarget(event.target)) return
    const { enabled, dictationMode } = settingsStore.getSnapshot()
    if (!enabled) return
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return
    event.preventDefault()
    if (dictationMode === 'hold') {
      if (event.repeat) return
      controller.start(sessionId)
    } else {
      controller.toggle(sessionId)
    }
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || event.key.toLowerCase() !== 'e' || !event.shiftKey || event.altKey || event.metaKey) return
    const { enabled, dictationMode } = settingsStore.getSnapshot()
    if (!enabled || dictationMode !== 'hold') return
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return
    event.preventDefault()
    controller.stop(sessionId)
  }
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  return () => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
  }
}

/** Mount the Voice settings page, composer button, and Ctrl+Shift+E shortcut. */
export function apply(ctx: ClientContext): void {
  const settingsStore = createVoiceSettingsStore()
  const updateSettings = (patch: Partial<VoiceSettings>): void => {
    settingsStore.update((draft) => { Object.assign(draft, patch) })
  }
  const controller = new DictationController(ctx, settingsStore)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-dictation: dictionaries')
  const t = ctx.locale.bind(NS)

  const sectionInjected = (): VoiceSettingsInjected => ({
    hooks: { settings: settingsStore },
    updateSettings,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'voice',
    order: 85,
    label: () => t('nav'),
    locale: NS,
    inject: sectionInjected,
  }, VoiceSettingsSection))

  const buttonInjected = (): VoiceButtonInjected => ({
    hooks: { dictation: controller.store, settings: settingsStore },
    toggle: (sessionId) => { controller.toggle(sessionId) },
  })
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'voice-dictation',
    order: 80,
    locale: NS,
    inject: buttonInjected,
  }, VoiceButton))

  ctx.effect(() => registerDictationShortcut(ctx, controller, settingsStore), 'ui-voice-dictation: Ctrl+Shift+E trigger')
  ctx.effect(() => async () => { await controller.dispose() }, 'ui-voice-dictation: controller teardown')
}
