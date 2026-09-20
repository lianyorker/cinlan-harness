/** Feature-owned settings navigation over the shared workspace tools. */
import { Fragment, createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SettingsGroupId, SettingsItemMetadata,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SideCardSection, type SideCardSectionInjected } from './SideCardSection.tsx'
import type { FileViewerDescriptor, TabDescriptor } from './service.ts'
import { IconPanelRightOutline16 } from './icons.tsx'
import { t } from './locales.ts'
import { featureSettings } from './feature-settings.ts'

type FeaturePage = { sectionId: string; embedded: true } | {
  sectionId: string
  group: SettingsGroupId
  order: number
  embedded: false
}

const BUILTIN_PAGES: Readonly<Record<string, FeaturePage>> = {
  editor: { sectionId: 'files', group: 'tools', order: 55, embedded: false },
  subagent: { sectionId: 'tasks', group: 'ai', order: 35, embedded: false },
  sidechat: { sectionId: 'sidechat', group: 'ai', order: 36, embedded: false },
  git: { sectionId: 'git-source-control', embedded: true },
  browser: { sectionId: 'cinlan-browser', embedded: true },
  terminal: { sectionId: 'terminal', embedded: true },
}

function title(feature: TabDescriptor | FileViewerDescriptor): string {
  return (typeof feature.title === 'function' ? feature.title() : feature.title) ?? feature.id
}

function items(feature: TabDescriptor | FileViewerDescriptor, viewer = false): SettingsItemMetadata[] {
  const visible = featureSettings(feature, !viewer && BUILTIN_PAGES[feature.id]?.embedded === true)
  const base = 'better-sidebar-' + (viewer ? 'viewer-' : '') + feature.id
  const enabled = base + '-enabled'
  const rows: SettingsItemMetadata[] = [{
    id: enabled, anchorId: enabled, title: () => title(feature) + ' · ' + t('featureEnabled'),
    description: () => t('featureEnabledDesc', { feature: title(feature) }),
  }]
  for (const [toggles, prefix] of [
    [visible.settings?.toggles ?? [], ''],
    [visible.settings?.pluginToggles ?? [], 'plugin-'],
  ] as const) {
    for (const toggle of toggles) {
      const anchor = base + '-' + prefix + toggle.key
      rows.push({
        id: anchor, anchorId: anchor,
        title: () => typeof toggle.title === 'function' ? toggle.title() : toggle.title,
        description: () => typeof toggle.desc === 'function' ? toggle.desc() : toggle.desc ?? '',
      })
    }
  }
  if (!viewer && feature.id === 'editor') {
    const anchor = 'better-sidebar-editor-intercept-open-path'
    rows.push({ id: anchor, anchorId: anchor, title: () => t('settingsOpenPathTitle'), description: () => t('settingsOpenPathDesc') })
  }
  return rows
}

/**
 * Give each visible tool a settings destination and follow descriptor disposal.
 * @param ctx Client plugin context with settings metadata and slots.
 * @param injected Shared live preferences and feature registry.
 */
export function registerFeatureSettings(ctx: Context, injected: SideCardSectionInjected): void {
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'workspace-layout', groupId: 'personal' })
    yield ctx.settingsMetadata.registerItems('workspace-layout', ([
      ['better-sidebar-open-by-default', 'settingsOpenTitle', 'settingsOpenDesc'],
      ['better-sidebar-default-width', 'settingsWidthTitle', 'settingsWidthDesc'],
      ['better-sidebar-title-bar-mode', 'settingsTitleBarTitle', 'settingsTitleBarDesc'],
    ] as const).map(([id, name, description]) => ({
      id, anchorId: id, title: () => t(name), description: () => t(description),
    })))
    yield ctx.slots.register({
      name: 'settings.section', id: 'workspace-layout', order: 15,
      label: () => t('workspaceLayoutNav'), inject: () => injected,
    }, SideCardSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', key: 'workspace-layout',
  }, IconPanelRightOutline16))

  ctx.effect(() => {
    const mounted = new Map<string, { descriptor: TabDescriptor; dispose: () => void }>()
    let viewers: readonly FileViewerDescriptor[] = []
    let disposeViewerItems: (() => void) | undefined
    const sync = () => {
      const nextViewers = injected.service.getFileViewers()
      if (nextViewers.length !== viewers.length || nextViewers.some((viewer, index) => viewer !== viewers[index])) {
        disposeViewerItems?.()
        viewers = nextViewers
        disposeViewerItems = ctx.settingsMetadata.registerItems('files', viewers.flatMap(viewer => items(viewer, true)))
      }
      const visible = new Map(injected.service.getTabs().filter(feature => !feature.hidden).map(feature => [feature.id, feature]))
      for (const [id, current] of mounted) {
        if (visible.get(id) === current.descriptor) continue
        current.dispose()
        mounted.delete(id)
      }
      for (const [id, feature] of visible) {
        if (mounted.has(id)) continue
        const page: FeaturePage = BUILTIN_PAGES[id] ?? {
          sectionId: 'feature:' + id, group: 'extensions', order: feature.order ?? 100, embedded: false,
        }
        const featureProps = () => ({ ...injected, featureId: id, embedded: page.embedded })
        const disposers: Array<() => void> = [ctx.settingsMetadata.registerItems(page.sectionId, items(feature))]
        if (page.embedded) {
          disposers.push(ctx.slots.inject('settings.section.extension', () => ctx.slots.register({
            name: 'settings.section.extension', key: page.sectionId, inject: featureProps,
          }, SideCardSection)))
        } else {
          disposers.push(ctx.slots.inject('settings.section', function* () {
            yield ctx.settingsMetadata.registerSection({ sectionId: page.sectionId, groupId: page.group })
            yield ctx.slots.register({
              name: 'settings.section', id: page.sectionId, order: page.order,
              label: () => title(feature), inject: featureProps,
            }, SideCardSection)
          }))
          disposers.push(ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon', key: page.sectionId,
          }, ({ size }: { size: number }) => createElement(Fragment, null,
            typeof feature.icon === 'function' ? feature.icon(size) : feature.icon ?? createElement(IconPanelRightOutline16, { size }),
          ))))
        }
        mounted.set(id, { descriptor: feature, dispose: () => { for (const dispose of disposers.reverse()) dispose() } })
      }
    }
    sync()
    const unsubscribe = injected.service.subscribe(sync)
    return () => {
      unsubscribe()
      disposeViewerItems?.()
      for (const current of mounted.values()) current.dispose()
      mounted.clear()
    }
  }, 'better-sidebar: feature settings navigation')
}
