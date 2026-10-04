/**
 * Default responses for every Remote endpoint the web assembly calls while
 * booting and rendering with no sessions, no workspaces, and default settings.
 * The comment above each row names the plugin that calls it; endpoints boot
 * never touches stay absent so a new call fails loud. `$events` is built into
 * `RemoteMock`.
 * @module @deepseek-ai/dsh-client-test-runtime/src/assembly/remote-default-responses
 */
import { ok, openStream, type RemoteTable } from '@deepseek-ai/dsh-remote-mock'

/** Default responses of the boot-time Remote endpoints; a spec loads it first and layers its own table on top. */
export const remoteDefaultResponses: RemoteTable = {
  unary: {
    // api-session-controller `sessions.handleConnected()` on `connection/reset`.
    'session/list': ok({ items: [] }),
    // ui-workspace startup with no entries; first-use initialization is ineligible.
    'workspace/initializeDefault': ok(undefined),
    // ui-settings `mirror.ensure()` at apply and again on `connection/reset`.
    'settings/describe': ok({ writable: true, hasDocument: false, namespaces: [] }),
    // ui-model-selection `ModelDirectoryResolver` constructor.
    'session/modelCatalog': ok({
      default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      routableProviders: [],
      groups: [],
      failures: [],
    }),
    // ui-agent-preset hero chip and header label on first mount.
    'agentPresets/list': ok({ presets: [] }),
    // cordis-client-runner `ClientCordisInspectRegistry.sync` at apply and on `connection/reset`.
    'dynamicCordisRunner/syncInspectManifest': ok(null),
    // ui-cordis inventory at apply and on `connection/reset`.
    'dynamicCordisRunner/inventory': ok([]),
    // ui-settings-plugins web-search card `readCredential()` when the settings mirror first publishes.
    'credentials/describe': ok({}),
    // ui-permission-presets `PermissionCatalogDirectory` on its first read for a connection generation.
    'permissionPresets/catalog': ok({ options: [] }),
    // ui-settings-account refreshes details after a stored-grant snapshot.
    'account/getProfile': ok(null),
    'account/getBalance': ok(null),
    // ui-settings-account bonus notice read and acknowledgement at signing in.
    'account/getUnnotifiedBonuses': ok(null),
    'account/ackBonusNotified': ok(true),
    // api-automation-controller client snapshot and catalog at connect
    'automation/snapshot': ok({ status: 'ready', profile: 'web', revision: 0, automations: [] }),
    'automation/catalog': ok({ agentPresets: [], models: [], permissionPresets: [] }),
    // ui-settings-hosts runtime tasks query
    'executionHosts/listRuntimeTasks': ok({ tasks: [] }),
    // ui-settings-mcp initial snapshot
    'mcp/snapshot': ok({ profile: 'test', revision: 0, reconciling: false, servers: [], external: [] }),
  },
  // Stream endpoints the roster opens later than boot; declared so a spec that forgets the script gets a stream miss.
  streams: [
    // api-session-controller `SessionEventStream.follow` when a Session opens.
    'session/follow',
  ],
  stream: {
    // api-session-controller client `apply`: the control stream's opening baseline, then open.
    'session/control': openStream([{ type: 'baseline', value: { projections: {} } }]),
    // ui-settings-account shares the account snapshot across settings and the sidebar menu.
    'account/watch': openStream([{ status: 'signed-out', attempt: null, links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' } }]),
    // api-workspace-controller client `apply`: the follow stream's opening baseline, then open.
    'workspace/follow': openStream([{ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } }]),
    // api-automation-controller client follow stream
    'automation/follow': openStream([{ type: 'baseline', value: { status: 'ready', profile: 'web', revision: 0, automations: [] } }]),
    // ui-settings-hosts targets follow stream
    'executionHosts/follow': openStream([{ current: { hostId: 'local', hostname: 'localhost', pid: 1, platform: 'win32', createdAt: '2026-01-01T00:00:00.000Z' }, targets: [] }]),
    // ui-settings-mcp watch stream
    'mcp/watch': openStream([]),
  },
}
