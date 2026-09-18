// @vitest-environment jsdom
/** Client registrations follow the specific Git Remote namespace's lifetime. */
import { Context, FiberState } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { TerminalCallbacks } from '@deepseek-ai/dsh-api-sidebar-terminal-controller/client'
import { KeyboardController } from '@deepseek-ai/dsh-client-keyboard/src/client/controller.ts'
import type { KeybindingsSettings } from '@deepseek-ai/dsh-client-keyboard/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { isValidElement } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context as SidebarContext } from '../src/context-types.ts'
import { SIDEBAR_PREFS_DEFAULTS, SIDEBAR_PREFS_NS, type SidebarPrefs } from '../src/prefs-shared.ts'
import type { SidebarGitClient } from '../src/client/api.ts'
import { setChunkModuleSystem } from '../src/client/chunk-loader.ts'
import { DiffTab } from '../src/client/DiffTab.tsx'
import { GitView } from '../src/client/GitView.tsx'
import * as client from '../src/client/index.tsx'
import { attachLocale } from '../src/client/locales.ts'
import { SideCardSection, type SideCardSectionInjected } from '../src/client/SideCardSection.tsx'
import { gitRemote, patch, scope, status } from './git-fixture.client.ts'

function terminalScope() {
  let finishDisposal!: () => void
  const drained = new Promise<void>((resolve) => { finishDisposal = resolve })
  let startDisposal!: () => void
  const disposing = new Promise<void>((resolve) => { startDisposal = resolve })
  const stopWatching = vi.fn()
  const callbacks = {
    connectTerminal: vi.fn<TerminalCallbacks['connectTerminal']>(() => { throw new Error('Unexpected terminal connection') }),
    terminalInput: vi.fn<TerminalCallbacks['terminalInput']>(),
    terminalResize: vi.fn<TerminalCallbacks['terminalResize']>(),
    terminalCapability: vi.fn<TerminalCallbacks['terminalCapability']>()
      .mockResolvedValue({ status: 'available', shellName: 'fixture-shell' }),
    watchAgentTerminals: vi.fn<TerminalCallbacks['watchAgentTerminals']>(() => stopWatching),
    terminalCloseAgent: vi.fn<TerminalCallbacks['terminalCloseAgent']>(),
    terminalCloseUi: vi.fn<TerminalCallbacks['terminalCloseUi']>(),
    dispose: vi.fn<TerminalCallbacks['dispose']>(() => { startDisposal(); return drained }),
  } satisfies TerminalCallbacks
  return { callbacks, stopWatching, disposing, finishDisposal }
}

function registeredCallbacks(ctx: Context, slots: SlotRegistry) {
  const entries = slots.entries('settings.section')
  expect(entries).toHaveLength(1)
  expect(entries[0]!.component).toBe(SideCardSection)
  expect(entries[0]!.options).toMatchObject({ id: 'better-sidebar' })
  const face = (entries[0]!.inject as unknown as () => SideCardSectionInjected)()
  expect(face.service).toBe(ctx.get('betterSidebar'))
  expect(face.service.getTabs()).toHaveLength(7)
  expect(face.service.getFileViewers()).toHaveLength(6)
  expect(slots.entries('settings.section.icon')).toHaveLength(1)
  expect(slots.entries('conversation.chat.turnTail')).toHaveLength(1)

  const props = { ctx: ctx as SidebarContext, store: face.store, scope, visible: true }
  const git = face.service.getTab('git')!.component({
    ...props, tab: { id: 'git', type: 'git', title: 'Git' },
  })
  const diff = face.service.getTab('diff')!.component({
    ...props, tab: { id: 'diff', type: 'diff', title: 'source.ts',
      diff: { kind: 'worktree', path: 'source.ts', staged: false } },
  })
  if (!isValidElement<{ git: SidebarGitClient }>(git) || !isValidElement<{ git: SidebarGitClient }>(diff)) {
    throw new Error('Git and diff registrations must produce their component elements')
  }
  expect(git.type).toBe(GitView)
  expect(diff.type).toBe(DiffTab)
  expect(diff.props.git).toBe(git.props.git)
  return { ...face, git: git.props.git, diff: diff.props.git }
}

it('waits for sidebarGit, drains its registrations and terminals on unload, and captures replacement callbacks', async () => {
  const ctx = new Context()
  const terminals: ReturnType<typeof terminalScope>[] = []
  const moduleSystem = Object.getOwnPropertyDescriptor(globalThis, '__dshSidebarModuleSystem__')
  onTestFinished(async () => {
    for (const terminal of terminals) terminal.finishDisposal()
    try {
      await ctx.fiber.dispose()
    } finally {
      attachLocale(undefined)
      setChunkModuleSystem(undefined)
      if (moduleSystem !== undefined) Object.defineProperty(globalThis, '__dshSidebarModuleSystem__', moduleSystem)
    }
  })

  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.section.icon': { kind: 'keyed', scope: 'root' },
    'conversation.chat.turnTail': { kind: 'chain', scope: 'session' },
  } }, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))

  const preferences = stubSettingsScope<SidebarPrefs>()
  preferences.publish({ status: 'ready', value: { ...SIDEBAR_PREFS_DEFAULTS } })
  const externalPanel = stubSettingsScope<{ rightPanel?: string }>()
  // The existing panel preference keeps the portal dormant; registrations still run through apply.
  externalPanel.publish({ status: 'ready', value: { rightPanel: 'aionui-panel' } })
  ctx.provide('settingsScope', { bind: ({ namespace }: { namespace: string }) => {
    if (namespace === SIDEBAR_PREFS_NS) return preferences.scope
    if (namespace === 'aionui-panel') return externalPanel.scope
    throw new Error('Unexpected settings namespace: ' + namespace)
  } })
  const keybindings = stubSettingsScope<KeybindingsSettings>()
  keybindings.publish({ status: 'ready', value: { overrides: [] } })
  const keyboard = new KeyboardController(keybindings.scope, false)
  ctx.effect(() => () => { keyboard.dispose() })
  ctx.provide('keyboard', keyboard)
  const openPath = vi.fn(async (_path: string) => {})
  const workspaces = { openPath }
  ctx.provide('workspaces', workspaces)
  ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {}, current: undefined }) } })
  ctx.provide('connection', {})
  ctx.provide('modules', { import: async () => { throw new Error('Unexpected lazy chunk') } })
  const createTerminal = vi.fn(() => {
    const terminal = terminalScope()
    terminals.push(terminal)
    return terminal.callbacks
  })
  ctx.provide('sidebarTerminalClient', createTerminal)
  const remote = {
    get sidebarGit(): ClientRemote['sidebarGit'] | undefined { return ctx.get('remote.sidebarGit') },
  }
  ctx.provide('remote', remote)
  const provideGit = (namespace: ClientRemote['sidebarGit']) => ctx.plugin((provider) => {
    provider.provide('remote.sidebarGit', namespace)
  })
  const assertWithdrawn = () => {
    expect(ctx.get('betterSidebar')).toBeUndefined()
    expect(ctx.get('floatingTerminalConsumer')).toBeUndefined()
    expect(slots.entries('settings.section')).toEqual([])
    expect(slots.entries('settings.section.icon')).toEqual([])
    expect(slots.entries('conversation.chat.turnTail')).toEqual([])
    expect(keyboard.getSnapshot().commands).toEqual([])
    expect(preferences.listenerCount()).toBe(0)
    expect(externalPanel.listenerCount()).toBe(0)
    expect(workspaces.openPath).toBe(openPath)
    expect(ctx.get('remote')).toBe(remote)
  }

  const feature = ctx.plugin(client)
  await feature.await()
  expect(feature.state).toBe(FiberState.PENDING)
  assertWithdrawn()
  expect(createTerminal).not.toHaveBeenCalled()

  const firstRemote = gitRemote()
  const firstProvider = provideGit(firstRemote)
  await firstProvider.await()
  await feature.await()
  expect(feature.state).toBe(FiberState.ACTIVE)
  const first = registeredCallbacks(ctx, slots)
  expect(keyboard.getSnapshot().commands.map(command => command.id).sort()).toEqual(['editor.find', 'editor.replace', 'editor.save'])
  expect(preferences.listenerCount()).toBe(1)
  expect(externalPanel.listenerCount()).toBe(1)
  expect(workspaces.openPath).not.toBe(openPath)
  expect(createTerminal).toHaveBeenCalledTimes(1)
  first.store.setSession(scope.sessionId)
  const firstTerminal = terminals[0]!
  expect(firstTerminal.callbacks.watchAgentTerminals).toHaveBeenCalledExactlyOnceWith(scope.sessionId, expect.any(Function))
  await expect(first.git.gitStatus(scope)).resolves.toBe(status)
  await expect(first.diff.gitDiff(scope, 'source.ts', false)).resolves.toEqual({ diff: patch })
  expect(firstRemote.status).toHaveBeenCalledExactlyOnceWith({ sessionId: scope.sessionId }, undefined)
  expect(firstRemote.diff).toHaveBeenCalledExactlyOnceWith({ sessionId: scope.sessionId, path: 'source.ts', staged: false }, undefined)

  const unloading = firstProvider.dispose()
  await firstTerminal.disposing
  expect(feature.state).toBe(FiberState.UNLOADING)
  firstTerminal.finishDisposal()
  await unloading
  await feature.await()
  expect(feature.state).toBe(FiberState.PENDING)
  assertWithdrawn()
  expect(first.service.getTabs()).toEqual([])
  expect(first.service.getFileViewers()).toEqual([])
  expect(firstTerminal.callbacks.dispose).toHaveBeenCalledOnce()
  expect(firstTerminal.stopWatching).toHaveBeenCalledOnce()
  first.store.setSession('retired-sidebar-session')
  expect(firstTerminal.callbacks.watchAgentTerminals).toHaveBeenCalledOnce()

  const secondRemote = gitRemote()
  const replacementStatus = { ...status, branch: 'replacement' }
  secondRemote.status.mockResolvedValue({ ok: true, value: replacementStatus })
  secondRemote.diff.mockResolvedValue({ ok: true, value: { diff: 'replacement patch' } })
  const secondProvider = provideGit(secondRemote)
  await secondProvider.await()
  await feature.await()
  expect(feature.state).toBe(FiberState.ACTIVE)
  const second = registeredCallbacks(ctx, slots)
  expect(second.service).not.toBe(first.service)
  expect(second.store).not.toBe(first.store)
  expect(second.git).not.toBe(first.git)
  expect(createTerminal).toHaveBeenCalledTimes(2)
  expect(keyboard.getSnapshot().commands).toHaveLength(3)
  expect(preferences.listenerCount()).toBe(1)
  expect(externalPanel.listenerCount()).toBe(1)
  const retiredPreferences = first.store.getPrefs()
  preferences.publish({ value: { ...SIDEBAR_PREFS_DEFAULTS, defaultWidthPercent: 48 } })
  expect(second.store.getPrefs().defaultWidthPercent).toBe(48)
  expect(first.store.getPrefs()).toEqual(retiredPreferences)
  second.store.setSession(scope.sessionId)
  const secondTerminal = terminals[1]!
  expect(secondTerminal.callbacks.watchAgentTerminals).toHaveBeenCalledExactlyOnceWith(scope.sessionId, expect.any(Function))
  await expect(second.git.gitStatus(scope)).resolves.toBe(replacementStatus)
  await expect(second.diff.gitDiff(scope, 'source.ts', false)).resolves.toEqual({ diff: 'replacement patch' })
  expect(secondRemote.status).toHaveBeenCalledExactlyOnceWith({ sessionId: scope.sessionId }, undefined)
  expect(secondRemote.diff).toHaveBeenCalledExactlyOnceWith({ sessionId: scope.sessionId, path: 'source.ts', staged: false }, undefined)
  expect(firstRemote.status).toHaveBeenCalledOnce()
  expect(firstRemote.diff).toHaveBeenCalledOnce()

  secondTerminal.finishDisposal()
  await feature.dispose()
  assertWithdrawn()
  expect(ctx.get('remote.sidebarGit')).toBe(secondRemote)
  expect(second.service.getTabs()).toEqual([])
  expect(second.service.getFileViewers()).toEqual([])
  expect(secondTerminal.callbacks.dispose).toHaveBeenCalledOnce()
  expect(secondTerminal.stopWatching).toHaveBeenCalledOnce()
})
