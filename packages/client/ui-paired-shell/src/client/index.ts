/** Restricted phone composition; conversation behavior remains in its owning plugins. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { PairedShell, type PairedShellInjected } from './PairedShell.tsx'
import { authorizedWorkspaces, readonlyWorkspace } from './workspaces.ts'
import { en, zh, type PairedShellKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Paired-device navigation and local operation refusals. */
    pairedShell: PairedShellKey
  }
}

/** Services required to compose the phone root. */
export const inject = ['slots', 'sessions', 'locale', 'theme']

/**
 * Register the phone-only root and read-only Workspace adapter.
 * @param ctx - Context assembled from the restricted phone graph.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('pairedShell', { en, zh }), 'paired shell: dictionaries')
  const t = ctx.locale.bind('pairedShell')
  ctx.provide('uiWorkspace', readonlyWorkspace(() => t('unavailable')))
  ctx.slots.provideRoot({ hooks: { workspaces: authorizedWorkspaces(ctx.sessions) } })
  ctx.effect(() => ctx.slots.register({
    name: 'root',
    locale: 'pairedShell',
    children: { conversation: { kind: 'single', scope: 'session-maybe' } },
    inject: (): PairedShellInjected => ({
      selectSession: (id) => {
        if (ctx.sessions.list.getSnapshot().ids.includes(id)) ctx.sessions.open(id)
      },
    }),
  }, PairedShell), 'paired shell: root')
  ctx.effect(() => {
    const body = document.body
    const root = document.documentElement
    const previousScheme = root.style.colorScheme
    const previousDark = body.getAttribute('data-ds-dark-theme')
    const previousValues = new Map<string, string>()
    let applied: readonly string[] = []
    const restore = (key: string): void => {
      const value = previousValues.get(key) ?? ''
      if (value === '') body.style.removeProperty(key)
      else body.style.setProperty(key, value)
    }
    const update = (snapshot: ThemeSnapshot): void => {
      root.style.colorScheme = snapshot.active.colorScheme
      body.toggleAttribute('data-ds-dark-theme', snapshot.active.colorScheme === 'dark')
      for (const key of applied) restore(key)
      const values = { ...snapshot.active.tokens, '--dsh-content-font-size': String(snapshot.fontSize) + 'px' }
      applied = Object.keys(values)
      for (const [key, value] of Object.entries(values)) {
        if (!previousValues.has(key)) previousValues.set(key, body.style.getPropertyValue(key))
        body.style.setProperty(key, value)
      }
    }
    update(ctx.theme.getTheme())
    const off = ctx.on('theme/change', update)
    return () => {
      off()
      root.style.colorScheme = previousScheme
      if (previousDark === null) body.removeAttribute('data-ds-dark-theme')
      else body.setAttribute('data-ds-dark-theme', previousDark)
      for (const key of applied) restore(key)
    }
  }, 'paired shell: theme presentation')
}
