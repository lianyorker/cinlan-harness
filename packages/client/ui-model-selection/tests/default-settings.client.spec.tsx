// @vitest-environment jsdom
/** Default controls use the real settings scope, shared catalog, and slot lifecycle. */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelCatalog, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { bindSnapshotSelector, RemoteError, stubSettingsScope, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { DefaultModelSettings, type DefaultModelSettingsInjected, type DefaultModelSettingsProps } from '../src/client/DefaultModelSettings.tsx'
import { DefaultModelSettingsController, DEFAULT_MODEL_NAMESPACE } from '../src/client/default-settings.ts'
import { ModelCatalogDirectory } from '../src/client/catalog.ts'

const BASE: ModelSelection = { provider: 'route-a', model: 'fast' }
const CATALOG: ModelCatalog = {
  default: BASE,
  routableProviders: ['route-a', 'route-b'],
  groups: [
    { id: 'route-a', name: 'Provider A', models: [
      { id: 'fast', name: 'Fast', reasoning: {
        defaultEffort: 'light', efforts: [{ id: 'light', name: 'Light' }, { id: 'deep', name: 'Deep' }],
      } },
      { id: 'plain', name: 'Plain' },
    ] },
    { id: 'route-b', name: 'Provider B', models: [
      { id: 'thoughtful', name: 'Thoughtful', reasoning: {
        defaultEffort: 'balanced', efforts: [{ id: 'balanced', name: 'Balanced' }, { id: 'maximum', name: 'Maximum' }],
      } },
    ] },
  ],
  failures: [],
}

const contexts: Context[] = []
afterEach(async () => {
  cleanup()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function bench(options: {
  writable?: boolean
  available?: boolean
  declare?: boolean
  user?: Partial<ModelSelection>
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  ctx.slots.installLocale(locale)
  ctx.provide('sessions', { scope: () => undefined, binding: () => undefined, subagentAddress: () => undefined } as never)
  ctx.provide('commandUi', { register: () => () => {} } as never)
  let user: Partial<ModelSelection> = options.user ?? { ...BASE, reasoningEffort: 'deep' }
  let revision = 1
  let failure: 'refused' | 'conflict' | undefined
  const view = (): SettingsNamespaceView => ({
    ns: DEFAULT_MODEL_NAMESPACE,
    schema: { uid: 1, refs: {
      1: { type: 'object', dict: { provider: 2, model: 3, reasoningEffort: 4 } },
      2: { type: 'string', meta: { required: true } },
      3: { type: 'string', meta: { required: true } },
      4: { type: 'string' },
    } },
    value: { ...BASE, ...user }, base: { ...BASE }, user, revision, applies: 'live', secrets: [],
  })
  const describeSettings = vi.fn(async () => ({ ok: true as const, value: {
    writable: options.writable ?? true, hasDocument: true,
    namespaces: options.available === false ? [] : [view()],
  } }))
  const mutate = vi.fn(async (ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined) => {
    if (expectedRevision === undefined) throw new Error('default settings writes require a revision')
    if (failure === 'conflict') {
      user = { provider: 'route-a', model: 'plain' }
      revision += 1
    }
    if (failure === 'refused') {
      return { ok: false as const, error: new RemoteError('settings/rejected', 'write refused', { ns }) }
    }
    if (expectedRevision !== revision) {
      return { ok: false as const, error: new RemoteError(
        'settings/conflict', 'settings changed', { ns, expected: expectedRevision, actual: revision },
      ) }
    }
    const next = { ...user }
    for (const op of ops) {
      const field = op.path[0]
      if (field !== 'provider' && field !== 'model' && field !== 'reasoningEffort') throw new Error('unexpected settings field')
      if (op.op === 'unset') {
        if (field === 'provider') delete next.provider
        else if (field === 'model') delete next.model
        else delete next.reasoningEffort
      } else if (op.op === 'set' && typeof op.value === 'string') next[field] = op.value
      else throw new Error('unexpected settings operation')
    }
    user = next
    revision += 1
    return { ok: true as const, value: view() }
  })
  const modelCatalog = vi.fn(async () => ({ ok: true as const, value: CATALOG }))
  const selectModel = vi.fn()
  new TestRemote(ctx, { settings: { describe: describeSettings, mutate }, session: { modelCatalog, selectModel } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  const declare = () => ctx.slots.register({
    name: 'root', children: { 'settings.models.defaults': { kind: 'list', scope: 'root' } },
  }, ({ renderSlot }: PropsRenderSlots<'settings.models.defaults'>) => renderSlot('settings.models.defaults', {}))
  let release = options.declare === false ? undefined : declare()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await ctx.modelDirectories.catalog.load()
  await ctx.settingsScope.describe().ensure()
  const face = (): DefaultModelSettingsInjected => {
    const entry = ctx.slots.entries('settings.models.defaults')[0]
    if (entry === undefined) throw new Error('defaults slot is not registered')
    return (entry.inject as () => Pick<DefaultModelSettingsInjected, keyof DefaultModelSettingsInjected>)()
  }
  const mount = () => {
    const injected = face()
    // These controls do not consume the root-wide Session or Workspace hooks.
    const props = {
      t: locale.bind('model'), select: injected.select, reset: injected.reset, retry: injected.retry, reload: injected.reload,
      useCatalog: bindSnapshotSelector(injected.hooks.catalog),
      useDefaults: bindSnapshotSelector(injected.hooks.defaults),
      useWrite: bindSnapshotSelector(injected.hooks.write),
    } as DefaultModelSettingsProps
    return render(<DefaultModelSettings {...props} />)
  }
  return {
    ctx, fiber, locale, mutate, describeSettings, modelCatalog, selectModel, face, mount,
    user: () => user,
    reject: (kind: typeof failure) => { failure = kind },
    collapse: () => { release?.(); release = undefined },
    declare: () => { release = declare() },
  }
}

const pickModel = (provider: string, model: string) => {
  fireEvent.change(screen.getByLabelText('Default model'), { target: { value: JSON.stringify([provider, model]) } })
}

describe('new-session default model settings', () => {
  it('shares the existing catalog and atomically clears stale effort when the route changes', async () => {
    const b = await bench()
    expect(b.face().hooks.catalog).toBe(b.ctx.modelDirectories.catalog.store)
    b.mount()
    expect(screen.getByLabelText('Default model').closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor')).toBe('default-model')
    expect(screen.getByLabelText('Reasoning effort').closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor')).toBe('default-reasoning')
    expect(screen.getByText(/Switching a model in a session also saves future defaults/)).toBeTruthy()
    pickModel('route-b', 'thoughtful')
    await screen.findByText('Saved')
    expect(b.mutate).toHaveBeenCalledWith(DEFAULT_MODEL_NAMESPACE, [
      { op: 'set', path: ['provider'], value: 'route-b' },
      { op: 'set', path: ['model'], value: 'thoughtful' },
      { op: 'unset', path: ['reasoningEffort'] },
    ], 1)
    expect(b.user()).toEqual({ provider: 'route-b', model: 'thoughtful' })
    expect(screen.queryByRole('option', { name: 'Deep' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Balanced' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Maximum' })).toBeTruthy()
    expect(b.modelCatalog).toHaveBeenCalledOnce()
    expect(b.selectModel).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: 'maximum' } })
    await waitFor(() => { expect(b.user().reasoningEffort).toBe('maximum') })
    expect(b.mutate).toHaveBeenLastCalledWith(DEFAULT_MODEL_NAMESPACE, [
      { op: 'set', path: ['provider'], value: 'route-b' },
      { op: 'set', path: ['model'], value: 'thoughtful' },
      { op: 'set', path: ['reasoningEffort'], value: 'maximum' },
    ], 2)
    fireEvent.change(screen.getByLabelText('Reasoning effort'), { target: { value: '' } })
    await waitFor(() => { expect(b.user()).toEqual({ provider: 'route-b', model: 'thoughtful' }) })
    expect(b.selectModel).not.toHaveBeenCalled()
  })

  it('resets own overrides even when they equal the inherited values', async () => {
    const b = await bench({ user: { ...BASE } })
    b.mount()
    const reset = screen.getByRole<HTMLButtonElement>('button', { name: 'Reset to inherited' })
    expect(reset.disabled).toBe(false)
    fireEvent.click(reset)
    await screen.findByText('Saved')
    expect(b.mutate).toHaveBeenCalledWith(DEFAULT_MODEL_NAMESPACE, [
      { op: 'unset', path: ['provider'] }, { op: 'unset', path: ['model'] }, { op: 'unset', path: ['reasoningEffort'] },
    ], 1)
    expect(b.user()).toEqual({})
    expect(reset.disabled).toBe(true)
    expect(screen.getByLabelText<HTMLSelectElement>('Default model').value).toBe(JSON.stringify(['route-a', 'fast']))
  })

  it('does not announce a fulfilled rejected mutation as saved, and retries after recovery', async () => {
    const b = await bench()
    b.reject('refused')
    b.mount()
    pickModel('route-b', 'thoughtful')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Could not confirm'))
    expect(screen.queryByText('Saved')).toBeNull()
    expect(b.user()).toEqual({ ...BASE, reasoningEffort: 'deep' })
    b.reject(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('Saved')
    expect(b.user()).toEqual({ provider: 'route-b', model: 'thoughtful' })
    expect(b.describeSettings.mock.calls.length).toBeGreaterThan(1)
  })

  it('shows recovered values on conflict and retries the intended route with the new revision', async () => {
    const b = await bench()
    b.reject('conflict')
    b.mount()
    pickModel('route-b', 'thoughtful')
    await screen.findByText('Defaults changed elsewhere. Review the current values and retry.')
    expect(screen.getByLabelText<HTMLSelectElement>('Default model').value).toBe(JSON.stringify(['route-a', 'plain']))
    b.reject(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('Saved')
    expect(b.mutate.mock.calls.map(call => call[2])).toEqual([1, 2])
    expect(b.user()).toEqual({ provider: 'route-b', model: 'thoughtful' })
  })

  it.each([
    { options: { writable: false }, message: 'Default model settings are read-only on this connection.' },
    { options: { available: false }, message: 'This connection does not expose new-session default model settings.' },
  ])('disables controls: $message', async ({ options, message }) => {
    const b = await bench(options)
    b.mount()
    expect(screen.getByText(message)).toBeTruthy()
    for (const control of screen.getAllByRole<HTMLSelectElement>('combobox')) expect(control.disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Reset to inherited' }).disabled).toBe(true)
    await b.face().select({ provider: 'route-b', model: 'thoughtful' })
    expect(b.mutate).not.toHaveBeenCalled()
  })

  it('retains defaults on a catalog failure and reloads the same shared catalog', async () => {
    const b = await bench()
    b.mount()
    b.modelCatalog.mockRejectedValueOnce(new Error('catalog unavailable'))
    await act(async () => { b.ctx.modelDirectories.catalog.refresh() })
    await screen.findByText('Could not load available models. Reload before choosing a model.')
    expect(screen.getByLabelText<HTMLSelectElement>('Default model').disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>('Default model').disabled).toBe(false) })
    expect(b.modelCatalog).toHaveBeenCalledTimes(3)
    expect(b.mutate).not.toHaveBeenCalled()
  })

  it('retains loaded choices on a partial failure and explicitly refreshes the shared catalog', async () => {
    const b = await bench()
    b.mount()
    b.modelCatalog.mockResolvedValueOnce({ ok: true, value: {
      ...CATALOG, groups: [CATALOG.groups[1]!], failures: [{ id: 'route-a', name: 'Provider A', message: 'lookup failed' }],
    } })
    await act(async () => { b.ctx.modelDirectories.catalog.refresh() })
    await screen.findByText('Could not load all model lists.')
    expect(screen.getByRole('option', { name: 'Not listed: fast' })).toBeTruthy()
    expect(screen.getByLabelText<HTMLSelectElement>('Default model').disabled).toBe(false)
    pickModel('route-b', 'thoughtful')
    await screen.findByText('Saved')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(b.modelCatalog).toHaveBeenCalledTimes(3)
  })

  it('shows an unlisted stored effort and disables effort for a model without reasoning metadata', async () => {
    const b = await bench({ user: { ...BASE, reasoningEffort: 'legacy' } })
    b.mount()
    expect(screen.getByRole('option', { name: 'Not listed: legacy' })).toBeTruthy()
    pickModel('route-a', 'plain')
    await screen.findByText('Saved')
    expect(b.user()).toEqual({ provider: 'route-a', model: 'plain' })
    expect(screen.getByLabelText<HTMLSelectElement>('Reasoning effort').disabled).toBe(true)
    expect(screen.getByText('This model provides no reasoning effort levels.')).toBeTruthy()
  })

  it('waits for the Models declaration and releases localized, value-free metadata with it', async () => {
    const b = await bench({ declare: false })
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    b.declare()
    await vi.waitFor(() => { expect(b.ctx.slots.entries('settings.models.defaults')).toHaveLength(1) })
    expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => [item.id, item.anchorId, item.title])).toEqual([
      ['default-model', 'default-model', 'Default model'], ['default-reasoning', 'default-reasoning', 'Reasoning effort'],
    ])
    expect(JSON.stringify(b.ctx.settingsMetadata.getSnapshot().items)).not.toContain('route-a')
    b.locale.setLocale('zh')
    expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe('默认模型')
    b.collapse()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    expect(b.ctx.slots.entries('settings.models.defaults')).toEqual([])
    b.declare()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(2) })
    await b.fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    expect(b.ctx.slots.entries('settings.models.defaults')).toEqual([])
    expect(b.modelCatalog).toHaveBeenCalledOnce()
  })
})

describe('default write confirmation', () => {
  async function subject() {
    const scope = stubSettingsScope<ModelSelection>()
    scope.publish({ status: 'ready', value: BASE, base: BASE, user: {}, writable: true, revision: 1 })
    const catalog = new ModelCatalogDirectory({ remote: { session: {
      modelCatalog: () => Promise.resolve({ ok: true, value: CATALOG }),
    } } } as never)
    await catalog.load()
    const mutate = vi.spyOn(scope.scope, 'mutate')
    return { scope, mutate, controller: new DefaultModelSettingsController(scope.scope, catalog) }
  }

  it('requires user-layer presence even when an accepted write matches the effective value', async () => {
    const b = await subject()
    b.mutate.mockResolvedValueOnce(true)
    await b.controller.select(BASE)
    expect(b.scope.mutate).toHaveBeenCalledOnce()
    expect(b.controller.store.getSnapshot()).toEqual({ status: 'failed', canRetry: true })
    b.mutate.mockImplementationOnce(async () => {
      b.scope.publish({ user: { ...BASE }, revision: 2 })
      return true
    })
    await b.controller.retry()
    expect(b.controller.store.getSnapshot().status).toBe('saved')
    await b.controller.dispose()
  })

  it('rejects partial readback that retained the old effort override', async () => {
    const b = await subject()
    b.scope.publish({ user: { ...BASE, reasoningEffort: 'deep' } })
    b.mutate.mockImplementationOnce(async () => {
      b.scope.publish({ user: { ...BASE, reasoningEffort: 'deep' }, revision: 2 })
      return true
    })
    await b.controller.select(BASE)
    expect(b.controller.store.getSnapshot().status).toBe('conflict')
    await b.controller.dispose()
  })

  it.each(['select', 'reset'] as const)('does not confirm a refused %s when recovery already contains the requested state', async (edit) => {
    const b = await subject()
    b.scope.publish({ user: { ...BASE, reasoningEffort: 'deep' } })
    b.mutate.mockImplementationOnce(async () => {
      b.scope.publish({ user: edit === 'select' ? { ...BASE } : {}, revision: 2 })
      return false
    })
    try {
      if (edit === 'select') await b.controller.select(BASE)
      else await b.controller.reset()
      expect(b.mutate).toHaveBeenCalledOnce()
      expect(b.scope.scope.getSnapshot().user).toEqual(edit === 'select' ? BASE : {})
      expect(b.controller.store.getSnapshot()).toEqual({ status: 'conflict', canRetry: true })
    } finally {
      await b.controller.dispose()
    }
  })

  it('requires accepted resets to remove user overrides even when the effective value is inherited', async () => {
    const b = await subject()
    b.scope.publish({ user: { ...BASE } })
    b.mutate.mockResolvedValueOnce(true)
    try {
      await b.controller.reset()
      expect(b.mutate).toHaveBeenCalledWith([
        { op: 'unset', path: ['provider'] },
        { op: 'unset', path: ['model'] },
        { op: 'unset', path: ['reasoningEffort'] },
      ], 1)
      expect(b.controller.store.getSnapshot()).toEqual({ status: 'failed', canRetry: true })
    } finally {
      await b.controller.dispose()
    }
  })

  it.each(['select', 'reset'] as const)('skips writes for an already confirmed %s', async (edit) => {
    const b = await subject()
    b.scope.publish({ user: edit === 'select' ? { ...BASE } : {} })
    try {
      if (edit === 'select') await b.controller.select(BASE)
      else await b.controller.reset()
      expect(b.mutate).not.toHaveBeenCalled()
      expect(b.controller.store.getSnapshot()).toEqual({ status: 'saved', canRetry: false })
    } finally {
      await b.controller.dispose()
    }
  })

  it('reports a rejected write and refuses an effort absent from the selected route', async () => {
    const b = await subject()
    b.mutate.mockRejectedValueOnce(new Error('connection lost'))
    await b.controller.select(BASE)
    expect(b.controller.store.getSnapshot()).toEqual({ status: 'failed', canRetry: true })
    await b.controller.select({ provider: 'route-b', model: 'thoughtful', reasoningEffort: 'deep' })
    expect(b.controller.store.getSnapshot()).toEqual({ status: 'failed', canRetry: false })
    expect(b.scope.mutate).toHaveBeenCalledOnce()
    await b.controller.dispose()
  })

  it.each(['accepted', 'refused', 'rejected'] as const)('waits for a %s write on disposal and suppresses late feedback and later writes', async (outcome) => {
    const b = await subject()
    const pending = Promise.withResolvers<boolean>()
    b.mutate.mockImplementationOnce(() => pending.promise)
    const write = b.controller.select(BASE)
    expect(b.controller.reset()).toBe(write)
    const disposed = vi.fn()
    const disposal = b.controller.dispose().then(disposed)
    try {
      expect(disposed).not.toHaveBeenCalled()
      b.scope.publish({ user: { ...BASE }, revision: 2 })
    } finally {
      if (outcome === 'rejected') pending.reject(new Error('connection lost'))
      else pending.resolve(outcome === 'accepted')
      await Promise.all([write, disposal])
    }
    expect(b.controller.store.getSnapshot().status).toBe('saving')
    await b.controller.reset()
    expect(b.scope.mutate).toHaveBeenCalledOnce()
  })
})
