import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import { MemorySettings } from './memory.ts'

const schema = Schema.object({ value: Schema.number().default(1) })

describe('settings namespace lifecycle', () => {
  it('announces committed registration and disposal without document writes or revision changes', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(MemorySettings, { doc: { fixture: { value: 7 } } })
      const observations: Array<{ ns: string; names: string[] }> = []
      const documentChanged = vi.fn()
      ctx.on('settings/namespaces-updated', (ns) => { observations.push({ ns, names: ctx.settings.describe().map(row => row.ns) }) })
      ctx.on('settings/document-updated', documentChanged)
      const owner = { inject: ['settings'], apply(scope: Context) { scope.settings.register('fixture', schema) } }
      const fiber = await ctx.plugin(owner)
      expect(observations).toEqual([{ ns: 'fixture', names: ['fixture'] }])
      expect(ctx.settings.describe()[0]).toMatchObject({ value: { value: 7 }, revision: 0 })
      expect(() => ctx.settings.register('fixture', schema)).toThrow('already registered')
      expect(observations).toHaveLength(1)
      await fiber.dispose()
      await fiber.dispose()
      expect(observations).toEqual([{ ns: 'fixture', names: ['fixture'] }, { ns: 'fixture', names: [] }])
      const replacement = await ctx.plugin(owner)
      expect(ctx.settings.describe()[0]).toMatchObject({ value: { value: 7 }, revision: 0 })
      await replacement.dispose()
      expect(observations).toHaveLength(4)
      expect(documentChanged).not.toHaveBeenCalled()
      expect((ctx.settings as MemorySettings).persisted).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('does not announce failed initial validation', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(MemorySettings, { doc: { fixture: { value: 'invalid' } } })
      const changed = vi.fn()
      ctx.on('settings/namespaces-updated', changed)
      expect(() => ctx.settings.register('fixture', schema)).toThrow()
      expect(changed).not.toHaveBeenCalled()
      expect(ctx.settings.describe()).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('contains sync and async observer failures through activation and disposal', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(MemorySettings)
      vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      const changed = vi.fn()
      ctx.on('settings/namespaces-updated', () => { throw new Error('observer failed') })
      // oxlint-disable-next-line typescript/no-misused-promises -- exercise containment of an async event observer rejection
      ctx.on('settings/namespaces-updated', async () => { throw new Error('async observer failed') })
      ctx.on('settings/namespaces-updated', changed)
      const fiber = await ctx.plugin({ inject: ['settings'], apply(scope: Context) { scope.settings.register('fixture', schema) } })
      expect(changed).toHaveBeenCalledTimes(1)
      await fiber.dispose()
      await Promise.resolve()
      expect(changed).toHaveBeenCalledTimes(2)
      expect(ctx.settings.describe()).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })
})
