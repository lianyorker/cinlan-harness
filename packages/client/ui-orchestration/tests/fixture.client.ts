/** Test composition using the real settings mirror and mutation queue. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginInventorySnapshot, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { OrchestrationSectionInjected } from '../src/client/OrchestrationSection.tsx'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Declare the shell-owned page and icon slots. */
export function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.section.icon': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
}

/** Mount the browser owner against a controlled Host transport. */
export async function bench(declared = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const host = {
    revision: 1, value: 4, overridden: false, writable: true, available: true, reject: false,
    inventory: { entries: [], agentPresets: [] } as PluginInventorySnapshot,
  }
  const view = (): SettingsNamespaceView => ({
    ns: 'agent-loop', revision: host.revision, applies: 'live', secrets: [],
    schema: { type: 'object', dict: { maxParallelToolCalls: { type: 'number', meta: { min: 1, step: 1 } } } },
    value: { maxParallelToolCalls: host.value }, base: { maxParallelToolCalls: 4 },
    user: host.overridden ? { maxParallelToolCalls: host.value } : {},
  })
  const settings = {
    describe: vi.fn(async () => ({ ok: true as const, value: {
      writable: host.writable, hasDocument: true, namespaces: host.available ? [view()] : [],
    } })),
    mutate: vi.fn(async (_ns: string, ops: readonly SettingsPathOpView[], revision?: number) => {
      if (host.reject || revision !== host.revision) return {
        ok: false as const, error: new RemoteError('settings/rejected', 'conflict', { ns: 'agent-loop' }),
      }
      const op = ops[0]!
      host.value = op.op === 'unset' ? 4 : Number(op.value)
      host.overridden = op.op !== 'unset'
      host.revision += 1
      return { ok: true as const, value: view() }
    }),
  }
  const remote = new TestRemote(ctx, { settings })
  const pluginInventory = { list: vi.fn(async () => ({ ok: true as const, value: host.inventory })) }
  Object.assign(remote, { pluginInventory })
  ctx.provide('remote.pluginInventory', pluginInventory as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const release = declared ? declare(ctx.slots) : undefined
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const face = (): OrchestrationSectionInjected =>
    (ctx.slots.entries('settings.section')[0]!.inject as unknown as () => OrchestrationSectionInjected)()
  return { ctx, locale, host, settings, pluginInventory, fiber, face, release }
}
