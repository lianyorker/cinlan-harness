/** Voice settings, visible composer button, and global Ctrl+Shift+E dictation plugin. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DictationController } from './dictation-controller.ts'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createVoiceApi } from './api.ts'
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
export const inject = ['settingsMetadata', 'slots', 'locale', 'sessions', 'conversation', 'remote', 'remote.voice']

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
  let heldSession: SessionId | undefined
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || event.key.toLowerCase() !== 'e' || !event.shiftKey || event.altKey || event.metaKey) return
    if (event.repeat || event.isComposing || event.defaultPrevented || isEditableTarget(event.target)) return
    const { enabled, dictationMode } = settingsStore.getSnapshot()
    if (!enabled) return
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return
    event.preventDefault()
    if (dictationMode === 'hold') {
      heldSession = sessionId
      controller.start(sessionId)
    } else {
      controller.toggle(sessionId)
    }
  }
  const releaseHold = (): void => {
    if (heldSession === undefined) return
    controller.stop(heldSession)
    heldSession = undefined
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (heldSession === undefined || !['e', 'control', 'shift'].includes(event.key.toLowerCase())) return
    event.preventDefault()
    releaseHold()
  }
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseHold)
  return () => {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', releaseHold)
  }
}

/**
 * Mount the Voice settings page, field metadata, composer button, and Ctrl+Shift+E shortcut.
 * @param ctx - client plugin lifetime that owns registrations and dictation teardown.
 */
export function apply(ctx: ClientContext): void {
  const voiceApi = createVoiceApi(ctx.remote.voice)
  const settingsStore = createVoiceSettingsStore()
  const updateSettings = (patch: Partial<VoiceSettings>): void => {
    settingsStore.update((draft) => { Object.assign(draft, patch) })
  }
  const controller = new DictationController(ctx, settingsStore, { modelsList: voiceApi.modelsList, transcribe: voiceApi.transcribe })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-dictation: dictionaries')
  const t = ctx.locale.bind(NS)

  const sectionInjected = (): VoiceSettingsInjected => ({
    hooks: { settings: settingsStore },
    updateSettings,
    engineStatus: voiceApi.engineStatus,
    modelsList: voiceApi.modelsList,
    modelsDownload: voiceApi.modelsDownload,
    modelsRemove: voiceApi.modelsRemove,
  })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'voice', groupId: 'ai' })
    yield ctx.settingsMetadata.registerItems('voice', [
      { id: 'enabled', anchorId: 'voice-enabled', title: () => t('enableDictation'), description: () => t('enableDictationDescription'), keywords: () => [t('keywordDictation')] },
      { id: 'mode', anchorId: 'voice-mode', title: () => t('dictationModeTitle'), description: () => t('dictationModeDescription'), keywords: () => [t('modeToggle'), t('modeHold'), 'Ctrl+Shift+E'] },
      { id: 'permission', anchorId: 'voice-permission', title: () => t('microphoneTitle'), description: () => t('microphoneDescription'), keywords: () => [t('keywordPermission')] },
      { id: 'device', anchorId: 'voice-device', title: () => t('microphoneDevice'), description: () => t('microphoneDeviceDescription'), keywords: () => [t('keywordMicrophone')] },
      { id: 'engine', anchorId: 'voice-engine', title: () => t('engineSectionTitle'), description: () => t('engineDescription'), keywords: () => [t('keywordLocal'), t('keywordRepair')] },
      { id: 'model', anchorId: 'voice-model', title: () => t('selectModel'), description: () => t('selectModelDescription'), keywords: () => [t('modelDownload'), t('modelRemove'), t('keywordOffline')] },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'voice',
      order: 85,
      label: () => t('nav'),
      locale: NS,
      inject: sectionInjected,
    }, VoiceSettingsSection)
  })

  const buttonInjected = (): VoiceButtonInjected => ({
    hooks: { dictation: controller.store, settings: settingsStore },
    modelsList: voiceApi.modelsList,
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
