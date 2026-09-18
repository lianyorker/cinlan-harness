/** MCP settings contribution; apply owns Remote streams and connection cancellation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import { createMcpSettingsStore } from './store.ts'
import { McpSettingsSource } from './source.ts'
import { draftRequest } from './draft.ts'
import { McpSettingsSection, type McpSettingsInjected } from './McpSettingsSection.tsx'
import { en, zh, type McpKey } from './locales.ts'

export { createMcpSettingsStore } from './store.ts'
export type { McpSettingsInjected, McpSettingsSectionProps } from './McpSettingsSection.tsx'
export type { McpDraft, ReferenceDraft } from './draft.ts'
export type { McpReadback, McpUiError } from './source.ts'
export type { McpSettingsState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** MCP management labels and safe errors. */
    'settings.mcp': McpKey
  }
}

/** Services required for typed commands, live readback, locale and settings registration. */
export const inject = ['slots', 'settingsMetadata', 'locale', 'remote', 'remote.mcp', 'connection']

/**
 * Register native MCP settings and dispose all readback work with the plugin.
 * @param ctx - injected browser context.
 */
export function apply(ctx: Context): void {
  const namespace = 'settings.mcp'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'ui-settings-mcp: dictionaries')
  const t = ctx.locale.bind(namespace)
  const source = new McpSettingsSource(ctx.remote.mcp)
  const store = createMcpSettingsStore()
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => {
    const refresh = (): void => { source.connect(connection.generation.getSnapshot()?.id) }
    const unsubscribe = connection.generation.subscribe(refresh)
    refresh()
    return async () => { unsubscribe(); await source.dispose() }
  }, 'ui-settings-mcp: readback lifetime')
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'mcp', groupId: 'experimental' })
    yield ctx.settingsMetadata.registerItems('mcp', [
      { id: 'server-list', anchorId: 'mcp-server-list', title: () => t('serverList'), description: () => t('serverListHelp') },
      { id: 'add-server', anchorId: 'mcp-add-server', title: () => t('add'), description: () => t('addHelp'), keywords: () => [t('serverName'), t('enabled')] },
      { id: 'transport', anchorId: 'mcp-transport', title: () => t('transport'), description: () => t('transportHelp'), keywords: () => [t('command'), t('args'), t('cwd'), t('url')] },
      { id: 'credentials', anchorId: 'mcp-credentials', title: () => t('credentials'), description: () => t('credentialsHelp'), keywords: () => [t('env'), t('headers'), t('prefix')] },
      { id: 'tools', anchorId: 'mcp-tools', title: () => t('tools'), description: () => t('toolsHelp'), keywords: () => [t('refreshTools'), t('reconnect')] },
    ])
    yield ctx.slots.register({
      name: 'settings.section', id: 'mcp', order: 17, label: () => t('nav'), locale: namespace, store,
      inject: (actions: BoundActions<typeof store>): McpSettingsInjected => ({
        hooks: { mcp: source.state },
        retry: () => { source.restart() },
        save: async (draft) => {
          const request = draftRequest(draft)
          if (request === undefined) { source.invalidDraft(); return false }
          const saved = await source.save(request)
          if (saved) actions.cancel()
          return saved
        },
        remove: async (request) => {
          const removed = await source.remove(request)
          if (removed) actions.confirmRemove(null)
          return removed
        },
        setEnabled: request => source.setEnabled(request), reconnect: request => source.reconnect(request),
        probe: request => source.probe(request),
      }),
    }, McpSettingsSection)
  })
}
