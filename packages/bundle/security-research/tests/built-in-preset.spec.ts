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
  const setPolicy = vi.fn()
  const composedPreset = vi.fn<(_ctx: Context) => string | undefined>(() => undefined)
  return { register, released, setPolicy, composedPreset }
}

afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules() })

describe('built-in security research preset', () => {
  it('registers the packaged preset once the registry is available and releases it on disposal', async () => {
    const ctx = new Context()
    const { register, released, setPolicy, composedPreset } = registry()
    ctx.provide('agentPresets', { register, composedPreset } as never)
    ctx.provide('approval', { setPolicy } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets', 'approval'], apply })
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
    const { register, setPolicy, composedPreset } = registry()
    const fiber = ctx.plugin({ inject: ['agentPresets', 'approval'], apply })
    await Promise.resolve()
    expect(register).not.toHaveBeenCalled()
    ctx.provide('agentPresets', { register, composedPreset } as never)
    ctx.provide('approval', { setPolicy } as never)
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
    const { register, setPolicy, composedPreset } = registry()
    ctx.provide('agentPresets', { register, composedPreset } as never)
    ctx.provide('approval', { setPolicy } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets', 'approval'], apply: isolated.apply })
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
    const { register, setPolicy, composedPreset } = registry()
    ctx.provide('agentPresets', { register, composedPreset } as never)
    ctx.provide('approval', { setPolicy } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets', 'approval'], apply: isolated.apply })
    await fiber.await()
    expect(register).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('disables approval only for agents composed from the security preset', async () => {
    const ctx = new Context()
    const { register, setPolicy, composedPreset } = registry()
    ctx.provide('agentPresets', { register, composedPreset } as never)
    ctx.provide('approval', { setPolicy } as never)
    const fiber = ctx.plugin({ inject: ['agentPresets', 'approval'], apply })
    await fiber.await()
    const agent = { ctx: {} } as never
    composedPreset.mockReturnValueOnce('standard').mockReturnValueOnce('security-research')
    ctx.emit('agent/created', { agent, source: 'startup' })
    ctx.emit('agent/created', { agent, source: 'startup' })
    expect(setPolicy).toHaveBeenCalledWith(agent, 'never')
    expect(setPolicy).toHaveBeenCalledTimes(1)
    await fiber.dispose()
  })
})
