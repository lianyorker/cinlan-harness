/** Native settings contribution for the existing integrated sidebar terminal preferences. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { TERMINAL_FIELDS, TERMINAL_ITEMS, TerminalSettingsSection, type TerminalSettingsInjected, type TerminalPreferences } from './TerminalSettingsSection.tsx'
import { en, zh, type TerminalSettingsKey } from './locales.ts'

/** Required Settings services and optional integrated terminal capability. */
export const inject = ['slots', 'locale', 'settingsScope', 'settingsMetadata']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Integrated terminal preferences copy. */
    'settings.terminal': TerminalSettingsKey
  }
}

/**
 * Register the terminal page with its existing durable settings namespace.
 * @param ctx - client plugin context with Settings and optional sidebar capability.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.terminal', { en, zh }))
  const t = ctx.locale.bind('settings.terminal')
  const preferences = ctx.settingsScope.bind<SidebarPrefs>({ namespace: 'dsh-better-sidebar' })
  const unavailable: TerminalSettingsInjected['checkCapability'] = () => Promise.resolve({ status: 'unavailable', reason: 'probe-failed' })
  let checkCapability = unavailable
  ctx.inject(['betterSidebar'], (sidebarCtx) => {
    checkCapability = () => sidebarCtx.betterSidebar.getTerminalCapability()
    sidebarCtx.effect(() => () => { checkCapability = unavailable })
  })
  const writableSnapshot = () => {
    const current = preferences.getSnapshot()
    if (current.status !== 'ready' || !current.writable || current.mode !== 'host') throw new Error(t('readOnly'))
    return current
  }
  const save: TerminalSettingsInjected['save'] = async (changes, revision) => {
    const current = writableSnapshot()
    const currentUser = current.user as Partial<TerminalPreferences> | undefined
    const ops: Extract<Parameters<typeof preferences.mutate>[0][number], { op: 'set' }>[] = []
    for (const field of TERMINAL_FIELDS) {
      const value = changes[field]
      if (value === undefined) continue
      if (currentUser != null && Object.hasOwn(currentUser, field)
        && currentUser[field] === value && current.value?.[field] === value) continue
      ops.push({ op: 'set', path: [field], value })
    }
    if (ops.length === 0) return false
    const accepted = await preferences.mutate(ops, revision)
    if (!accepted) throw new Error(t('failed'))
    const next = preferences.getSnapshot()
    const user = next.user as Partial<TerminalPreferences> | undefined
    if (next.status !== 'ready' || user == null || ops.some(({ path, value }) => {
      const field = path[0] as keyof TerminalPreferences
      return !Object.hasOwn(user, field) || user[field] !== value || next.value?.[field] !== value
    })) throw new Error(t('failed'))
    return true
  }
  const reset: TerminalSettingsInjected['reset'] = async (revision) => {
    const current = writableSnapshot()
    if (current.user == null || !TERMINAL_FIELDS.some(field => Object.hasOwn(current.user as object, field))) return false
    const accepted = await preferences.mutate(TERMINAL_FIELDS.map(field => ({ op: 'unset' as const, path: [field] })), revision)
    if (!accepted) throw new Error(t('failed'))
    const next = preferences.getSnapshot()
    if (next.status !== 'ready' || (next.user != null && TERMINAL_FIELDS.some(field => Object.hasOwn(next.user as object, field)))) {
      throw new Error(t('failed'))
    }
    return true
  }

  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'terminal', groupId: 'experimental' })
    yield ctx.settingsMetadata.registerItems('terminal', TERMINAL_ITEMS.map(([id, title, description]) => ({
      id, anchorId: id, title: () => t(title), description: () => t(description),
    })))
    yield ctx.slots.register({
      name: 'settings.section', id: 'terminal', order: 150, label: () => t('title'), locale: 'settings.terminal',
      inject: (): TerminalSettingsInjected => ({
        hooks: { preferences }, save, reset,
        checkCapability: () => checkCapability(),
      }),
    }, TerminalSettingsSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', key: 'terminal' }, IconCodeOutline16))
}

export type { TerminalPreferences }
