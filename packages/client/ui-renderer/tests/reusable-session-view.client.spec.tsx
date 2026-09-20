// @vitest-environment jsdom
/** Explicit Session views reuse the real registry's entries, stores, and child authorization. */
import { Fragment, useEffect, type ReactNode } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, defineStore } from '@deepseek-ai/dsh-client-store'
import {
  SlotOwnershipError, StaleAuthorizationError,
  type PropsRenderSlots, type ScopedStandardSourceBinding, type SessionProviderComponent,
  type SlotRenderer, type SnapshotSelectorHook, type StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { SlotRegistry } from '../src/client/registry.ts'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'reuse.view': { kind: 'single'; scope: 'session'; owner: { label: string } }
    'reuse.maybe': { kind: 'single'; scope: 'session-maybe'; owner: { label: string } }
    'reuse.child': { kind: 'single'; scope: 'session' }
    'reuse.list': { kind: 'list'; scope: 'session' }
    'reuse.keyed': { kind: 'keyed'; scope: 'session' }
    'reuse.chain': { kind: 'chain'; scope: 'session' }
  }
}

type RenderSlot = (key: string, owner: object) => ReactNode
interface ErasedRegistration {
  register(options: object, component: unknown): () => void
}
interface ProbeProps {
  label: string
  sessionId: string
  useSession: SnapshotSelectorHook<string>
  useWorkspaces: SnapshotSelectorHook<string>
  usePrivate: SnapshotSelectorHook<string>
  useProjection(key: string, selector: (value: string) => string): string
  useInbox: SnapshotSelectorHook<string>
  useStore: SnapshotSelectorHook<{ value: string }>
  actions: { set(value: string): void }
  send(): void
  shared: string
  renderSlot: RenderSlot
  SessionProvider: SessionProviderComponent
}

const contexts: Context[] = []
afterEach(async () => {
  cleanup()
  await act(async () => {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  })
  vi.restoreAllMocks()
})

function ownedContext(): Context {
  const ctx = new Context()
  contexts.push(ctx)
  return ctx
}

async function bench(renderer: SlotRenderer | null = createSlotRenderer()) {
  const ctx = ownedContext()
  await ctx.plugin(SlotRegistry)
  const slots = ctx.slots
  if (renderer !== null) slots.install(renderer)
  const register = (options: object, component: unknown) =>
    (slots as unknown as ErasedRegistration).register(options, component)
  const absent: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const current = createSnapshotStore<StandardSourceBinding>(absent)
  const bindings = new Map<string, ScopedStandardSourceBinding>()
  const sources = new Map<string, ReturnType<typeof createSnapshotStore<string>>>()
  const projections = new Map<string, ReturnType<typeof createSnapshotStore<string>>>()
  const inboxes = new Map<string, ReturnType<typeof createSnapshotStore<string>>>()
  const adapter = {
    current,
    resolve: (id: string) => bindings.get(id),
    renderArea: (binding: StandardSourceBinding, { children, empty }: Parameters<SessionProviderComponent>[0]) =>
      binding.key === undefined ? empty?.() : <Fragment key={binding.key}>{children}</Fragment>,
  }
  slots.installScope('session', adapter)
  const addSession = (id: string) => {
    const source = createSnapshotStore(id)
    sources.set(id, source)
    const projection = createSnapshotStore(id + '-projection')
    const inbox = createSnapshotStore(id + '-inbox')
    projections.set(id, projection)
    inboxes.set(id, inbox)
    const binding: ScopedStandardSourceBinding = {
      key: id, ctx: ownedContext(), hooks: { session: source, inbox },
      keyedHooks: { projection: key => key === 'retained' ? projection : undefined }, props: { sessionId: id },
    }
    bindings.set(id, binding)
    return binding
  }
  const parent = addSession('parent')
  const child = addSession('child')
  current.set(parent)
  const workspace = createSnapshotStore('workspace')
  slots.provideRoot({ hooks: { workspaces: workspace } })
  const declare = (body: (props: { renderSlot: RenderSlot }) => ReactNode = () => null) => register({
    name: 'root',
    children: {
      'reuse.view': { kind: 'single', scope: 'session', inject: { shared: 'slot' } },
      'reuse.maybe': { kind: 'single', scope: 'session-maybe', inject: { shared: 'slot' } },
      'reuse.list': { kind: 'list', scope: 'session' },
      'reuse.keyed': { kind: 'keyed', scope: 'session' },
      'reuse.chain': { kind: 'chain', scope: 'session' },
    },
  }, body)
  return { ctx, slots, register, declare, bindings, sources, projections, inboxes, current, adapter, parent, child, workspace }
}

function createViewStore() {
  return defineStore({
    init: () => ({ value: 'initial' }),
    actions: { set: (draft, value: string) => { draft.value = value } },
  })
}

describe('reusable Session views', () => {
  it.each(['reuse.view', 'reuse.maybe'] as const)('routes simultaneous parent and child shares through %s', async (key) => {
    const h = await bench()
    const sent: string[] = []
    const privateSources = new Map([
      ['parent', createSnapshotStore('private-parent')], ['child', createSnapshotStore('private-child')],
    ])
    let childRender: RenderSlot | undefined
    function Probe(props: ProbeProps) {
      const session = props.useSession(value => value)
      const workspace = props.useWorkspaces(value => value)
      const privateValue = props.usePrivate(value => value)
      const value = props.useStore(state => state.value)
      const projection = props.useProjection('retained', value => value)
      const inbox = props.useInbox(value => value)
      if (props.label === 'embedded') childRender = props.renderSlot
      return <section data-testid={props.label}>
        <output>{[props.sessionId, session, workspace, privateValue, props.shared, value].join('|')}</output>
        <aside>{projection}|{inbox}</aside>
        <button onClick={() => { props.actions.set('edited'); props.send() }}>edit</button>
        <props.SessionProvider>{props.renderSlot('reuse.child', {})}</props.SessionProvider>
      </section>
    }
    h.declare(({ renderSlot }) => <>
      {renderSlot(key, { label: 'main' })}
      {h.slots.renderSessionView(key, { label: 'embedded' }, 'child')}
    </>)
    h.register({
      name: key, reusable: true, store: createViewStore,
      children: { 'reuse.child': { kind: 'single', scope: 'session' } },
      inject: (id: string, actions: ProbeProps['actions']) => ({
        hooks: { private: privateSources.get(id)! },
        send: () => { sent.push(id); actions.set('sent-' + id) },
      }),
    }, Probe)
    h.register({ name: 'reuse.child' }, ({ sessionId }: { sessionId: string }) => <small>{sessionId}</small>)
    const view = render(<>{h.slots.renderSlot('root', {})}</>)
    const main = view.getByTestId('main')
    const embedded = view.getByTestId('embedded')
    expect(main.querySelector('output')?.textContent).toBe('parent|parent|workspace|private-parent|slot|initial')
    expect(embedded.querySelector('output')?.textContent).toBe('child|child|workspace|private-child|slot|initial')
    expect(main.querySelector('small')?.textContent).toBe('parent')
    expect(embedded.querySelector('small')?.textContent).toBe('child')
    expect(main.querySelector('aside')?.textContent).toBe('parent-projection|parent-inbox')
    expect(embedded.querySelector('aside')?.textContent).toBe('child-projection|child-inbox')
    fireEvent.click(embedded.querySelector('button')!)
    expect(sent).toEqual(['child'])
    expect(embedded.querySelector('output')?.textContent).toContain('sent-child')
    expect(main.querySelector('output')?.textContent).toContain('initial')
    act(() => {
      h.sources.get('child')!.set('child-update')
      privateSources.get('child')!.set('private-update')
      h.projections.get('child')!.set('child-projection-update')
      h.inboxes.get('child')!.set('child-inbox-update')
    })
    expect(main.querySelector('aside')?.textContent).toBe('parent-projection|parent-inbox')
    expect(embedded.querySelector('aside')?.textContent).toBe('child-projection-update|child-inbox-update')
    expect(embedded.querySelector('output')?.textContent).toContain('child-update|workspace|private-update')
    expect(main.querySelector('output')?.textContent).toContain('parent|parent')
    expect(() => childRender!('reuse.list', {})).toThrow(SlotOwnershipError)
    act(() => { h.current.set(h.child) })
    expect(view.getByTestId('main').querySelector('output')?.textContent).toContain('sent-child')
    expect(view.getByTestId('embedded').querySelector('small')?.textContent).toBe('child')
  })

  it('refreshes explicit bindings on contributions without adopting selection', async () => {
    const h = await bench()
    h.declare()
    h.register({ name: 'reuse.view', reusable: true }, ({ sessionId, badge }: { sessionId: string; badge?: string }) =>
      <span>{sessionId}:{badge ?? 'absent'}</span>)
    const view = render(<>{h.slots.renderSessionView('reuse.view', { label: 'embedded' }, 'child')}</>)
    expect(view.container.textContent).toBe('child:absent')
    act(() => {
      h.bindings.set('child', { ...h.child, props: { ...h.child.props, badge: 'contributed' } })
      h.current.set({ ...h.parent })
    })
    expect(view.container.textContent).toBe('child:contributed')
    act(() => {
      h.bindings.set('child', h.child)
      h.current.set({ ...h.parent })
    })
    expect(view.container.textContent).toBe('child:absent')
  })

  it('unmounts disposed entries and restores authorized HMR replacements without an outer redraw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = await bench()
    h.declare()
    const unmounted = vi.fn()
    let retained: PropsRenderSlots<'reuse.child'>['renderSlot'] | undefined
    const plugin = h.ctx.plugin({ inject: ['slots'], apply(ctx: Context) {
      ctx.slots.register({ name: 'reuse.view', reusable: true, children: {
        'reuse.child': { kind: 'single', scope: 'session' },
      } }, (props: PropsRenderSlots<'reuse.child'>) => {
        retained = props.renderSlot
        useEffect(() => unmounted, [])
        return props.renderSlot('reuse.child', {})
      })
      ctx.slots.register({ name: 'reuse.child' }, () => <b>first</b>)
    } })
    await plugin
    const captured = h.slots.renderSessionView('reuse.view', { label: 'embedded' }, 'child')
    const view = render(<>{captured}</>)
    expect(view.container.textContent).toBe('first')
    await act(async () => { await plugin.dispose() })
    expect(unmounted).toHaveBeenCalledOnce()
    expect(view.container.textContent).toBe('')
    expect(() => retained!('reuse.child', {})).toThrow(StaleAuthorizationError)
    expect(() => h.slots.renderSessionView('reuse.view', { label: 'embedded' }, 'child')).toThrow('no active registration')
    expect(view.container.querySelector('[data-slot-error="reuse.view"]')).not.toBeNull()
    await act(async () => { h.slots.register({ name: 'reuse.view', reusable: true }, () => <b>second</b>) })
    expect(view.container.textContent).toBe('second')
    expect(() => retained!('reuse.child', {})).toThrow(StaleAuthorizationError)
  })

  it('rejects an unmarked shadowing winner and restores the opted-in survivor', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = await bench()
    h.declare()
    h.slots.register({ name: 'reuse.view', reusable: true }, () => <b>allowed</b>)
    const view = render(<>{h.slots.renderSessionView('reuse.view', { label: 'embedded' }, 'child')}</>)
    let dispose = () => {}
    await act(async () => { dispose = h.slots.register({ name: 'reuse.view', priority: -1 }, () => <b>private</b>) })
    expect(view.container.textContent).toBe('')
    expect(view.container.querySelector('[data-slot-error="reuse.view"]')).not.toBeNull()
    expect(() => h.slots.renderSessionView('reuse.view', { label: 'embedded' }, 'child')).toThrow('reusable: true')
    await act(async () => { dispose() })
    expect(view.container.textContent).toBe('allowed')
  })

  it.each(['entry', 'inject', 'descendant'] as const)('contains a reused %s error without abdicating the main registration', async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = await bench()
    h.declare(({ renderSlot }) => renderSlot('reuse.view', { label: 'main' }))
    h.register({ name: 'reuse.view', reusable: true,
      children: { 'reuse.child': { kind: 'single', scope: 'session' } },
      inject: (id: string) => {
        if (failure === 'inject' && id === 'child') throw new Error('child inject failed')
        return {}
      },
    }, ({ sessionId, renderSlot }: { sessionId: string; renderSlot: RenderSlot }) => {
      if (failure === 'entry' && sessionId === 'child') throw new Error('child view failed')
      return <section>{sessionId}{renderSlot('reuse.child', {})}</section>
    })
    h.register({ name: 'reuse.child' }, ({ sessionId }: { sessionId: string }) => {
      if (failure === 'descendant' && sessionId === 'child') throw new Error('child descendant failed')
      return <b>{sessionId}-body</b>
    })
    const errors = vi.fn()
    h.slots.onEntryError(errors)
    const mainEntry = h.slots.entriesOfSlot('reuse.view')[0]
    const childEntry = h.slots.entriesOfSlot('reuse.child')[0]
    const view = render(<>
      <div data-testid="main">{h.slots.renderSlot('root', {})}</div>
      <div data-testid="bad">{h.slots.renderSessionView('reuse.view', { label: 'bad' }, 'child')}</div>
      <div data-testid="good">{h.slots.renderSessionView('reuse.view', { label: 'good' }, 'parent')}</div>
    </>)
    expect(view.getByTestId('bad').querySelector('[data-slot-error]')).not.toBeNull()
    expect(view.getByTestId('main').textContent).toBe('parentparent-body')
    expect(view.getByTestId('good').textContent).toBe('parentparent-body')
    expect(h.slots.entriesOfSlot('reuse.view')).toEqual([mainEntry])
    expect(h.slots.entriesOfSlot('reuse.child')).toEqual([childEntry])
    expect(errors).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.any(Error), { abdicated: false })
  })

  it('never falls back to parent or selected scope when an explicit Session is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = await bench()
    h.declare(({ renderSlot }) => <>
      {renderSlot('reuse.view', { label: 'main' })}
      <div data-testid="missing">{h.slots.renderSessionView('reuse.view', { label: 'missing' }, 'missing')}</div>
    </>)
    h.register({ name: 'reuse.view', reusable: true }, ({ sessionId }: { sessionId: string }) => <b>{sessionId}</b>)
    const view = render(<>{h.slots.renderSlot('root', {})}</>)
    expect(view.container.textContent).toBe('parent')
    expect(view.getByTestId('missing').querySelector('[data-slot-error="reuse.view"]')).not.toBeNull()
    expect(h.slots.entriesOfSlot('reuse.view')).toHaveLength(1)
  })

  it('rejects unsupported renderers, absent or unmarked entries, and invalid slot kinds', async () => {
    const missing = await bench(null)
    expect(() => missing.slots.renderSessionView('reuse.view', { label: '' }, 'child')).toThrow('does not support')
    const legacy = await bench({ renderRoot: () => null })
    expect(() => legacy.slots.renderSessionView('reuse.view', { label: '' }, 'child')).toThrow('does not support')
    const h = await bench()
    expect(() => h.slots.renderSessionView('reuse.view', { label: '' }, 'child')).toThrow('not declared')
    h.declare()
    expect(() => h.slots.renderSessionView('reuse.view', { label: '' }, 'child')).toThrow('no active registration')
    h.slots.register({ name: 'reuse.view' }, () => null)
    expect(() => h.slots.renderSessionView('reuse.view', { label: '' }, 'child')).toThrow('reusable: true')
    for (const key of ['root', 'reuse.list', 'reuse.keyed', 'reuse.chain'] as const) {
      expect(() => h.slots.renderSessionView(key, {}, 'child')).toThrow('requires kind')
      expect(() => h.register({ name: key, reusable: true }, () => null)).toThrow('supports reusable only')
    }
    expect(() => h.slots.renderSlot('reuse.view', { label: '' })).toThrow("only renders 'root'")
  })
})
