/** Register human element capture and scoped image draft intake in Settings. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CaptureInjected } from './contract.ts'
import {
  BrowserElementCaptureSection,
  type BrowserElementCaptureSectionProps,
} from './BrowserElementCaptureSection.tsx'
import { en, NS, zh } from './locales.ts'

export type { BrowserElementCaptureSectionProps }
export type { BrowserElementCaptureKey } from './locales.ts'

/** Client services required by the Settings registration. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'sessions', 'conversation', 'remote', 'remote.browser']

/**
 * Register the panel after the Settings section slot is declared.
 * @param ctx - Client context carrying slots and localization.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser-element-capture: dictionaries')
  const t = ctx.locale.bind(NS)
  const request = async <T>(operation: Promise<RemoteResult<T>>): Promise<T> => {
    const result = await operation
    if (!result.ok) throw new Error(t('operationFailed', { detail: result.error.message }))
    return result.value
  }
  const operations = (): CaptureInjected => ({
    pages: signal => request(ctx.remote.browser.pages(signal)),
    select: (pageId, signal) => request(ctx.remote.browser.selectElement({ pageId }, signal)),
    capture: (command, signal) => request(ctx.remote.browser.captureElement(command, signal)),
    attach: (sessionId, value) => {
      const conversation = ctx.sessions.scope(sessionId)?.get('conversation')
      if (conversation === undefined) throw new Error(t('sessionUnavailable'))
      if (!conversation.addImageDraft({
        mediaType: value.image.mediaType,
        data: value.data,
        ...(value.image.name === undefined ? {} : { name: value.image.name }),
      })) throw new Error(t('draftBusy'))
    },
  })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'browser-element-capture', groupId: 'tools' })
    yield ctx.settingsMetadata.registerItems('browser-element-capture', [
      { id: 'availability', anchorId: 'capture-availability', title: () => t('title'), description: () => t('availability'), keywords: () => [t('nav')] },
      { id: 'page', anchorId: 'capture-page', title: () => t('pageTitle'), description: () => t('stepOne'), keywords: () => ['browser_list'] },
      { id: 'selection', anchorId: 'capture-selection', title: () => t('selectionTitle'), description: () => t('stepTwo'), keywords: () => ['browser_select_element'] },
      { id: 'image', anchorId: 'capture-image', title: () => t('imageTitle'), description: () => t('stepThree'), keywords: () => ['browser_capture_element'] },
      { id: 'permissions', anchorId: 'capture-permissions', title: () => t('safetyTitle'), description: () => t('safetyBody'), keywords: () => [t('nav')] },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'browser-element-capture',
      order: 55,
      label: () => t('nav'),
      locale: NS,
      inject: operations,
    }, BrowserElementCaptureSection)
  })
}
