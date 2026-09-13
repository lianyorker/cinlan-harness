/** Register the Browser Element Capture guidance panel in Settings. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  BrowserElementCaptureSection,
  type BrowserElementCaptureSectionProps,
} from './BrowserElementCaptureSection.tsx'
import { en, NS, zh } from './locales.ts'

export { BrowserElementCaptureSection }
export type { BrowserElementCaptureSectionProps }
export type { BrowserElementCaptureKey } from './locales.ts'

/** Client services required by the Settings registration. */
export const inject = ['slots', 'locale']

/**
 * Register the panel after the Settings section slot is declared.
 * @param ctx - Client context carrying slots and localization.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser-element-capture: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'browser-element-capture',
    order: 70,
    label: () => t('nav'),
    locale: NS,
  }, BrowserElementCaptureSection))
}
