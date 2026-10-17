/**
 * The Subagent settings pages, browser half: the delegation limits over the
 * `subagent` namespace and the models agents may choose over the
 * `subagent-model-selection` namespace, one page each. Each page registers
 * into the settings shell's `settings.section` slot while the Host serves its
 * namespace, so a deployment that exposes neither shows no trace of them.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SubagentLimitsSection } from './SubagentLimitsSection.tsx'
import { SubagentModelSelectionSection } from './SubagentModelSelectionSection.tsx'
import { SubagentLimitsCardController } from './subagent-limits-card-controller.ts'
import {
  SUBAGENT_MODEL_SELECTION_NS, SubagentModelSelectionCardController,
} from './subagent-model-selection-card-controller.ts'
import { en, zh, type SubagentSettingsLocaleKey } from './locales.ts'

export type { SubagentLimitsSectionProps } from './SubagentLimitsSection.tsx'
export type { SubagentModelSelectionSectionProps } from './SubagentModelSelectionSection.tsx'
export type { SubagentLimitsCardFace, SubagentLimitsCardState, SubagentLimitsSettings } from './subagent-limits-card-controller.ts'
export type {
  SubagentModelSelectionCardFace, SubagentModelSelectionCardState, SubagentModelSelectionSettings,
} from './subagent-model-selection-card-controller.ts'
export type { SubagentSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Subagent settings pages copy. */
    'settings.subagent': SubagentSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.subagent'

/**
 * Namespace of the delegation limits. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const SUBAGENT_NS = 'subagent'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'configForms', 'settingsMetadata']

/**
 * Mount the Subagent settings pages while the Host serves either namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-subagent: dictionaries')
  const limits = new SubagentLimitsCardController(ctx.configForms.get(SUBAGENT_NS))
  ctx.effect(() => () => { limits.dispose() }, 'ui-settings-subagent: limits form subscription')
  const models = new SubagentModelSelectionCardController(
    ctx.configForms.get(SUBAGENT_MODEL_SELECTION_NS),
    ctx,
  )
  const limitsFace = limits.inject()
  const modelsFace = models.inject()
  // The model catalogue is not part of any settings section: adapters come and
  // go, and a document commit elsewhere can change which routes are stored.
  ctx.effect(
    () => ctx.remote.$on('llm/adapters-updated', () => { models.refreshCatalog() }),
    'ui-settings-subagent: adapter invalidations',
  )
  ctx.effect(
    () => ctx.remote.$on('settings/document-updated', () => { models.refreshCatalog() }),
    'ui-settings-subagent: settings invalidations',
  )
  ctx.effect(
    () => ctx.on('connection/reset', () => { models.resetConnection() }),
    'ui-settings-subagent: connection generation',
  )
  ctx.effect(() => () => { models.dispose() }, 'ui-settings-subagent: model preference')
  ctx.effect(() => ctx.configForms.whileServed([SUBAGENT_MODEL_SELECTION_NS], () =>
    ctx.slots.inject('settings.section', function* () {
      yield ctx.settingsMetadata.registerSection({
        sectionId: 'subagent', groupId: 'ai', description: () => t('subagentDescription'),
      })
      yield ctx.settingsMetadata.registerItems('subagent', [{
        id: 'subagent-model-selection', anchorId: 'subagent-model-selection',
        title: () => t('nav'), description: () => t('subagentDescription'),
        keywords: () => [t('subagentModelSelectionToggle'), t('subagentTitle'), t('nav'), 'subagent', 'model', 'delegation'],
      }])
      yield ctx.slots.register({
        name: 'settings.section', id: 'subagent', order: 21, label: () => t('nav'), locale: NS,
        inject: () => modelsFace,
      }, SubagentModelSelectionSection)
    })), 'ui-settings-subagent: model-selection page')
  ctx.effect(() => ctx.configForms.whileServed([SUBAGENT_NS], () =>
    ctx.slots.inject('settings.section', function* () {
      yield ctx.settingsMetadata.registerSection({
        sectionId: 'subagent-limits', groupId: 'ai', description: () => t('subagentLimitsDescription'),
      })
      yield ctx.settingsMetadata.registerItems('subagent-limits', [{
        id: 'subagent-limits', anchorId: 'subagent-limits',
        title: () => t('subagentLimitsTitle'), description: () => t('subagentLimitsDescription'),
        keywords: () => [t('subagentMaxDepth'), t('subagentMaxActive'), t('subagentLimitsTitle'), 'subagent', 'limits', 'depth'],
      }])
      yield ctx.slots.register({
        name: 'settings.section', id: 'subagent-limits', order: 22, label: () => t('subagentLimitsTitle'), locale: NS,
        inject: () => limitsFace,
      }, SubagentLimitsSection)
    })), 'ui-settings-subagent: limits page')

}
