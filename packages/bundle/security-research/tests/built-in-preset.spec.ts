/** The packaged Security Research preset registers for every composition that mounts this bundle. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { apply } from '../src/index.ts'

/** One submitted preset definition, read back through the recording registry. */
interface Registration {
  readonly id?: string
  readonly name?: string
  readonly order?: number
  readonly plugins: readonly unknown[]
}

function registry() {
  const released = vi.fn(async () => {})
  const register = vi.fn(async (_definition: Registration) => released)
  return { register, released }
}

afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules() })

describe('built-in security research preset', () => {
  it('registers the packaged preset once the registry is available and releases it on disposal', async () => {
    const ctx = new Context()
    const { register, released } = registry()
    ctx.provide('agentPresets', { register } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets'], apply })
    await fiber.await()
    expect(register).toHaveBeenCalledOnce()
    const definition = register.mock.calls[0]![0] as Registration
    expect(definition).toMatchObject({ id: 'security-research', order: 3 })
    expect(definition.plugins.length).toBeGreaterThan(0)
    // A shipped preset publishes no copy: the client dictionaries own its name and description.
    expect(definition).not.toHaveProperty('name')
    expect(definition).not.toHaveProperty('description')
    await fiber.dispose()
    expect(released).toHaveBeenCalledOnce()
  })

  it('waits for the preset registry instead of registering without one', async () => {
    const ctx = new Context()
    const { register } = registry()
    const fiber = ctx.plugin({ inject: ['agentPresets'], apply })
    await Promise.resolve()
    expect(register).not.toHaveBeenCalled()
    ctx.provide('agentPresets', { register } as never)
    await fiber.await()
    expect(register).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('omits an order a minimal preset file does not declare', async () => {
    vi.resetModules()
    const { readFileSync } = await import('node:fs')
    vi.doMock('node:fs', async importOriginal => ({
      ...await importOriginal<typeof import('node:fs')>(),
      readFileSync: (path: Parameters<typeof readFileSync>[0], ...rest: unknown[]) =>
        String(path).endsWith('preset.yml') ? '{}' : (readFileSync as (...args: unknown[]) => string)(path, ...rest),
    }))
    const isolated = await import('../src/index.ts')
    const ctx = new Context()
    const { register } = registry()
    ctx.provide('agentPresets', { register } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets'], apply: isolated.apply })
    await fiber.await()
    const definition = register.mock.calls[0]![0] as Registration
    expect(definition).not.toHaveProperty('order')
    await fiber.dispose()
  })

  it('registers nothing when the packaged preset files cannot be read', async () => {
    vi.resetModules()
    vi.doMock('node:fs', async importOriginal => ({
      ...await importOriginal<typeof import('node:fs')>(),
      readFileSync: () => { throw new Error('missing preset') },
    }))
    const isolated = await import('../src/index.ts')
    const ctx = new Context()
    const { register } = registry()
    ctx.provide('agentPresets', { register } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets'], apply: isolated.apply })
    await fiber.await()
    expect(register).not.toHaveBeenCalled()
    await fiber.dispose()
  })
})
