/** Quick-commands settings card: the browser half over the durable Remote. */

// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings page's SlotMap merges.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-terminal-quick-commands-controller/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { QuickCommand, QuickCommandDraft, QuickCommandHostId, QuickCommandId, QuickCommandWireResult } from '@deepseek-ai/dsh-api-terminal-quick-commands-controller/types'
import { QuickCommandsCard, type QuickCommandsCardInjected } from './QuickCommandsCard.tsx'
import { en, zh } from './locales.ts'

export type { QuickCommandsCardInjected } from './QuickCommandsCard.tsx'

const NS = 'settings.quickCommands'

/** Required services: settings page seats plus the Remote namespace. */
export const inject = ['slots', 'locale', 'settingsMetadata', 'remote', 'remote.terminalQuickCommands']

/** The host id this Host process owns; one Host stores its own catalog. */
const OWN_HOST: QuickCommandHostId = 'local' as QuickCommandHostId

/**
 * Mount the quick-commands settings section while the Host serves the namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const remote = (): NonNullable<ClientContext['remote']>['terminalQuickCommands'] => ctx.remote?.terminalQuickCommands
  const list: QuickCommandsCardInjected['list'] = async (hostId: QuickCommandHostId) => {
    const result = await remote().list({ hostId })
    if (!result.ok) throw new Error(`terminalQuickCommands.list failed: ${result.error.code}`)
    return result.value as { commands: readonly QuickCommand[]; hosts: readonly QuickCommandHostId[] }
  }
  const create: QuickCommandsCardInjected['create'] = async (draft: QuickCommandDraft): Promise<QuickCommandWireResult> => {
    const result = await remote().create({ draft })
    if (!result.ok) throw new Error(`terminalQuickCommands.create failed: ${result.error.code}`)
    return result.value
  }
  const update: QuickCommandsCardInjected['update'] = async (id: string, draft: QuickCommandDraft): Promise<QuickCommandWireResult> => {
    const result = await remote().update({ id: id as QuickCommandId, draft })
    if (!result.ok) throw new Error(`terminalQuickCommands.update failed: ${result.error.code}`)
    return result.value
  }
  const remove: QuickCommandsCardInjected['remove'] = async (id: string): Promise<QuickCommandWireResult> => {
    const result = await remote().delete({ id: id as QuickCommandId })
    if (!result.ok) throw new Error(`terminalQuickCommands.delete failed: ${result.error.code}`)
    return result.value
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-quick-commands: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({
      sectionId: 'quick-commands', groupId: 'workspace',
      title: () => t('title'), description: () => t('description'),
    })
    yield ctx.settingsMetadata.registerItems('quick-commands', [{
      id: 'quick-commands-catalog', anchorId: 'quick-commands-catalog',
      title: () => t('nav'), description: () => t('description'),
      keywords: () => [t('title'), 'quick', 'commands', 'terminal', '快捷', '命令', '终端'],
    }])
    yield ctx.slots.register({
      name: 'settings.section', id: 'quick-commands', order: 44, label: () => t('nav'), locale: NS,
      inject: (): QuickCommandsCardInjected => ({ list, create, update, remove }),
    }, QuickCommandsCard)
  }), 'ui-quick-commands: settings page')
  void OWN_HOST
}
