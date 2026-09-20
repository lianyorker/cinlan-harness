/**
 * Permission preset plugin, browser half — a popupSelect DECORATION hung on
 * the host `/permission` command: one flat list of presets, current value
 * marked active, a pick executes the switch. The decoration owns only the
 * bare invocation; the host command keeps its catalog row, the argued path
 * (`/permission <preset>` still switches directly), and the lifecycle
 * logging. Options read the live process catalog; the active mark reads the
 * Session's current-value-only `permissions` projection. A
 * pick submits the `/permission <preset>` command line, so both surfaces
 * write through one path and the pushed projection frame is the one
 * confirmation. The Full access row carries the same explicit risk gate as
 * the composer chip; the shared popup shell owns the modal mechanics.
 * The General-settings row separately writes the default preset for sessions
 * created later through the host Settings API.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings slot types (this package registers a General row).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the settings invalidation rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PermissionCatalog, PermissionSelection } from '@deepseek-ai/dsh-permission-presets/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PermissionCatalogDirectory } from './catalog.ts'
import { PermissionSelect, type PermissionSelectInjected } from './PermissionSelect.tsx'
import { PermissionRow } from './PermissionRow.tsx'
import type { PermissionRowInjected } from './PermissionRow.tsx'
import {
  accessEn, accessZh, en, zh,
} from './locales.ts'
import {
  displayPermissionPreset, FULL_ACCESS_PRESET,
} from './presentation.ts'
import { PERMISSION_SETTINGS_NS, PermissionPresetSettingsController } from './settings-store.ts'

export type { PermissionRowInjected, PermissionRowProps } from './PermissionRow.tsx'
export type { PermissionCatalogState } from './catalog.ts'
export type { PermissionSelectInjected, PermissionSelectProps } from './PermissionSelect.tsx'
export type {
  PermissionDefaultOption, PermissionSettingsState,
} from './settings-store.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'commandUi', 'connection', 'sessions', 'slots', 'locale', 'remote', 'remote.permissionPresets', 'remote.settings',
  'settingsScope', 'settingsSchema', 'settingsMetadata',
]

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Current-session permission picker and confirmation copy. */
    'permission.access': keyof typeof accessEn
  }
}

const ACCESS_NS = 'permission.access'

/** Read one session's current permissions projection value (undefined = capability absent). */
function selectOf(session: SessionFace | undefined): PermissionSelection | undefined {
  return session?.projections.faceOf('permissions').getSnapshot() as PermissionSelection | undefined
}

/** Join the live catalog with the current Session selection. */
function optionsOf(catalog: PermissionCatalog, currentValue: string, t: TranslateNS<'permission.access'>): SelectOption[] {
  return catalog.options
    .filter(option => option.value !== 'custom')
    .map(option => ({
      id: option.value,
      label: option.value === 'auto' ? `${t('auto.label')} (${t('auto.badge')})` : displayPermissionPreset(option.value, option.name, t),
      ...(option.description !== undefined ? { detail: option.description } : {}),
      ...(option.value === currentValue ? { active: true } : {}),
      ...((option.value === FULL_ACCESS_PRESET || option.value === 'auto')
        ? {
          confirmation: {
            title: t(option.value === 'auto' ? 'auto.confirm.title' : 'confirm.title'),
            description: t(option.value === 'auto' ? 'auto.confirm.description' : 'confirm.description'),
            acknowledgeLabel: t(option.value === 'auto' ? 'auto.confirm.acknowledge' : 'confirm.acknowledge'),
            cancelLabel: t('confirm.cancel'),
            confirmLabel: t(option.value === 'auto' ? 'auto.confirm.enable' : 'confirm.enable'),
          },
        }
        : {}),
    }))
}

/**
 * Client plugin body: register the /permission popup picker over the
 * live catalog and current Session selection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const command = ctx.get('commandUi') as CommandUiContract
  const sessions = ctx.sessions
  ctx.effect(() => {
    const disposers = [
      ctx.locale.register(ACCESS_NS, 'zh', accessZh),
      ctx.locale.register(ACCESS_NS, 'en', accessEn),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-permission: current-session confirmation dictionaries')
  const t = ctx.locale.bind(ACCESS_NS)
  const sessionFor = (session: ClientSessionContext): SessionFace | undefined =>
    sessions.binding(session.sessionId)?.session

  const submit = async (sessionId: SessionId, preset: string): Promise<boolean> => {
    const live = sessions.binding(sessionId)?.session
    if (live === undefined) throw new Error('this session is not materialized yet')
    const result = await live.command(`/permission ${preset}`)
    if (!result.ok) throw new Error(`permission switch failed: ${result.error.code}: ${result.error.message}`)
    if (!result.value.matched) throw new Error('the host offers no /permission command')
    return true
  }
  const catalog = new PermissionCatalogDirectory(ctx)
  ctx.effect(() => () => { catalog.dispose() }, 'ui-permission: process catalog directory')
  ctx.effect(
    () => catalog.invalidations.subscribe(() => { command.dismiss('permission') }),
    'ui-permission: dismiss stale slash choices',
  )
  ctx.slots.inject('conversation.input.permission', () => ctx.slots.register({
    name: 'conversation.input.permission',
    locale: ACCESS_NS,
    inject: (sessionId: SessionId): PermissionSelectInjected => ({
      hooks: { permissionCatalog: catalog.store },
      select: preset => submit(sessionId, preset),
    }),
  }, PermissionSelect))

  ctx.effect(() => ctx.locale.register('settings.permission', { zh, en }), 'ui-permission: settings row dictionaries')
  const settingsT = ctx.locale.bind('settings.permission')

  // The shared SettingsScope mirror updates after document commits and reconnects.
  const describe = ctx.settingsScope.describe()
  const controller = new PermissionPresetSettingsController(
    describe, ctx, ctx.settingsSchema)
  const load = (): Promise<void> => controller.load()
  const select = (preset: string): Promise<void> => controller.select(preset)
  const injected = (): PermissionRowInjected => ({
    hooks: { permission: controller.store },
    load,
    select,
  })

  ctx.effect(() => () => { controller.dispose() }, 'ui-permission: settings row directory')

  ctx.slots.inject('settings.general.item', function* () {
    yield ctx.slots.register({
      name: 'settings.general.item',
      id: 'permission',
      order: -20,
      locale: 'settings.permission',
      inject: injected,
    }, PermissionRow)
    yield ctx.effect(() => {
      let disposeMetadata: (() => void) | undefined
      const refresh = (): void => {
        const snapshot = describe.getSnapshot()
        const available = snapshot.status !== 'unavailable'
          && snapshot.view?.namespaces.some(view => view.ns === PERMISSION_SETTINGS_NS) === true
        if (available && disposeMetadata === undefined) {
          disposeMetadata = ctx.settingsMetadata.registerItems('general', [{
            id: 'permission',
            anchorId: 'permission',
            title: () => settingsT('title'),
            description: () => settingsT('description'),
            keywords: () => ['permission', 'access', 'approval', 'sandbox'],
          }])
        } else if (!available) {
          disposeMetadata?.()
          disposeMetadata = undefined
        }
      }
      refresh()
      const unsubscribe = describe.subscribe(refresh)
      return () => { unsubscribe(); disposeMetadata?.() }
    }, 'ui-permission: searchable available preference')
  })

  ctx.effect(() => command.decorate({
    name: 'permission',
    // Failed catalog reads keep the command available so the popup can retry.
    available: session => selectOf(sessionFor(session)) !== undefined,
    ui: {
      kind: 'popupSelect',
      options: async (session) => {
        const value = selectOf(sessionFor(session))
        if (value === undefined) throw new Error('permission presets are not available on this host')
        return optionsOf(await catalog.load(), value.currentValue, t)
      },
      onSelect: (option, session) => submit(session.sessionId, option.id).then(() => undefined),
    },
  }), 'ui-permission: /permission decoration')
}
