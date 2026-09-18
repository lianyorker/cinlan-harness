// @vitest-environment jsdom
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, vi } from 'vitest'
import { inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { detectOrchestrationCoverage, coverageSummary } from '../src/client/view.ts'
import { en, zh } from '../src/client/locales.ts'
import { bench, declare } from './fixture.client.ts'

type Preset = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
function preset(id: string, rows: Preset['rows'], broken?: string): Preset {
  return { id, trust: 'system', isDefault: false, rows, ...broken === undefined ? {} : { broken } }
}
function workflow(enabled: boolean | 'conditional', fiberPhase: Preset['rows'][number]['fiberPhase'] = null): Preset['rows'][number] {
  return { entryId: null, moduleName: '@deepseek-ai/dsh-tool-workflow', enabled, fiberPhase }
}

describe('orchestration registration and operations', () => {
  it('declares the services it reads and keeps the Host entry inert', () => {
    expect(inject).toEqual(['settingsMetadata', 'settingsScope', 'slots', 'locale', 'remote', 'remote.pluginInventory'])
    expect(hostApply).not.toThrow()
  })

  it('registers localized, value-free search entries with page and icon lifetimes', async () => {
    const b = await bench(false)
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    const release = declare(b.ctx.slots)
    await vi.waitFor(() => { expect(b.ctx.slots.entries('settings.section')).toHaveLength(1) })
    const section = b.ctx.slots.entries('settings.section')[0]!
    expect(resolveSlotLabel(section.options.label)).toBe(en.nav)
    expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toEqual([
      'orchestration-parallelism', 'orchestration-workflow-limits', 'orchestration-coverage', 'orchestration-examples',
    ])
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(section.options.label)).toBe(zh.nav)
    expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(zh.parallelismLabel)
    expect(b.pluginInventory.list).not.toHaveBeenCalled()
    expect(b.ctx.slots.entries('settings.section.icon')).toHaveLength(1)
    release()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([]) })
    declare(b.ctx.slots)
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(4) })
    await b.fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(b.ctx.slots.entries('settings.section.icon')).toEqual([])
  })

  it('persists the Host cap with its revision, restores inheritance, and reloads on reconnect', async () => {
    const b = await bench()
    const face = b.face()
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().status).toBe('ready') })
    expect(await face.saveParallelism(2)).toBe(true)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('agent-loop', [{ op: 'set', path: ['maxParallelToolCalls'], value: 2 }], 1)
    expect(face.hooks.parallelism.getSnapshot().value?.maxParallelToolCalls).toBe(2)
    expect(await face.saveParallelism(null)).toBe(true)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('agent-loop', [{ op: 'unset', path: ['maxParallelToolCalls'] }], 2)
    expect(face.hooks.parallelism.getSnapshot().value?.maxParallelToolCalls).toBe(4)
    b.host.value = 7
    b.host.revision += 1
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().value?.maxParallelToolCalls).toBe(7) })
  })

  it('reports rejected writes and refuses unavailable or read-only settings', async () => {
    const b = await bench()
    const face = b.face()
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().status).toBe('ready') })
    b.host.reject = true
    expect(await face.saveParallelism(9)).toBe(false)
    expect(face.hooks.parallelism.getSnapshot().value?.maxParallelToolCalls).toBe(4)
    b.host.writable = false
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().writable).toBe(false) })
    expect(await face.saveParallelism(3)).toBe(false)
    b.host.available = false
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().status).toBe('unavailable') })
    expect(await face.saveParallelism(3)).toBe(false)
    expect(b.settings.mutate).toHaveBeenCalledTimes(1)
  })

  it('reloads a conflicting revision and waits for an explicit retry', async () => {
    const b = await bench()
    const face = b.face()
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().status).toBe('ready') })
    b.host.revision += 1
    b.host.value = 3
    expect(await face.saveParallelism(8)).toBe(false)
    expect(face.hooks.parallelism.getSnapshot().value?.maxParallelToolCalls).toBe(3)
    expect(b.settings.mutate).toHaveBeenCalledTimes(1)
    expect(await face.saveParallelism(8)).toBe(true)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('agent-loop', [{ op: 'set', path: ['maxParallelToolCalls'], value: 8 }], 2)
  })

  it('does not report success when rejected recovery matches the requested cap or reset', async () => {
    const b = await bench()
    const face = b.face()
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().status).toBe('ready') })
    b.host.overridden = true
    b.host.value = 8
    b.host.revision += 1
    expect(await face.saveParallelism(8)).toBe(false)
    expect(face.hooks.parallelism.getSnapshot().value?.maxParallelToolCalls).toBe(8)
    b.host.overridden = false
    b.host.value = 4
    b.host.revision += 1
    expect(await face.saveParallelism(null)).toBe(false)
    expect(face.hooks.parallelism.getSnapshot().user).toEqual({})
  })

  it('accepts an idempotent mutation when the Host leaves its revision unchanged', async () => {
    const b = await bench()
    const face = b.face()
    await vi.waitFor(() => { expect(face.hooks.parallelism.getSnapshot().status).toBe('ready') })
    b.settings.mutate.mockResolvedValueOnce({ ok: true, value: {
      ...((await b.settings.describe()).value.namespaces[0]!), user: { maxParallelToolCalls: 4 },
    } })
    expect(await face.saveParallelism(4)).toBe(true)
  })

  it('loads only the structured inventory operation', async () => {
    const b = await bench()
    expect(await b.face().loadInventory()).toEqual(b.host.inventory)
    expect(b.pluginInventory.list).toHaveBeenCalledOnce()
    b.pluginInventory.list.mockResolvedValueOnce({ ok: false, error: { message: 'host offline' } } as never)
    await expect(b.face().loadInventory()).rejects.toThrow('host offline')
  })
})

describe('evaluated capability coverage', () => {
  it('distinguishes enablement and lifecycle state, matching exact modules', async () => {
    const coverage = await detectOrchestrationCoverage(async () => ({
      entries: [{ entryId: 'engine' as never, moduleName: '@deepseek-ai/dsh-workflow-worker-thread', enabled: true, fiberPhase: 'active' }],
      agentPresets: [
        preset('active', [workflow(true, 'active'), { ...workflow(true), moduleName: '@deepseek-ai/dsh-tool-subagent' }]),
        preset('configured', [workflow(true), { ...workflow(true), moduleName: '@deepseek-ai/dsh-workflow-worker-thread' }]),
        preset('disabled', [workflow(false)]),
        preset('conditional', [workflow('conditional')]),
        preset('pending', [workflow(true, 'pending')]),
        preset('failed', [workflow(true, 'failed')]),
        preset('lookalike', [{ ...workflow(true), moduleName: '@example/tool-workflow-not-real' }]),
        preset('broken', [], 'invalid composition'),
        preset('mixed', [workflow(false), workflow(true, 'active')]),
      ],
    }))
    expect(coverage.engine).toBe('active')
    expect(coverage.presets.map(row => row.status)).toEqual([
      'active', 'configured', 'disabled', 'conditional', 'pending', 'failed', 'missing', 'broken', 'active',
    ])
    expect(coverage.presets[0]?.subagent).toBe('configured')
    expect(coverage.presets[0]?.engine).toBe('missing')
    expect(coverage.presets[1]?.engine).toBe('configured')
    expect(coverageSummary(coverage)).toEqual({ ready: 3, missing: 4, broken: 2, total: 9 })
  })

  it('discloses absent roster and engine without guessing defaults', async () => {
    expect(await detectOrchestrationCoverage(async () => ({ entries: [] }))).toEqual({ engine: 'missing', presets: [] })
  })
})
