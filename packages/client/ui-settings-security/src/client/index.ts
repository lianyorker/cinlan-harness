/** Mobile Emulator settings plugin: device probes, preferences, and owned Android resources. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type CapabilitySettingsKey } from './locales.ts'
import { apply as applyMobile, inject as mobileInject } from './mobile-registration.ts'
import type { Config } from '../config.ts'

export { Config } from '../config.ts'
export type { CapabilityDefinition, CapabilitySectionInjected } from './CapabilitySection.tsx'
export type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'

/** The assembly plugin only owns the shared locale; the feature fiber owns its dependencies. */
export const inject = ['locale']

const NS = 'settings.cinlanCapabilities'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cinlan product capability settings copy. */
    'settings.cinlanCapabilities': CapabilitySettingsKey
  }
}

/** Register the shared dictionary and mount the Mobile Emulator feature. */
export function apply(ctx: ClientContext, config: Config): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-security: dictionaries')
  ctx.plugin({ inject: [...mobileInject], apply: applyMobile }, config)
}
