import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { AgentLoopCardController, type AgentLoopSettings } from '../src/client/agent-loop-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

describe('AgentLoopCardController', () => {
  it('mirrors the accepted cap and writes every cap through the shared form', async () => {
    const host = stubConfigForm<AgentLoopSettings>()
    acceptWrites(host)
    const controller = new AgentLoopCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { maxParallelToolCalls: 10 },
      base: { maxParallelToolCalls: 10 },
      user: {},
    })
    const face = controller.inject()

    expect(face.hooks.agentLoopCard.getSnapshot()).toMatchObject({
      available: true, writable: true, maxParallelToolCalls: 10, overridden: false,
    })
    face.setMaxParallel(4)
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('maxParallelToolCalls', 4) })

    expect(face.hooks.agentLoopCard.getSnapshot()).toMatchObject({
      maxParallelToolCalls: 4, overridden: true,
    })
  })

  it('clears the override through resetMaxParallel, re-inheriting the composition default', async () => {
    const host = stubConfigForm<AgentLoopSettings>()
    acceptWrites(host)
    const controller = new AgentLoopCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { maxParallelToolCalls: 4 },
      base: { maxParallelToolCalls: 10 },
      user: { maxParallelToolCalls: 4 },
    })
    const face = controller.inject()
    expect(face.hooks.agentLoopCard.getSnapshot().overridden).toBe(true)

    face.resetMaxParallel()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('maxParallelToolCalls') })

    expect(face.hooks.agentLoopCard.getSnapshot()).toMatchObject({
      maxParallelToolCalls: 10, overridden: false,
    })
  })

  it('reports an unserved namespace and a read-only document so the row can disable its control', () => {
    const host = stubConfigForm<AgentLoopSettings>()
    const controller = new AgentLoopCardController(host.scope)

    host.publish({ status: 'unavailable', writable: false, value: { maxParallelToolCalls: 10 } })

    expect(controller.inject().hooks.agentLoopCard.getSnapshot()).toMatchObject({
      available: false, writable: false,
    })
  })
})
