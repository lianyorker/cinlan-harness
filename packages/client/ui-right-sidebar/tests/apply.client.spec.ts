/** Registration and lifecycle tests. */
import { describe, it, expect, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/client/index.tsx'

describe('ui-right-sidebar apply', () => {
  it('exports required metadata', () => {
    expect(name).toBe('ui-right-sidebar')
    expect(inject).toEqual([
      'sidebarRightTabs', 'slots', 'locale', 'remote',
      'remote.worktreeTasks', 'remote.workspaceIsolation',
    ])
  })

  it('registers definitions, dictionaries, and bodies through effects', () => {
    const effects: Array<() => unknown> = []
    const mockContext = {
      effect: vi.fn((fn: () => unknown) => { effects.push(fn); return fn() }),
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      sidebarRightTabs: { register: vi.fn(() => () => {}) },
      slots: {
        inject: vi.fn((_name: string, factory: () => unknown) => { factory(); return () => {} }),
        register: vi.fn(() => () => {}),
      },
      remote: { worktreeTasks: {}, workspaceIsolation: {} },
    } as unknown as ClientContext

    expect(() => apply(mockContext)).not.toThrow()
    expect(effects.length).toBeGreaterThan(0)
    expect(mockContext.locale.register).toHaveBeenCalled()
    expect(mockContext.sidebarRightTabs.register).toHaveBeenCalledTimes(4)
    expect(mockContext.slots.register).toHaveBeenCalledTimes(5)
  })
})
