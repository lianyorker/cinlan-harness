import { Context } from '@deepseek-ai/cordis'
import ComputerUseRuntime, {
  ComputerAppId,
  ComputerElementId,
  ComputerObservationId,
  ComputerWindowId,
} from '@deepseek-ai/dsh-computer-use'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import {
  apply,
  CinlanComputerUseProvider,
  CINLAN_COMPUTER_LOCAL_ENV,
  resolveCinlanComputerUseConfig,
} from '../src/index.ts'
import type { ResolvedConfig } from '../src/index.ts'

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'win32', provider: 'orca-computer-use-windows', providerVersion: '1', protocolVersion: 1,
    supports: {
      apps: { list: true, bundleIds: true, pids: true },
      windows: { list: true, targetById: true, targetByIndex: true, focus: true, moveResize: false },
      observation: { screenshot: true, annotatedScreenshot: false, elementFrames: true, ocr: false },
      actions: {
        click: true, typeText: true, pressKey: true, hotkey: true, pasteText: true,
        scroll: true, drag: true, setValue: true, performAction: true,
      },
      surfaces: { menus: true, dialogs: true, dock: false, menubar: false },
    },
    ...overrides,
  }
}

function observation(action?: unknown) {
  return {
    snapshot: {
      id: 'source', app: { name: 'App', bundleId: 'app', pid: 1 },
      window: {
        id: 2, index: null, title: 'Window', x: 0, y: 0, width: 100, height: 80,
        isMinimized: false, isOffscreen: false, screenIndex: 0,
      },
      coordinateSpace: 'window', treeText: '0 button A\n1 edit B', elementCount: 2,
      focusedElementId: 1, truncation: { truncated: false },
    },
    screenshot: null,
    screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' },
    ...(action === undefined ? {} : { action }),
  }
}

function envelope(result: unknown, runtimeId = 'runtime') {
  return JSON.stringify({ id: 'id', ok: true, result, _meta: { runtimeId } })
}

interface Response {
  readonly text: string
  readonly exitCode?: number
  readonly lossy?: boolean
  readonly reject?: Error
  readonly pending?: boolean
  readonly onSpawn?: () => void
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('fixture signal aborted')
}

class FixtureSubprocess extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []
  readonly responses: Response[] = []
  resolveError: Error | undefined
  resolvePending = false

  resolveExecutable(command: string, _env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    if (this.resolvePending) {
      return new Promise<never>((_resolve, reject) => {
        const abort = () => { reject(abortReason(signal)) }
        if (signal?.aborted === true) abort()
        else signal?.addEventListener('abort', abort, { once: true })
      })
    }
    return this.resolveError === undefined ? Promise.resolve(`C:\\bin\\${command}.exe`) : Promise.reject(this.resolveError)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const response = this.responses.shift()
    if (response === undefined) throw new Error('fixture response missing')
    const done = response.pending === true
      ? new Promise<never>((_resolve, reject) => {
        const abort = () => { reject(abortReason(spec.signal)) }
        if (spec.signal?.aborted === true) abort()
        else spec.signal?.addEventListener('abort', abort, { once: true })
      })
      : response.reject === undefined
        ? Promise.resolve({ exitCode: response.exitCode ?? 0, signal: null })
        : Promise.reject(response.reject)
    response.onSpawn?.()
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => ({ text: response.text, nextOffset: response.text.length, lossy: response.lossy ?? false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: vi.fn(),
      waitForExit: vi.fn(() => Promise.resolve(true)),
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('not used'))
  }
}

function resolved(): ResolvedConfig {
  return resolveCinlanComputerUseConfig({ commandTimeoutMs: 1_000, graceMs: 10 })
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(ComputerUseRuntime, { provider: 'cinlan' })
  await ctx.plugin(FixtureSubprocess)
  return { ctx, subprocess: ctx.subprocess as FixtureSubprocess }
}

function success(subprocess: FixtureSubprocess, value: unknown, runtimeId = 'runtime') {
  subprocess.responses.push({ text: envelope(value, runtimeId) })
}

async function observe(provider: CinlanComputerUseProvider, subprocess: FixtureSubprocess) {
  success(subprocess, observation())
  return provider.observe({ appId: ComputerAppId('app') })
}

describe('CinlanComputerUseProvider configuration', () => {
  it('defaults and validates every config field', () => {
    expect(resolveCinlanComputerUseConfig()).toMatchObject({
      providerId: 'cinlan', command: process.platform === 'linux' ? 'orca-ide' : 'orca', commandTimeoutMs: 65_000,
      graceMs: 3_000, maxJsonBytes: 16 * 1024 * 1024, maxStderrBytes: 64 * 1024,
      maxImageBytes: 16 * 1024 * 1024,
    })
    for (const config of [
      { providerId: '' }, { command: ' cinlan' }, { cwd: '' }, { commandTimeoutMs: 0 },
      { graceMs: Number.MAX_SAFE_INTEGER }, { maxJsonBytes: 0 }, { maxStderrBytes: 0 },
      { maxImageBytes: 0 }, { extra: true },
    ]) expect(() => resolveCinlanComputerUseConfig(config as never)).toThrow()
    expect(CINLAN_COMPUTER_LOCAL_ENV).toEqual({
      ORCA_PAIRING_CODE: undefined, ORCA_REMOTE_PAIRING: undefined, ORCA_ENVIRONMENT: undefined,
    })
  })
})

describe('CinlanComputerUseProvider operations', () => {
  it('covers reads and every action with one stable session namespace', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanComputerUseProvider(ctx, resolved())
    success(subprocess, capabilities())
    await expect(provider.capabilities()).resolves.toMatchObject({ protocolVersion: 1 })
    success(subprocess, { apps: [
      { name: 'App', bundleId: 'app', pid: 1, isRunning: true, lastUsedAt: null, useCount: null },
    ] })
    await expect(provider.listApps()).resolves.toMatchObject([{ appId: 'app' }])
    const listedApp = { name: 'App', bundleId: 'app', pid: 1 }
    success(subprocess, { app: listedApp, windows: [{
      app: listedApp, id: 2, index: 0, title: 'Window', x: 0, y: 0, width: 100, height: 80,
      isMinimized: false, isOffscreen: false, screenIndex: 0, platform: {}, isMain: true,
    }] })
    await expect(provider.listWindows({ appId: ComputerAppId('app') })).resolves.toMatchObject([{ windowId: 'id:2' }])

    let current = await observe(provider, subprocess)
    const actionBase = () => ({
      appId: ComputerAppId('app'), windowId: ComputerWindowId('id:2'),
      observationId: current.observationId, captureScreenshot: false,
    })
    async function runAction(call: () => Promise<{ observation: typeof current }>) {
      success(subprocess, capabilities())
      success(subprocess, observation({ path: 'accessibility', actionName: 'Action', fallbackReason: null }))
      current = (await call()).observation
    }
    await runAction(() => provider.click({
      ...actionBase(), target: { kind: 'element', elementId: ComputerElementId('0') },
      clickCount: 2, mouseButton: 'right', modifiers: 'CmdOrCtrl',
    }))
    await runAction(() => provider.click({ ...actionBase(), target: { kind: 'point', x: 3, y: 4 } }))
    await runAction(() => provider.performSecondaryAction({
      ...actionBase(), elementId: ComputerElementId('0'), action: 'Press',
    }))
    await runAction(() => provider.scroll({
      ...actionBase(), target: { kind: 'element', elementId: ComputerElementId('0') }, direction: 'down', pages: 2,
    }))
    await runAction(() => provider.scroll({
      ...actionBase(), target: { kind: 'point', x: 1, y: 2 }, direction: 'left',
    }))
    await runAction(() => provider.drag({
      ...actionBase(), target: { kind: 'elements', fromElementId: ComputerElementId('0'), toElementId: ComputerElementId('1') },
    }))
    await runAction(() => provider.drag({
      ...actionBase(), target: { kind: 'points', fromX: 1, fromY: 2, toX: 3, toY: 4 },
    }))
    await runAction(() => provider.typeText({ ...actionBase(), text: 'typed secret' }))
    await runAction(() => provider.pressKey({ ...actionBase(), key: 'Return' }))
    await runAction(() => provider.hotkey({ ...actionBase(), key: 'CmdOrCtrl+A' }))
    await runAction(() => provider.pasteText({ ...actionBase(), text: 'pasted secret' }))
    await runAction(() => provider.setValue({
      ...actionBase(), elementId: ComputerElementId('1'), value: 'set secret',
    }))

    const scoped = subprocess.specs.filter(spec => spec.argv.includes('--session'))
    const sessions = new Set(scoped.map(spec => spec.argv[spec.argv.indexOf('--session') + 1]))
    expect(sessions.size).toBe(1)
    expect(subprocess.specs.every(spec => spec.env === CINLAN_COMPUTER_LOCAL_ENV)).toBe(true)
    const sensitive = subprocess.specs.filter(spec => ['type-text', 'paste-text', 'set-value'].some(command => spec.argv.includes(command)))
    expect(sensitive.map(spec => spec.stdio.stdin)).toEqual([
      { data: 'typed secret' }, { data: 'pasted secret' }, { data: 'set secret' },
    ])
    expect(sensitive.flatMap(spec => spec.argv)).not.toContain('typed secret')
    expect(sensitive.flatMap(spec => spec.argv)).not.toContain('pasted secret')
    expect(sensitive.flatMap(spec => spec.argv)).not.toContain('set secret')
    await provider.dispose()
    expect(provider.available()).toBe(false)
    await expect(provider.dispose()).resolves.toBeUndefined()
    expect(() => provider.listApps()).toThrow(expect.objectContaining({ code: 'COMPUTER_PROVIDER_DISPOSED' }))
    await ctx.fiber.dispose()
  })

  it('enforces exact observations, element membership, window ids, and runtime generations', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanComputerUseProvider(ctx, resolved())
    let current = await observe(provider, subprocess)
    success(subprocess, capabilities())
    await expect(provider.pressKey({
      appId: ComputerAppId('app'), windowId: ComputerWindowId('id:2'),
      observationId: ComputerObservationId('wrong'), key: 'Return',
    })).rejects.toMatchObject({ code: 'COMPUTER_OBSERVATION_STALE' })

    current = await observe(provider, subprocess)
    success(subprocess, capabilities())
    await expect(provider.click({
      appId: ComputerAppId('app'), windowId: ComputerWindowId('id:2'), observationId: current.observationId,
      target: { kind: 'element', elementId: ComputerElementId('99') },
    })).rejects.toMatchObject({ code: 'COMPUTER_ELEMENT_STALE' })

    current = await observe(provider, subprocess)
    success(subprocess, capabilities(), 'runtime-next')
    await expect(provider.pressKey({
      appId: ComputerAppId('app'), windowId: ComputerWindowId('id:2'),
      observationId: current.observationId, key: 'Return',
    })).rejects.toMatchObject({ code: 'COMPUTER_RUNTIME_STALE' })
    await expect(provider.observe({ appId: ComputerAppId('app'), windowId: ComputerWindowId('bad') }))
      .rejects.toMatchObject({ code: 'COMPUTER_WINDOW_ID_INVALID' })
    await provider.dispose()
    await ctx.fiber.dispose()
  })

  it('publishes optional observation data and rejects provider target drift', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanComputerUseProvider(ctx, resolved())
    const indexed = observation()
    success(subprocess, {
      ...indexed,
      snapshot: {
        ...indexed.snapshot,
        window: { ...indexed.snapshot.window, id: null, index: 0 },
        truncation: undefined,
      },
      screenshot: { format: 'png', width: 1, height: 1, scale: 1, data: 'iVBORw0KGgo=' },
      screenshotStatus: { state: 'captured' },
    })
    const observed = await provider.observe({
      appId: ComputerAppId('app'), windowId: ComputerWindowId('index:0'),
      restoreWindow: true, captureScreenshot: true,
    }, new AbortController().signal)
    expect(observed).not.toHaveProperty('truncation')
    expect(observed.screenshot).toMatchObject({ mediaType: 'image/png' })
    expect(subprocess.specs.at(-1)?.argv).toContain('--window-index')
    expect(subprocess.specs.at(-1)?.argv).toContain('--restore-window')
    expect(subprocess.specs.at(-1)?.argv).not.toContain('--no-screenshot')

    const current = await observe(provider, subprocess)
    success(subprocess, capabilities())
    success(subprocess, observation())
    await expect(provider.pressKey({
      appId: ComputerAppId('app'), windowId: ComputerWindowId('id:2'),
      observationId: current.observationId, key: 'Return',
    })).resolves.not.toHaveProperty('action')

    const wrongApp = observation()
    success(subprocess, {
      ...wrongApp,
      snapshot: { ...wrongApp.snapshot, app: { name: 'Other', bundleId: 'other', pid: 2 } },
    })
    await expect(provider.observe({ appId: ComputerAppId('app') }))
      .rejects.toMatchObject({ code: 'COMPUTER_CINLAN_PROTOCOL' })
    success(subprocess, observation())
    await expect(provider.observe({ appId: ComputerAppId('app'), windowId: ComputerWindowId('id:3') }))
      .rejects.toMatchObject({ code: 'COMPUTER_CINLAN_PROTOCOL' })

    const other = { name: 'Other', bundleId: 'other', pid: 2 }
    success(subprocess, { app: other, windows: [{
      app: other, id: 3, index: 0, title: 'Other', width: 10, height: 10,
    }] })
    await expect(provider.listWindows({ appId: ComputerAppId('app') }))
      .rejects.toMatchObject({ code: 'COMPUTER_CINLAN_PROTOCOL' })
    await provider.dispose()
    await ctx.fiber.dispose()
  })

  it('classifies timeout, caller, and lifecycle aborts', async () => {
    const timeoutHarness = await harness()
    const timeoutProvider = new CinlanComputerUseProvider(
      timeoutHarness.ctx,
      resolveCinlanComputerUseConfig({ commandTimeoutMs: 1, graceMs: 10 }),
    )
    timeoutHarness.subprocess.responses.push({ text: '', pending: true })
    await expect(timeoutProvider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CLI_TIMEOUT' })
    await timeoutProvider.dispose()
    await timeoutHarness.ctx.fiber.dispose()

    const callerHarness = await harness()
    const callerProvider = new CinlanComputerUseProvider(callerHarness.ctx, resolved())
    const caller = new AbortController()
    const reason = new Error('caller aborted')
    callerHarness.subprocess.responses.push({
      text: envelope({ apps: [] }), onSpawn: () => { caller.abort(reason) },
    })
    await expect(callerProvider.listApps(caller.signal)).rejects.toBe(reason)
    await callerProvider.dispose()
    await callerHarness.ctx.fiber.dispose()

    const lifecycleHarness = await harness()
    const lifecycleProvider = new CinlanComputerUseProvider(lifecycleHarness.ctx, resolved())
    lifecycleHarness.subprocess.responses.push({ text: '', pending: true })
    const operation = lifecycleProvider.listApps()
    const rejection = expect(operation).rejects.toMatchObject({ code: 'COMPUTER_PROVIDER_DISPOSED' })
    await lifecycleProvider.dispose()
    await rejection
    await lifecycleHarness.ctx.fiber.dispose()
  })

  it('maps CLI failures, status disagreement, response limits, and launch failures', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanComputerUseProvider(ctx, resolved())
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false,
      error: { code: 'app_not_found', message: 'missing', data: { nextSteps: ['list apps'] } },
      _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest's asymmetric matcher is typed as any.
    await expect(provider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_APP_NOT_FOUND', message: expect.stringContaining('Next step') })
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false, error: { code: 'custom-error', message: 'failed' }, _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    await expect(provider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CINLAN_CUSTOM_ERROR' })
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false, error: { code: '---', message: 'failed' }, _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    await expect(provider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CINLAN_ERROR' })
    subprocess.responses.push({ text: envelope({ apps: [] }), exitCode: 1 })
    await expect(provider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CINLAN_PROTOCOL' })
    subprocess.responses.push({ text: envelope({ apps: [] }), lossy: true })
    await expect(provider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CLI_RESPONSE_TOO_LARGE' })
    subprocess.responses.push({ text: '', reject: new Error('spawn failed') })
    await expect(provider.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CLI_FAILED' })
    await provider.dispose()
    await ctx.fiber.dispose()
  })
})

describe('computer-use-cinlan plugin apply', () => {
  it('registers immediately and resolves the executable lazily on first operation', async () => {
    const { ctx, subprocess } = await harness()
    apply(ctx, { command: 'cinlan', commandTimeoutMs: 1_000 })
    expect(subprocess.specs).toHaveLength(0)
    success(subprocess, { apps: [] })
    await expect(ctx.computerUse.listApps()).resolves.toEqual([])
    expect(subprocess.specs[0]?.argv).toEqual(['C:\\bin\\cinlan.exe', 'computer', 'list-apps', '--json'])
    await ctx.fiber.dispose()
  })

  it('defers executable resolution and timeout failures to the first operation', async () => {
    const timeout = await harness()
    timeout.subprocess.resolvePending = true
    apply(timeout.ctx, { commandTimeoutMs: 1 })
    await expect(timeout.ctx.computerUse.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CLI_TIMEOUT' })
    await timeout.ctx.fiber.dispose()

    const unavailable = await harness()
    unavailable.subprocess.resolveError = new Error('missing')
    apply(unavailable.ctx, { commandTimeoutMs: 1_000 })
    await expect(unavailable.ctx.computerUse.listApps()).rejects.toMatchObject({ code: 'COMPUTER_CLI_UNAVAILABLE' })
    await unavailable.ctx.fiber.dispose()
  })
})

describe('CinlanComputerUseProvider readiness recovery', () => {
  it('retries executable lookup after the CLI becomes available', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanComputerUseProvider(ctx, resolved())
    try {
      subprocess.resolveError = new Error('not installed')
      await expect(provider.capabilities()).rejects.toMatchObject({ code: 'COMPUTER_CLI_UNAVAILABLE' })
      subprocess.resolveError = undefined
      success(subprocess, capabilities())
      await expect(provider.capabilities()).resolves.toBeDefined()
      expect(subprocess.specs).toHaveLength(1)
    } finally {
      await provider.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('cancels an outstanding executable lookup during disposal without spawning', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanComputerUseProvider(ctx, resolved())
    subprocess.resolvePending = true
    try {
      const pending = expect(provider.capabilities()).rejects.toMatchObject({ code: 'COMPUTER_PROVIDER_DISPOSED' })
      await provider.dispose()
      await pending
      expect(subprocess.specs).toHaveLength(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
