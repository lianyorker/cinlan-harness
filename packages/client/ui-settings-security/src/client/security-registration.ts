/** Security skill resource settings plugin and lifecycle owner. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-security-research-controller/remote'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SECURITY_CAPABILITY } from './CapabilitySection.tsx'
import { SecurityResourcesSection, type SecurityResourcesInjected, type SecurityResourceAction } from './SecurityResourcesSection.tsx'
import { createSecurityResourceObserver } from './resource-observer.ts'
import { CAPABILITY_FIELDS } from './settings-fields.ts'
import { CAPABILITY_LOCALE } from './capability-registration.ts'

/** Dependencies owned by the Security registration. */
export const inject = [
  'settingsMetadata', 'slots', 'locale', 'remote', 'remote.securityResearch',
]

/** Register Security Research resources inside its own Cordis fiber. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind('settings.cinlanCapabilities')
  const resources = createSecurityResourceObserver(ctx.remote.securityResearch)
  ctx.effect(() => () => { resources.dispose() }, 'ui-settings-security: security resource observations')
  ctx.on('connection/reset', () => { resources.refresh() })
  const operations = {
    'check-update': () => ctx.remote.securityResearch.checkResourceUpdate(),
    install: () => ctx.remote.securityResearch.installResource(),
    reinstall: () => ctx.remote.securityResearch.reinstallResource(),
    update: () => ctx.remote.securityResearch.updateResource(),
    'install-bundled': () => ctx.remote.securityResearch.installBundledResource(),
    remove: () => ctx.remote.securityResearch.removeResource(),
  } satisfies Record<SecurityResourceAction, () => Promise<unknown>>
  const injectSection = (): SecurityResourcesInjected => ({
    hooks: { securityResources: resources.store }, watch: resources.watch, refresh: resources.refresh,
    run: async (action) => {
      const result = await operations[action]()
      resources.refresh()
      if (!result.ok) throw new Error(t('resourceActionFailed'))
    },
    cancel: async (operationId) => {
      const result = await ctx.remote.securityResearch.cancelResource({ operationId })
      resources.refresh()
      if (!result.ok) throw new Error(t('resourceActionFailed'))
    },
  })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'cinlan-security', groupId: 'tools' })
    yield ctx.settingsMetadata.registerItems('cinlan-security', CAPABILITY_FIELDS.security.map(field => ({
      id: field.title, anchorId: field.anchorId, title: () => t(field.title), description: () => t(field.description),
      keywords: () => [t('securityNav')],
    })))
    yield ctx.slots.register({
      name: 'settings.section', id: 'cinlan-security', order: SECURITY_CAPABILITY.order,
      label: () => t(SECURITY_CAPABILITY.navKey), locale: CAPABILITY_LOCALE, inject: injectSection,
    }, SecurityResourcesSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', key: 'cinlan-security',
  }, IconSkillOutline16))
}
