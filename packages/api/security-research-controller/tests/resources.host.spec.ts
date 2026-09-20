/** Resource Remote behavior through actual Loader and Gateway services. */
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import SecurityResearchController from '../src/index.ts'

async function missingManagerFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-security-resource-remote-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const config = join(root, 'cordis.yml')
  await writeFile(config, await readFile(new URL('./resources.fixture.yml', import.meta.url)))
  const ctx = await boot('security-resource-remote-fixture', config, [], (context) => {
    onTestFinished(async () => {
      await context.fiber.dispose()
      while (context.fiber.inertia !== undefined) await context.fiber.inertia
    })
    Object.assign(context.loader.builtins, {
      'security-resource-fixture-typert': TypertRegistry,
      'security-resource-fixture-gateway': TypertGateway,
      'security-resource-fixture-controller': SecurityResearchController,
    })
  })
  const access = createTrustedConnectionAccess()
  const call = (method: string, request?: unknown) => ctx.typertGateway.invoke({
    access, namespace: 'securityResearch', method, args: request === undefined ? {} : { request },
  })
  return { ctx, call }
}

const mutations = [
  'checkResourceUpdate', 'installResource', 'reinstallResource', 'updateResource',
  'installBundledResource', 'removeResource',
] as const

describe('Security resource Remotes without an optional manager', () => {
  it('reports the missing component through the real Remote and refuses mutations explicitly', async () => {
    const { call } = await missingManagerFixture()
    expect(await call('describeResources')).toEqual({ state: 'unavailable', reason: 'component-missing' })
    for (const method of mutations) {
      await expect(call(method)).rejects.toMatchObject({ code: 'security-research/resources-unavailable' })
    }
    await expect(call('cancelResource', { operationId: 'absent-operation' }))
      .rejects.toMatchObject({ code: 'security-research/resources-unavailable' })
  })

  it('releases idle and paused observers on controller disposal', async () => {
    const { ctx } = await missingManagerFixture()
    const controller = ctx.securityResearchController
    const signal = new AbortController().signal
    const idle = controller.observeResources(signal)[Symbol.asyncIterator]()
    const paused = controller.observeResources(signal)[Symbol.asyncIterator]()
    expect((await idle.next()).value).toEqual({ state: 'unavailable', reason: 'component-missing' })
    await paused.next()
    expect(ctx.events._hooks['security-skill-resources/changed']).toHaveLength(2)
    const pending = idle.next()
    const entry = ctx.loader.entries().find(row => row.options.id === 'controller')!
    await entry.update({ disabled: true })
    await ctx.loader.await()
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(ctx.events._hooks['security-skill-resources/changed'] ?? []).toHaveLength(0)
    expect(await paused.next()).toEqual({ done: true, value: undefined })
    await entry.update({ disabled: false })
    await ctx.loader.await()
    expect(ctx.securityResearchController).not.toBe(controller)
    expect(await ctx.securityResearchController.describeResources(signal))
      .toEqual({ state: 'unavailable', reason: 'component-missing' })
  })

  it('closes the actual carrier without retaining resource listeners', async () => {
    const { ctx } = await missingManagerFixture()
    const abort = new AbortController()
    onTestFinished(() => { abort.abort() })
    const stream = await ctx.typertGateway.wireStream.open(
      'securityResearch/observeResources', { args: {} }, abort.signal, createTrustedConnectionAccess(),
    )
    const iterator = stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toEqual({ state: 'unavailable', reason: 'component-missing' })
    const pending = iterator.next()
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(ctx.events._hooks['security-skill-resources/changed'] ?? []).toHaveLength(0)
  })

  it('checks caller cancellation before admitting an action or observation', async () => {
    const { ctx } = await missingManagerFixture()
    const signal = AbortSignal.abort(new Error('caller left before admission'))
    await expect(ctx.securityResearchController.describeResources(signal)).rejects.toThrow('caller left before admission')
    for (const method of mutations) expect(() => ctx.securityResearchController[method](signal)).toThrow('caller left before admission')
    await expect(ctx.securityResearchController.observeResources(signal)[Symbol.asyncIterator]().next())
      .rejects.toThrow('caller left before admission')
    expect(ctx.events._hooks['security-skill-resources/changed'] ?? []).toHaveLength(0)
  })
})
