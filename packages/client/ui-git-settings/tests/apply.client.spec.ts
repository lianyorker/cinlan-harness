/** Client tests for ui-git-settings: slot registration, locale, and settings scope binding. */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'

function createMockCtx(): Context {
  const sections: { id: string; order: number; locale: string }[] = []
  const locales: Record<string, unknown> = {}
  const scopes: { namespace: string }[] = []

  const ctx = {
    effect: vi.fn((fn: () => unknown, _label: string) => {
      fn()
      return () => {}
    }),
    locale: {
      register: vi.fn((ns: string, dict: unknown) => { locales[ns] = dict }),
      bind: vi.fn((ns: string) => (key: string, params?: Record<string, string | number>) => {
        const dict = (locales[ns] as Record<string, string>) ?? {}
        let result = dict[key] ?? key
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            result = result.replace(`{${k}}`, String(v))
          }
        }
        return result
      }),
    },
    slots: {
      inject: vi.fn((_slot: string, register: () => unknown) => {
        register()
        return () => {}
      }),
      register: vi.fn((opts: { id: string; order: number; locale: string }, _component: unknown) => {
        sections.push({ id: opts.id, order: opts.order, locale: opts.locale })
        return () => {}
      }),
    },
    settingsScope: {
      bind: vi.fn((spec: { namespace: string }) => {
        scopes.push(spec)
        return {
          getSnapshot: () => ({ status: 'ready', value: {}, revision: 1, writable: true, mode: 'host' }),
          subscribe: () => () => {},
          set: vi.fn(),
          unset: vi.fn(),
          mutate: vi.fn(),
        }
      }),
    },
  } as unknown as Context

  return ctx
}

describe('ui-git-settings apply', () => {
  it('registers locale dictionaries', () => {
    const ctx = createMockCtx()
    apply(ctx)
    const effectCalls = (ctx as unknown as { effect: ReturnType<typeof vi.fn> }).effect.mock.calls
    const registerCall = effectCalls.find((call: unknown[]) => call[1] === 'ui-git-settings: dictionaries')
    expect(registerCall).toBeDefined()
  })

  it('registers settings.section with id git-source-control and order 36', () => {
    const ctx = createMockCtx()
    apply(ctx)
    const sections = (ctx as unknown as { slots: { register: ReturnType<typeof vi.fn> } }).slots.register.mock.calls
    const sectionCall = sections.find((call: unknown[]) => (call[0] as { name?: string })?.name === 'settings.section')
    expect(sectionCall).toBeDefined()
    const opts = sectionCall![0] as { id: string; order: number; locale: string }
    expect(opts.id).toBe('git-source-control')
    expect(opts.order).toBe(36)
    expect(opts.locale).toBe('settings.gitSourceControl')
  })

  it('registers settings.section.icon with key git-source-control', () => {
    const ctx = createMockCtx()
    apply(ctx)
    const sections = (ctx as unknown as { slots: { register: ReturnType<typeof vi.fn> } }).slots.register.mock.calls
    const iconCall = sections.find((call: unknown[]) => (call[0] as { name?: string })?.name === 'settings.section.icon')
    expect(iconCall).toBeDefined()
    const opts = iconCall![0] as { key: string }
    expect(opts.key).toBe('git-source-control')
  })

  it('binds settingsScope to namespace git-source-control', () => {
    const ctx = createMockCtx()
    apply(ctx)
    const scopes = (ctx as unknown as { settingsScope: { bind: ReturnType<typeof vi.fn> } }).settingsScope.bind.mock.calls
    expect(scopes.length).toBe(1)
    expect(scopes[0]![0].namespace).toBe('git-source-control')
  })
})
