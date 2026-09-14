// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { OrchestrationSection, type OrchestrationSectionInjected } from '../src/client/OrchestrationSection.tsx'
import { detectOrchestrationCoverage, coverageSummary } from '../src/client/view.ts'
import { en, zh } from '../src/client/locales.ts'
import type { AgentPresetRow, AgentPresetDocument } from '@deepseek-ai/dsh-agent-presets/types'

function presetRow(id: string, broken?: string): AgentPresetRow {
  return { id, trust: 'system', isDefault: false, ...broken !== undefined ? { broken } : {} }
}

function presetDoc(id: string, content: string): AgentPresetDocument {
  return { agentPreset: id, trust: 'system', content }
}

async function bench(presets: readonly AgentPresetRow[] = [], docs: Record<string, string> = {}) {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const agentPresets = {
    list: vi.fn(async () => ({ ok: true as const, value: { presets, authorable: true } })),
    read: vi.fn(async (id: string) => {
      if (id in docs) return { ok: true as const, value: presetDoc(id, docs[id]!) }
      return { ok: false as const, error: { code: 'agent-preset/not-found', message: `preset "${id}" not found`, details: { agentPreset: id, available: [] } } }
    }),
  }
  ctx.provide('remote', { agentPresets, $host: { home: undefined, isLoopback: true }, $on: () => () => {} } as never)
  ctx.provide('remote.agentPresets', agentPresets as never)
  await ctx.plugin(SlotRegistry).await()
  return { ctx, locale, slots: ctx.slots, agentPresets }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.section.icon': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-orchestration registration', () => {
  it('declares the Remote namespaces it reads', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.agentPresets'])
  })

  it('registers one localized section and icon, without eager reads', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(OrchestrationSection)
    expect(section.options).toMatchObject({ id: 'orchestration', order: 30 })
    expect(section.locale).toBe('settings.orchestration')
    expect(resolveSlotLabel(section.options.label)).toBe(zh.nav)

    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe(en.nav)

    expect(b.agentPresets.list).not.toHaveBeenCalled()
    expect(b.agentPresets.read).not.toHaveBeenCalled()

    const icons = b.slots.entries('settings.section.icon')
    expect(icons).toHaveLength(1)
    expect(icons[0]!.options.key).toBe('orchestration')
    expect(icons[0]!.component).toBe(IconBranchOutline16)

    hostApply()
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.slots.entries('settings.section.icon')).toEqual([])
    await b.ctx.fiber.dispose()
  })

  it('waits for the settings declaration and follows its lifetime', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toEqual([])

    const release = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    release()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toEqual([]) })
    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })
})

describe('detectOrchestrationCoverage', () => {
  it('marks presets whose composition includes tool-workflow as ready', async () => {
    const presets = [presetRow('alpha'), presetRow('beta')]
    const docs: Record<string, string> = {
      alpha: 'plugins:\n  - tool-workflow\n  - tool-read',
      beta: 'plugins:\n  - tool-read',
    }
    const list = async () => presets
    const read = async (id: string) => presetDoc(id, docs[id]!)
    const coverage = await detectOrchestrationCoverage(list, read)
    expect(coverage.presets).toHaveLength(2)
    expect(coverage.presets[0]!.status).toBe('ready')
    expect(coverage.presets[1]!.status).toBe('missing')
  })

  it('marks broken presets as broken without reading their composition', async () => {
    const presets = [presetRow('broken-preset', 'composition error')]
    const read = vi.fn(async (id: string) => presetDoc(id, ''))
    const list = async () => presets
    const coverage = await detectOrchestrationCoverage(list, read)
    expect(coverage.presets[0]!.status).toBe('broken')
    expect(read).not.toHaveBeenCalled()
  })

  it('returns an empty result when no presets exist', async () => {
    const list = async () => []
    const read = vi.fn(async (id: string) => presetDoc(id, ''))
    const coverage = await detectOrchestrationCoverage(list, read)
    expect(coverage.presets).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })
})

describe('coverageSummary', () => {
  it('counts presets by status', () => {
    const coverage = {
      presets: [
        { preset: presetRow('a'), status: 'ready' as const },
        { preset: presetRow('b'), status: 'ready' as const },
        { preset: presetRow('c'), status: 'missing' as const },
        { preset: presetRow('d', 'err'), status: 'broken' as const },
      ],
    }
    const summary = coverageSummary(coverage)
    expect(summary).toEqual({ ready: 2, missing: 1, broken: 1, total: 4 })
  })
})

describe('OrchestrationSection injected face', () => {
  it('reads the roster and documents through the remote agentPresets namespace', async () => {
    const b = await bench(
      [presetRow('alpha'), presetRow('beta')],
      { alpha: 'tool-workflow', beta: 'tool-read' },
    )
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const section = b.slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => OrchestrationSectionInjected)()

    const presets = await injected.list()
    expect(presets).toHaveLength(2)
    expect(b.agentPresets.list).toHaveBeenCalledOnce()

    const doc = await injected.read('alpha')
    expect(doc.content).toBe('tool-workflow')
    expect(b.agentPresets.read).toHaveBeenCalledWith('alpha')
    await b.ctx.fiber.dispose()
  })

  it('surfaces a Remote failure message from the list callback', async () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const agentPresets = {
      list: vi.fn(async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'presets offline', details: {} } })),
      read: vi.fn(async () => ({ ok: true as const, value: presetDoc('x', '') })),
    }
    ctx.provide('remote', { agentPresets, $host: { home: undefined, isLoopback: true }, $on: () => () => {} } as never)
    ctx.provide('remote.agentPresets', agentPresets as never)
    await ctx.plugin(SlotRegistry).await()
    declare(ctx.slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = ctx.slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => OrchestrationSectionInjected)()
    await expect(injected.list()).rejects.toThrow('presets offline')
    await ctx.fiber.dispose()
  })
})
