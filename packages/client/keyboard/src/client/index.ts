/** Keyboard command registration without global DOM dispatch. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { KeybindingsSettings, KeyboardService } from '../types.ts'
import { KeyboardController } from './controller.ts'

export type * from '../types.ts'

/** Owners augment each stable command id with its focus scope. */
export interface KeyboardCommandMap {}

declare module '@deepseek-ai/cordis' {
  interface Context { keyboard: KeyboardService }
}

/** Services supplying persisted overrides and localized owner labels. */
export const inject = ['settingsScope', 'locale']

/**
 * Publish the narrow matcher; owners install their own local event handlers.
 * @param ctx - client context owning the service and subscriptions.
 */
export function apply(ctx: Context): void {
  const settings = ctx.settingsScope.bind<KeybindingsSettings>({ namespace: 'keybindings' })
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const keyboard = new KeyboardController(settings, mac)
  ctx.effect(() => ctx.reflect.provide('keyboard', keyboard), 'keyboard: service')
  ctx.effect(() => ctx.locale.subscribe(() => { keyboard.refresh() }), 'keyboard: locale')
  ctx.effect(() => () => { keyboard.dispose() }, 'keyboard: subscriptions')
}
