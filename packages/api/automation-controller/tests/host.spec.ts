import { Context } from '@deepseek-ai/cordis'
import { AutomationError } from '@deepseek-ai/dsh-automation'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AutomationController from '../src/index.ts'
import { automationCatalog } from '../src/catalog.ts'
import type { AutomationDraft, AutomationErrorCode, AutomationId, AutomationRunId, AutomationSnapshot } from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
const draft: AutomationDraft = {
  title: 'Daily', prompt: 'Review', workspaceId: 'workspace' as never, agentPresetId: 'coder',
  model: { provider: 'fake', model: 'one' }, permissionPresetId: 'safe', schedule: { kind: 'hourly', minute: 5 },
}
const state = (revision = 1): AutomationSnapshot => ({ status: 'ready', profile: 'profile', revision, definitions: [], activeRuns: [] })

function harness() {
  const ctx = new Context()
  roots.push(ctx)
  let value = state()
  const listeners = new Set<(snapshot: AutomationSnapshot) => void>()
  const runtime = {
    snapshot: vi.fn(() => value),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    create: vi.fn(async (request: AutomationDraft) => ({ id: 'created', spec: request })),
    update: vi.fn(async (request: unknown) => request),
    delete: vi.fn(async () => {}),
    run: vi.fn(async (request: unknown) => request),
    cancel: vi.fn(async () => {}),
    runs: vi.fn(() => ({ runs: [], nextCursor: null })),
    previewSchedule: vi.fn(() => [1, 2, 3, 4, 5]),
  }
  ctx.provide('automationRuntime', runtime as never)
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  const controller = new AutomationController(ctx)
  return { ctx, controller, runtime, listeners,
    commit: (revision: number) => { value = state(revision); for (const listener of listeners) listener(value) },
  }
}

function selectors(ctx: Context) {
  const workspaces = [
    { id: 'present', title: '用户名称', path: '/present', status: async () => 'ok' },
    { id: 'gone', title: 'Gone', path: '/gone', status: async () => 'missing-dir' },
    { id: 'blocked', title: 'Blocked', path: '/blocked', status: async () => { throw new Error('private filesystem detail') } },
  ]
  const presets = [{ id: 'coder', name: '编码', description: 'Preset data' }, { id: 'bad', broken: 'secret path' }]
  const providers = [{ id: 'fake', name: 'Provider source name' }, { id: 'broken', name: 'Broken provider' }]
  const listModels = vi.fn(async (provider: string) => {
    if (provider === 'broken') throw new Error('secret token')
    return [{ provider, id: 'one', name: '模型', description: '模型说明' }]
  })
  let defaultModel = { provider: 'fake', model: 'one' }
  ctx.provide('workspaceRegistry', { list: () => workspaces } as never)
  ctx.provide('agentPresets', { defaultId: 'missing-default', list: async () => presets } as never)
  ctx.provide('agentDefaultModel', { currentSelection: () => defaultModel } as never)
  ctx.provide('llm', { listProviders: () => providers, listModels } as never)
  ctx.provide('permissionPresets', {
    defaultPreset: 'missing-permission', names: ['safe'],
    optionOf: (name: string) => ({ value: name, name: '安全', description: '只读' }),
    resolve: () => ({ sandbox: 'read-only', approval: 'never', name: '安全' }),
  } as never)
  return { listModels, defaultModel: (value: typeof defaultModel) => { defaultModel = value } }
}

describe('AutomationController Host transport', () => {
  it('declares follow as a raw Remote stream and commands as unary methods', () => {
    const { controller } = harness()
    const methods = remoteMethods(controller)
    expect(methods.find(method => method.method === 'follow')).toMatchObject({ mode: 'stream', invocation: { kind: 'direct' } })
    expect(methods.filter(method => method.mode === 'stream')).toHaveLength(1)
    expect(methods).toHaveLength(10)
  })

  it('forwards revision fences, retained admission tokens and request wrappers without owning storage', async () => {
    const { controller, runtime } = harness()
    expect(controller.snapshot()).toEqual(state())
    expect(await controller.create(draft)).toEqual({ id: 'created', spec: draft })
    const id = 'plan' as AutomationId
    const update = { id, expectedRevision: 3, draft, enabled: true }
    await controller.update(update)
    expect(runtime.update).toHaveBeenCalledWith(update)
    await controller.delete({ id, expectedRevision: 3 })
    expect(runtime.delete).toHaveBeenCalledWith({ id, expectedRevision: 3 })
    const request = { id, expectedRevision: 3, requestId: 'retained' as never }
    await controller.run(request)
    expect(runtime.run).toHaveBeenCalledWith(request)
    await controller.cancel({ runId: 'run' as AutomationRunId })
    expect(runtime.cancel).toHaveBeenCalledWith('run')
    expect(await controller.runs({ id, cursor: null, limit: 25 })).toEqual({ runs: [], nextCursor: null })
    expect(runtime.runs).toHaveBeenCalledWith(id, null, 25)
    expect(await controller.previewSchedule({ schedule: draft.schedule, afterUtc: 0 })).toEqual([1, 2, 3, 4, 5])
    expect(runtime.previewSchedule).toHaveBeenCalledWith(draft.schedule, 0)
  })

  it.each<AutomationErrorCode>(['unavailable', 'not-found', 'conflict', 'invalid', 'busy', 'resource', 'storage'])(
    'maps %s to one stable Remote code without leaking the underlying message', async (code) => {
      const { controller, runtime } = harness()
      runtime.create.mockRejectedValueOnce(new AutomationError(code, 'secret '.repeat(1000)))
      const failure = await controller.create(draft).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'automation/operation-failed', details: { code } })
      expect((failure as Error).message.length).toBeLessThan(256)
      expect((failure as Error).message).not.toContain('secret')
    },
  )

  it('normalizes unknown synchronous, asynchronous and catalog exceptions', async () => {
    const { ctx, controller, runtime } = harness()
    runtime.snapshot.mockImplementationOnce(() => { throw new Error('private path') })
    expect(() => controller.snapshot()).toThrow(expect.objectContaining({ code: 'automation/operation-failed', details: { code: 'resource' } }))
    runtime.create.mockRejectedValueOnce('unclassified')
    await expect(controller.create(draft)).rejects.toMatchObject({ details: { code: 'resource' } })
    selectors(ctx)
    vi.spyOn(ctx.agentPresets, 'list').mockRejectedValueOnce(new Error('private discovery path'))
    await expect(controller.catalog()).rejects.toMatchObject({ code: 'automation/operation-failed', details: { code: 'resource' } })
  })

  it('opens a full baseline and coalesces slow readers to the newest full commit', async () => {
    const { controller, commit } = harness()
    const abort = new AbortController()
    const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'baseline', value: state() } })
    for (let revision = 2; revision <= 10000; revision++) commit(revision)
    expect(await iterator.next()).toEqual({ done: false, value: { type: 'snapshot', value: state(10000) } })
    const waiting = iterator.next()
    abort.abort()
    expect(await waiting).toMatchObject({ done: true })
  })

  it('retires subscriptions and wakes idle followers on Host HMR disposal', async () => {
    const { controller, ctx, listeners } = harness()
    const iterator = controller.follow(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const waiting = iterator.next()
    await ctx.fiber.dispose()
    expect(await waiting).toMatchObject({ done: true })
    expect(listeners.size).toBe(0)
    expect(await controller.follow(new AbortController().signal)[Symbol.asyncIterator]().next()).toMatchObject({ done: true })
  })

  it('forwards the atomic runtime callback payload without rereading snapshot state', async () => {
    const { controller, runtime, commit } = harness()
    const iterator = controller.follow(new AbortController().signal)[Symbol.asyncIterator]()
    await iterator.next()
    const waiting = iterator.next()
    runtime.snapshot.mockClear()
    commit(2)
    expect(await waiting).toEqual({ done: false, value: { type: 'snapshot', value: state(2) } })
    expect(runtime.snapshot).not.toHaveBeenCalled()
  })

  it('does not subscribe aborted follow requests and maps baseline read errors', async () => {
    const { controller, runtime } = harness()
    const abort = new AbortController()
    abort.abort()
    expect(await controller.follow(abort.signal)[Symbol.asyncIterator]().next()).toMatchObject({ done: true })
    runtime.snapshot.mockImplementationOnce(() => { throw new Error('unavailable') })
    await expect(controller.follow(new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'automation/operation-failed',
    })
  })
})

describe('actual selector service adapters', () => {
  it('preserves source labels and policy values while exposing availability as codes', async () => {
    const { ctx } = harness()
    const { listModels } = selectors(ctx)
    const result = await automationCatalog(ctx)
    expect(result.workspaces.map(item => item.availability)).toEqual(['ready', 'missing', 'unavailable'])
    expect(result.workspaces[0]?.title).toBe('用户名称')
    expect(result.agentPresets).toContainEqual({ id: 'missing-default', availability: 'missing' })
    expect(result.agentPresets).toContainEqual({ id: 'bad', availability: 'broken' })
    expect(result.permissionPresets[0]).toMatchObject({ id: 'safe', name: '安全', permission: { sandbox: 'read-only', approval: 'never' } })
    expect(result.permissionPresets[1]).toMatchObject({ id: 'missing-permission', availability: 'missing', permission: null })
    expect(result.models[0]).toEqual({ provider: 'fake', id: 'one', name: '模型', description: '模型说明', availability: 'ready' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(listModels).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['absent', 'anything', 'missing'],
    ['fake', 'not-advertised', 'unlisted'],
    ['broken', 'model', 'unavailable'],
  ] as const)('keeps default %s/%s explicitly %s', async (provider, model, availability) => {
    const { ctx } = harness()
    const selector = selectors(ctx)
    selector.defaultModel({ provider, model })
    const result = await automationCatalog(ctx)
    expect(result.defaults).toMatchObject({ model: { provider, model }, modelAvailability: availability })
    expect(result.models).toContainEqual({ provider, id: model, availability })
  })
})
