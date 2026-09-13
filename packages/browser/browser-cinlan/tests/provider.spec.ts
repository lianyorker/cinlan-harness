import { Context } from '@deepseek-ai/cordis'
import BrowserRuntime, {
  BrowserElementId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as CinlanBrowser from '../src/index.ts'
import {
  CINLAN_LOCAL_ENV,
  CinlanBrowserProvider,
  resolveCinlanBrowserConfig,
} from '../src/index.ts'

interface Script {
  readonly stdout?: string
  readonly outcome?: SubprocessOutcome
  readonly lossy?: boolean
  readonly spawnError?: unknown
  readonly doneError?: Error
  readonly done?: (signal: AbortSignal) => Promise<SubprocessOutcome>
}

function success(result: unknown, runtimeId = 'runtime-1'): string {
  return JSON.stringify({ id: 'request', ok: true, result, _meta: { runtimeId } })
}

function failure(code: string, message = code, runtimeId: string | null = 'runtime-1'): string {
  return JSON.stringify({ id: 'request', ok: false, error: { code, message }, _meta: { runtimeId } })
}

function evalSuccess(payload: unknown, runtimeId = 'runtime-1'): string {
  return success({ result: JSON.stringify(payload), origin: 'https://example.test' }, runtimeId)
}

function outcome(exitCode: number | null = 0, signal: NodeJS.Signals | null = null): SubprocessOutcome {
  return { exitCode, signal }
}

class ScriptedSubprocess extends SubprocessRuntime {
  readonly scripts: Script[] = []
  readonly specs: SubprocessSpawnSpec[] = []
  readonly resolutions: { command: string; env: Readonly<Record<string, string>> | undefined; signal: AbortSignal | undefined }[] = []
  resolveImpl: (command: string, signal: AbortSignal | undefined) => Promise<string> = command => Promise.resolve(`resolved:${command}`)

  async resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    this.resolutions.push({ command, env, signal })
    return this.resolveImpl(command, signal)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const script = this.scripts.shift() ?? {
      stdout: failure('browser_tab_not_found', 'already gone'),
      outcome: outcome(1),
    }
    if (script.spawnError !== undefined) throw script.spawnError
    const stdout = script.stdout ?? ''
    const signal = spec.signal ?? new AbortController().signal
    const done = script.done !== undefined
      ? script.done(signal)
      : script.doneError !== undefined
        ? Promise.reject(script.doneError)
        : Promise.resolve(script.outcome ?? outcome())
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: {
          readFrom: () => ({
            text: stdout,
            nextOffset: Buffer.byteLength(stdout),
            lossy: script.lossy ?? false,
          }),
        },
        stderr: {
          readFrom: () => ({ text: '', nextOffset: 0, lossy: false }),
        },
      },
      done,
      terminate() {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('unused terminal primitive'))
  }
}

const providers: CinlanBrowserProvider[] = []
const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.allSettled(providers.splice(0).map(provider => provider.dispose()))
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(overrides: CinlanBrowser.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ScriptedSubprocess)
  const subprocess = ctx.subprocess as ScriptedSubprocess
  const config = resolveCinlanBrowserConfig(Object.assign({
    cwd: 'C:/workspace',
    commandTimeoutMs: 1_000,
    cleanupTimeoutMs: 1_000,
    graceMs: 25,
    maxJsonBytes: 4_096,
    maxStderrBytes: 512,
    maxImageBytes: 128,
  }, overrides))
  subprocess.resolveImpl = () => Promise.resolve('C:/bin/cinlan.exe')
  const provider = new CinlanBrowserProvider(ctx, config)
  providers.push(provider)
  return { ctx, subprocess, provider, config }
}

describe('Cinlan browser provider config', () => {
  it('defaults every deployment choice explicitly', () => {
    expect(resolveCinlanBrowserConfig()).toMatchObject({
      providerId: 'cinlan',
      command: process.platform === 'linux' ? 'orca-ide' : 'orca',
      cwd: process.cwd(),
      worktree: 'active',
      commandTimeoutMs: 65_000,
      cleanupTimeoutMs: 15_000,
      graceMs: 3_000,
      maxJsonBytes: 16 * 1024 * 1024,
      maxStderrBytes: 64 * 1024,
      maxImageBytes: 10 * 1024 * 1024,
    })
  })

  it.each(['providerId', 'command', 'cwd', 'worktree'] as const)('rejects an invalid %s', (key) => {
    expect(() => resolveCinlanBrowserConfig({ [key]: '' })).toThrow(`${key} must be non-empty`)
    expect(() => resolveCinlanBrowserConfig({ [key]: ' padded ' })).toThrow(`${key} must be non-empty`)
  })

  it.each([
    'commandTimeoutMs', 'cleanupTimeoutMs', 'graceMs', 'maxJsonBytes', 'maxStderrBytes', 'maxImageBytes',
  ] as const)('rejects invalid %s values', (key) => {
    expect(() => resolveCinlanBrowserConfig({ [key]: 0 })).toThrow(/positive safe integer/)
    expect(() => resolveCinlanBrowserConfig({ [key]: 1.5 })).toThrow(/positive safe integer/)
    expect(() => resolveCinlanBrowserConfig({ [key]: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/positive safe integer/)
  })

  it('rejects timer values above the Node timer limit and unknown keys', () => {
    expect(() => resolveCinlanBrowserConfig({ commandTimeoutMs: 2_147_483_648 })).toThrow(/no greater than/)
    expect(() => resolveCinlanBrowserConfig({ extra: true } as never)).toThrow(/unsupported config key 'extra'/)
    expect(() => resolveCinlanBrowserConfig({ closeOwnedPagesOnDispose: false } as never))
      .toThrow(/unsupported config key 'closeOwnedPagesOnDispose'/)
  })
})

describe('Cinlan browser command execution', () => {
  it('uses only bounded argv-based public JSON commands and maps every success result', async () => {
    const { provider, subprocess, config } = await harness({ worktree: 'worktree-1' })
    subprocess.scripts.push(
      { stdout: success({ tabs: [{ browserPageId: 'external', index: 0, url: 'https://external.test', title: 'External', active: true }] }) },
      { stdout: success({ browserPageId: 'owned' }) },
      { stdout: success({ url: 'https://example.com/next', title: 'Next' }) },
      { stdout: success({ browserPageId: 'owned', snapshot: 'button [ref=e1]', refs: [{ ref: 'e1', role: 'button', name: 'Continue' }], url: 'https://example.com/next', title: 'Next' }) },
      { stdout: success({ clicked: 'e1' }) },
      { stdout: success({ data: 'AQID', format: 'png' }) },
      { stdout: success({ closed: true }) },
    )

    await expect(provider.listPages()).resolves.toMatchObject([{ pageId: 'external' }])
    await expect(provider.openPage({ url: 'https://example.com' })).resolves.toEqual({ pageId: 'owned' })
    await expect(provider.navigate({ pageId: BrowserPageId('owned'), url: 'https://example.com/next' }))
      .resolves.toEqual({ pageId: 'owned', url: 'https://example.com/next', title: 'Next' })
    const observation = await provider.snapshot({ pageId: BrowserPageId('owned') })
    expect(observation).toMatchObject({ pageId: 'owned', tree: 'button [ref=e1]' })
    await expect(provider.click({
      pageId: BrowserPageId('owned'),
      observationId: observation.observationId,
      elementId: BrowserElementId('e1'),
    })).resolves.toMatchObject({ pageId: 'owned', elementId: 'e1' })
    await expect(provider.screenshot({ pageId: BrowserPageId('owned'), format: 'png' })).resolves.toEqual({
      pageId: 'owned', format: 'png', mediaType: 'image/png', data: Uint8Array.of(1, 2, 3),
    })
    await expect(provider.closePage({ pageId: BrowserPageId('owned') })).resolves.toBeUndefined()

    expect(subprocess.specs.map(spec => spec.argv)).toEqual([
      ['C:/bin/cinlan.exe', 'tab', 'list', '--worktree', 'worktree-1', '--json'],
      ['C:/bin/cinlan.exe', 'tab', 'create', '--url', 'https://example.com', '--worktree', 'worktree-1', '--json'],
      ['C:/bin/cinlan.exe', 'goto', '--page', 'owned', '--url', 'https://example.com/next', '--worktree', 'worktree-1', '--json'],
      ['C:/bin/cinlan.exe', 'snapshot', '--page', 'owned', '--worktree', 'worktree-1', '--json'],
      ['C:/bin/cinlan.exe', 'click', '--page', 'owned', '--element', 'e1', '--worktree', 'worktree-1', '--json'],
      ['C:/bin/cinlan.exe', 'screenshot', '--page', 'owned', '--format', 'png', '--worktree', 'worktree-1', '--json'],
      ['C:/bin/cinlan.exe', 'tab', 'close', '--page', 'owned', '--worktree', 'worktree-1', '--json'],
    ])
    for (const spec of subprocess.specs) {
      expect(spec).toMatchObject({
        cwd: config.cwd,
        graceMs: config.graceMs,
        env: CINLAN_LOCAL_ENV,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: config.maxJsonBytes },
          stderr: { maxBytes: config.maxStderrBytes },
        },
      })
      expect(spec.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('maps JPEG screenshots and provider failures without leaking provider fields', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { stdout: success({ data: 'AQ==', format: 'jpeg' }) },
      { stdout: failure('browser_tab_not_found', 'missing'), outcome: outcome(1) },
      { stdout: failure('browser_tab_not_found', 'missing list'), outcome: outcome(1) },
      { stdout: failure('browser_stale_ref', 'stale'), outcome: outcome(1) },
      { stdout: failure('vendor.error-code', 'vendor failure'), outcome: outcome(1) },
      { stdout: failure('---', 'empty code'), outcome: outcome(1) },
    )
    await expect(provider.screenshot({ pageId: BrowserPageId('page'), format: 'jpeg' })).resolves.toMatchObject({
      format: 'jpeg', mediaType: 'image/jpeg', data: Uint8Array.of(1),
    })
    await expect(provider.navigate({ pageId: BrowserPageId('missing'), url: 'https://example.com' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PAGE_NOT_FOUND' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PAGE_NOT_FOUND' }))
    await expect(provider.click({
      pageId: BrowserPageId('page'),
      observationId: BrowserObservationId('unknown'),
      elementId: BrowserElementId('e1'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_OBSERVATION_STALE' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_VENDOR_ERROR_CODE' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_ERROR' }))
  })

  it('rejects launch, output, exit-status, and result-identity violations', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { spawnError: new Error('spawn failed') },
      { doneError: new Error('close failed') },
      { stdout: success({ tabs: [] }), lossy: true },
      { stdout: success({ tabs: [] }), outcome: outcome(2) },
      { stdout: failure('bad', 'bad'), outcome: outcome(0) },
      { stdout: success({ browserPageId: 'other', snapshot: '', refs: [], url: '', title: '' }) },
      { stdout: success({ browserPageId: 'page', snapshot: '', refs: [{ ref: 'e1', role: 'button', name: 'A' }], url: '', title: '' }) },
      { stdout: success({ clicked: 'e2' }) },
      { stdout: success({ data: 'AQ==', format: 'jpeg' }) },
      { stdout: success({ closed: false }) },
    )

    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLI_FAILED' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLI_FAILED' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLI_RESPONSE_TOO_LARGE' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_PROTOCOL' }))
    await expect(provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_PROTOCOL' }))
    await expect(provider.snapshot({ pageId: BrowserPageId('page') })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_PROTOCOL' }))
    const observation = await provider.snapshot({ pageId: BrowserPageId('page') })
    await expect(provider.click({
      pageId: BrowserPageId('page'), observationId: observation.observationId, elementId: BrowserElementId('e1'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_PROTOCOL' }))
    await expect(provider.screenshot({ pageId: BrowserPageId('page'), format: 'png' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_PROTOCOL' }))
    await expect(provider.closePage({ pageId: BrowserPageId('page') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PAGE_NOT_FOUND' }))
  })

  it('enforces runtime, observation, and element freshness before subprocess dispatch', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { stdout: success({ tabs: [{ browserPageId: 'old', index: 0, url: '', title: '', active: true }] }, 'runtime-1') },
      { stdout: success({ tabs: [{ browserPageId: 'current', index: 0, url: '', title: '', active: true }] }, 'runtime-2') },
    )
    await provider.listPages()
    await provider.listPages()
    const count = subprocess.specs.length
    await expect(provider.snapshot({ pageId: BrowserPageId('old') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_RUNTIME_STALE' }))
    expect(subprocess.specs).toHaveLength(count)

    subprocess.scripts.push(
      { stdout: success({ browserPageId: 'current', snapshot: '', refs: [{ ref: 'e1', role: 'button', name: 'A' }], url: '', title: '' }, 'runtime-2') },
    )
    const observation = await provider.snapshot({ pageId: BrowserPageId('current') })
    await expect(provider.click({
      pageId: BrowserPageId('current'),
      observationId: BrowserObservationId('wrong'),
      elementId: BrowserElementId('e1'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_OBSERVATION_STALE' }))
    await expect(provider.click({
      pageId: BrowserPageId('current'),
      observationId: observation.observationId,
      elementId: BrowserElementId('missing'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))

    subprocess.scripts.push({ stdout: failure('browser_stale_ref', 'stale', 'runtime-2'), outcome: outcome(1) })
    await expect(provider.click({
      pageId: BrowserPageId('current'),
      observationId: observation.observationId,
      elementId: BrowserElementId('e1'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))
    await expect(provider.click({
      pageId: BrowserPageId('current'),
      observationId: observation.observationId,
      elementId: BrowserElementId('e1'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_OBSERVATION_STALE' }))
  })

  it('detects a runtime restart observed by the operation itself', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { stdout: success({ tabs: [{ browserPageId: 'page', index: 0, url: '', title: '', active: true }] }, 'runtime-1') },
      { stdout: success({ browserPageId: 'page', snapshot: '', refs: [], url: '', title: '' }, 'runtime-2') },
    )
    await provider.listPages()
    await expect(provider.snapshot({ pageId: BrowserPageId('page') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_RUNTIME_STALE' }))
  })
})

describe('Cinlan browser element selection and capture', () => {
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const payload = {
    tagName: 'button',
    role: 'button',
    name: 'Continue',
    text: 'Continue',
    rect: { x: 0, y: 0, width: 1, height: 1 },
    viewport: { width: 1, height: 1 },
  }

  it('uses eval --expression, retains a selection marker, crops the viewport, and consumes the selection', async () => {
    const { provider, subprocess } = await harness({ maxImageBytes: 4_096 })
    subprocess.scripts.push(
      { stdout: evalSuccess(payload) },
      { stdout: evalSuccess(null) },
      { stdout: evalSuccess(payload) },
      { stdout: success({ data: image, format: 'png' }) },
      { stdout: evalSuccess(payload) },
      { stdout: evalSuccess(null) },
    )

    const selection = await provider.selectElement({ pageId: BrowserPageId('page') })
    expect(selection).toMatchObject({
      pageId: 'page', tagName: 'button', role: 'button', name: 'Continue', text: 'Continue',
      rect: payload.rect,
    })
    const capture = await provider.captureElement({
      pageId: BrowserPageId('page'),
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })
    expect(capture).toMatchObject({
      pageId: 'page',
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
      mediaType: 'image/png',
      rect: payload.rect,
      viewport: payload.viewport,
      verified: true,
      tagName: 'button',
      role: 'button',
      name: 'Continue',
    })
    expect(capture.data.byteLength).toBeGreaterThan(0)
    await expect(provider.captureElement({
      pageId: BrowserPageId('page'),
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))

    const evalArgv = subprocess.specs
      .filter(spec => spec.argv.includes('eval'))
      .map(spec => spec.argv)
    expect(evalArgv).toHaveLength(5)
    for (const argv of evalArgv) {
      expect(argv).toContain('--expression')
      expect(argv).not.toContain('--script')
    }
    expect(subprocess.specs.map(spec => spec.argv.slice(1, 3))).toEqual([
      ['eval', '--page'], ['eval', '--page'], ['eval', '--page'],
      ['screenshot', '--page'], ['eval', '--page'], ['eval', '--page'],
    ])
  })

  it('consumes a selection before concurrent capture can launch another command', async () => {
    const { provider, subprocess } = await harness({ maxImageBytes: 4_096 })
    subprocess.scripts.push(
      { stdout: evalSuccess(payload) }, { stdout: evalSuccess(null) },
      { stdout: evalSuccess(payload) }, { stdout: success({ data: image, format: 'png' }) },
      { stdout: evalSuccess(payload) }, { stdout: evalSuccess(null) },
    )
    const selection = await provider.selectElement({ pageId: BrowserPageId('page') })
    const request = { pageId: selection.pageId, target: { kind: 'selection' as const, selectionId: selection.selectionId }, format: 'png' as const }
    const capture = provider.captureElement(request)
    await expect(provider.captureElement(request)).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE' })
    await expect(capture).resolves.toMatchObject({ verified: true })
    expect(subprocess.specs.filter(spec => spec.argv.includes('screenshot'))).toHaveLength(1)
  })

  it.each([
    { ...payload, name: 'Changed' },
    { ...payload, rect: { ...payload.rect, x: 0.75 } },
    { ...payload, viewport: { width: 2, height: 1 } },
    null,
  ])('rejects post-screenshot changes and preserves the error when cleanup fails', async (after) => {
    const { provider, subprocess } = await harness({ maxImageBytes: 4_096 })
    subprocess.scripts.push(
      { stdout: evalSuccess(payload) }, { stdout: evalSuccess(null) },
      { stdout: evalSuccess(payload) }, { stdout: success({ data: image, format: 'png' }) },
      { stdout: evalSuccess(after) }, { stdout: failure('cleanup_failed'), outcome: outcome(1) },
    )
    const selection = await provider.selectElement({ pageId: BrowserPageId('page') })
    const request = { pageId: selection.pageId, target: { kind: 'selection' as const, selectionId: selection.selectionId }, format: 'png' as const }
    await expect(provider.captureElement(request)).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CHANGED' })
    await expect(provider.captureElement(request)).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE' })
    expect(subprocess.specs).toHaveLength(6)
    expect(subprocess.specs.at(-1)?.argv.join(' ')).toContain('removeAttribute')
  })

  it('rejects a runtime restart between selection and screenshot and consumes the selection', async () => {
    const { provider, subprocess } = await harness({ maxImageBytes: 4_096 })
    subprocess.scripts.push(
      { stdout: evalSuccess(payload) }, { stdout: evalSuccess(null) },
      { stdout: evalSuccess(payload) }, { stdout: success({ data: image, format: 'png' }, 'runtime-2') },
      { stdout: evalSuccess(null, 'runtime-2') },
    )
    const selection = await provider.selectElement({ pageId: BrowserPageId('page') })
    await expect(provider.captureElement({
      pageId: selection.pageId, target: { kind: 'selection', selectionId: selection.selectionId }, format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_RUNTIME_STALE' })
    expect(subprocess.specs).toHaveLength(5)
  })

  it('preserves caller cancellation during capture and cleans the consumed marker', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push({ stdout: evalSuccess(payload) }, { stdout: evalSuccess(null) })
    const selection = await provider.selectElement({ pageId: BrowserPageId('page') })
    const request = { pageId: selection.pageId, target: { kind: 'selection' as const, selectionId: selection.selectionId }, format: 'png' as const }
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    subprocess.scripts.push({ done: signal => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(outcome(null, 'SIGTERM')), { once: true })
      started()
    }) }, { stdout: evalSuccess(null) })
    const caller = new AbortController()
    const reason = new Error('capture cancelled')
    const pending = expect(provider.captureElement(request, caller.signal)).rejects.toBe(reason)
    await ready
    caller.abort(reason)
    await pending
    await expect(provider.captureElement(request)).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE' })
    expect(subprocess.specs.at(-1)?.argv.join(' ')).toContain('removeAttribute')
    expect(subprocess.specs.at(-1)?.signal?.aborted).toBe(false)
  })

  it('maps Escape cancellation and selection deadlines, and always attempts cleanup', async () => {
    const cancelled = await harness()
    cancelled.subprocess.scripts.push({ stdout: evalSuccess(null) })
    await expect(cancelled.provider.selectElement({ pageId: BrowserPageId('page') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SELECTION_CANCELLED' }))
    expect(cancelled.subprocess.specs.filter(spec => spec.argv.includes('eval'))).toHaveLength(3)

    vi.useFakeTimers()
    const timed = await harness({ selectionTimeoutMs: 10 })
    timed.subprocess.scripts.push({ done: signal => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(outcome(null, 'SIGTERM')), { once: true })
    }) })
    const pending = timed.provider.selectElement({ pageId: BrowserPageId('page') })
    const result = expect(pending).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SELECTION_TIMEOUT' }))
    await vi.advanceTimersByTimeAsync(10)
    await result
    expect(timed.subprocess.specs.filter(spec => spec.argv.includes('eval'))).toHaveLength(3)
    vi.useRealTimers()
  })

  it('rejects changed selections and explicitly rejects opaque observation refs', async () => {
    const changed = await harness({ maxImageBytes: 4_096 })
    changed.subprocess.scripts.push(
      { stdout: evalSuccess(payload) },
      { stdout: evalSuccess(null) },
      { stdout: evalSuccess({ ...payload, name: 'Changed', text: 'Changed' }) },
      { stdout: evalSuccess(null) },
    )
    const selection = await changed.provider.selectElement({ pageId: BrowserPageId('page') })
    await expect(changed.provider.captureElement({
      pageId: BrowserPageId('page'),
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CHANGED' }))

    const observation = await harness()
    observation.subprocess.scripts.push({
      stdout: success({
        browserPageId: 'page', snapshot: 'button [ref=e1]',
        refs: [{ ref: 'e1', role: 'button', name: 'Continue' }], url: '', title: '',
      }),
    })
    const current = await observation.provider.snapshot({ pageId: BrowserPageId('page') })
    await expect(observation.provider.captureElement({
      pageId: BrowserPageId('page'),
      target: { kind: 'observation', observationId: current.observationId, elementId: BrowserElementId('e1') },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_FEATURE_UNSUPPORTED' }))
    expect(observation.subprocess.specs).toHaveLength(1)
  })
})

describe('Cinlan browser cancellation and lifecycle', () => {
  function waitsForAbort(signal: AbortSignal): Promise<SubprocessOutcome> {
    return new Promise((resolve) => {
      const settle = () => { resolve(outcome(null, 'SIGTERM')) }
      if (signal.aborted) settle()
      else signal.addEventListener('abort', settle, { once: true })
    })
  }

  function rejectsOnAbort(signal: AbortSignal): Promise<SubprocessOutcome> {
    return new Promise((_resolve, reject) => {
      const settle = () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error('aborted'))
      }
      if (signal.aborted) settle()
      else signal.addEventListener('abort', settle, { once: true })
    })
  }

  it('preserves caller cancellation, classifies deadlines, and joins disposal cancellation', async () => {
    const callerHarness = await harness()
    callerHarness.subprocess.scripts.push({ done: waitsForAbort })
    const caller = new AbortController()
    const callerFailure = new Error('caller stopped')
    const pendingCaller = callerHarness.provider.listPages(caller.signal)
    caller.abort(callerFailure)
    await expect(pendingCaller).rejects.toBe(callerFailure)

    const rejectingHarness = await harness()
    rejectingHarness.subprocess.scripts.push({ done: rejectsOnAbort })
    const rejectingCaller = new AbortController()
    const rejectingFailure = new Error('caller rejected')
    const rejectingPending = rejectingHarness.provider.listPages(rejectingCaller.signal)
    rejectingCaller.abort(rejectingFailure)
    await expect(rejectingPending).rejects.toBe(rejectingFailure)

    vi.useFakeTimers()
    const timeoutHarness = await harness({ commandTimeoutMs: 10 })
    timeoutHarness.subprocess.scripts.push({ done: waitsForAbort })
    const pendingTimeout = timeoutHarness.provider.listPages()
    const timeoutFailure = expect(pendingTimeout).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLI_TIMEOUT' }))
    await vi.advanceTimersByTimeAsync(10)
    await timeoutFailure
    vi.useRealTimers()

    const disposalHarness = await harness()
    disposalHarness.subprocess.scripts.push({ done: waitsForAbort })
    const pendingDisposal = disposalHarness.provider.listPages()
    await expect(disposalHarness.provider.dispose()).resolves.toBeUndefined()
    await expect(pendingDisposal).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_DISPOSED' }))
    expect(disposalHarness.provider.available()).toBe(false)
    await expect(disposalHarness.provider.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_DISPOSED' }))
  })

  it('cancels executable lookup with its caller and retries without poisoning other calls', async () => {
    const { provider, subprocess } = await harness()
    subprocess.resolveImpl = async (_command, signal) => {
      await rejectsOnAbort(signal!)
      return 'unreachable'
    }
    const caller = new AbortController()
    const reason = new Error('cancel lookup')
    const pending = provider.listPages(caller.signal)
    const cancelled = expect(pending).rejects.toBe(reason)
    expect(subprocess.resolutions).toHaveLength(1)
    subprocess.resolveImpl = () => Promise.resolve('C:/bin/cinlan.exe')
    subprocess.scripts.push({ stdout: success({ tabs: [] }) })
    const independent = provider.listPages()
    caller.abort(reason)
    await cancelled
    await expect(independent).resolves.toEqual([])
    expect(subprocess.specs).toHaveLength(1)
    subprocess.scripts.push({ stdout: success({ tabs: [] }) })
    await expect(provider.listPages()).resolves.toEqual([])
    expect(subprocess.resolutions).toHaveLength(2)
  })

  it('joins lookup cancellation during disposal without launching a command', async () => {
    const { provider, subprocess } = await harness()
    let joined = false
    subprocess.resolveImpl = async (_command, signal) => {
      try {
        await rejectsOnAbort(signal!)
        return 'unreachable'
      } finally {
        joined = true
      }
    }
    const pending = provider.listPages()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'BROWSER_PROVIDER_DISPOSED' })
    await provider.dispose()
    await rejected
    expect(joined).toBe(true)
    expect(subprocess.specs).toEqual([])
  })

  it('counts lookup time in the command deadline and allows retry after a lookup miss', async () => {
    vi.useFakeTimers()
    const { provider, subprocess } = await harness({ commandTimeoutMs: 10 })
    subprocess.resolveImpl = async () => {
      await new Promise(resolve => setTimeout(resolve, 6))
      return 'C:/bin/cinlan.exe'
    }
    subprocess.scripts.push({ done: waitsForAbort })
    const pending = expect(provider.listPages()).rejects.toMatchObject({ code: 'BROWSER_CLI_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(10)
    await pending
    vi.useRealTimers()

    const retry = await harness()
    retry.subprocess.resolveImpl = () => Promise.reject(new Error('missing'))
    await expect(retry.provider.listPages()).rejects.toMatchObject({ code: 'BROWSER_CLI_UNAVAILABLE' })
    retry.subprocess.resolveImpl = () => Promise.resolve('C:/bin/cinlan.exe')
    retry.subprocess.scripts.push({ stdout: success({ tabs: [] }) })
    await expect(retry.provider.listPages()).resolves.toEqual([])
  })

  it('reports unconfirmed closure while still closing the remaining owned pages', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { stdout: success({ browserPageId: 'one' }) },
      { stdout: success({ browserPageId: 'two' }) },
      { stdout: success({ closed: false }) },
      { stdout: success({ closed: true }) },
    )
    await provider.openPage({ url: 'https://one.test' })
    await provider.openPage({ url: 'https://two.test' })
    await expect(provider.dispose()).rejects.toMatchObject({ code: 'BROWSER_CINLAN_CLEANUP_FAILED' })
    expect(subprocess.specs.at(-1)?.argv).toContain('two')
  })

  it('closes only current-runtime pages created by this provider and ignores already-gone tabs', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { stdout: success({ browserPageId: 'owned-1' }) },
      { stdout: success({ browserPageId: 'owned-2' }) },
      { stdout: success({ tabs: [{ browserPageId: 'external', index: 0, url: '', title: '', active: true }] }) },
      { stdout: success({ closed: true }) },
      { stdout: failure('browser_tab_not_found', 'gone'), outcome: outcome(1) },
    )
    await provider.openPage({ url: 'https://one.test' })
    await provider.openPage({ url: 'https://two.test' })
    await provider.listPages()
    await expect(provider.dispose()).resolves.toBeUndefined()
    expect(subprocess.specs.slice(-2).map(spec => spec.argv.slice(1, 5))).toEqual([
      ['tab', 'close', '--page', 'owned-1'],
      ['tab', 'close', '--page', 'owned-2'],
    ])
    expect(subprocess.specs.some(spec => spec.argv.includes('external'))).toBe(false)
    await expect(provider.dispose()).resolves.toBeUndefined()
  })

  it('treats a cleanup-time runtime restart as ownership expiry', async () => {
    const { provider, subprocess } = await harness()
    subprocess.scripts.push(
      { stdout: success({ browserPageId: 'owned' }, 'runtime-1') },
      { stdout: success({ closed: true }, 'runtime-2') },
    )
    await provider.openPage({ url: 'https://example.com' })
    await expect(provider.dispose()).resolves.toBeUndefined()
  })

  it('reports one or several cleanup failures after all current-runtime tabs settle', async () => {
    const single = await harness()
    single.subprocess.scripts.push(
      { stdout: success({ browserPageId: 'owned' }) },
      { stdout: failure('cleanup_failed', 'cleanup failed'), outcome: outcome(1) },
    )
    await single.provider.openPage({ url: 'https://example.com' })
    await expect(single.provider.dispose()).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_CINLAN_CLEANUP_FAILED',
    }))

    const multiple = await harness()
    multiple.subprocess.scripts.push(
      { stdout: success({ browserPageId: 'one' }) },
      { stdout: success({ browserPageId: 'two' }) },
      { stdout: failure('cleanup_one', 'one'), outcome: outcome(1) },
      { stdout: failure('cleanup_two', 'two'), outcome: outcome(1) },
    )
    await multiple.provider.openPage({ url: 'https://one.test' })
    await multiple.provider.openPage({ url: 'https://two.test' })
    await expect(multiple.provider.dispose()).rejects.toBeInstanceOf(AggregateError)
  })

  it('disposes cleanly before observing any runtime', async () => {
    const { provider } = await harness()
    await expect(provider.dispose()).resolves.toBeUndefined()
  })
})

describe('Cinlan browser Cordis plugin', () => {
  it('registers immediately, resolves the executable lazily, and HMR-disposes the provider', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(BrowserRuntime)
    await ctx.plugin(ScriptedSubprocess)
    const subprocess = ctx.subprocess as ScriptedSubprocess
    subprocess.scripts.push(
      { stdout: success({ browserPageId: 'owned' }) },
      { stdout: success({ closed: true }) },
    )
    const fiber = await ctx.plugin(CinlanBrowser, {
      command: 'cinlan-custom', cwd: 'C:/workspace', commandTimeoutMs: 1_000, cleanupTimeoutMs: 1_000,
    })
    expect(subprocess.resolutions).toHaveLength(0)
    await expect(ctx.browser.openPage({ url: 'https://example.com' })).resolves.toEqual({ pageId: 'owned' })
    expect(subprocess.resolutions).toHaveLength(1)
    expect(subprocess.resolutions[0]).toMatchObject({ command: 'cinlan-custom', env: {} })
    expect(subprocess.resolutions[0]?.signal).toBeInstanceOf(AbortSignal)
    await fiber.dispose()
    await expect(ctx.browser.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_UNAVAILABLE' }))
    expect(subprocess.specs.at(-1)?.argv).toContain('owned')

    subprocess.scripts.push(
      { stdout: success({ tabs: [] }) },
      { stdout: success({ tabs: [] }) },
    )
    const replacement = await ctx.plugin(CinlanBrowser, { commandTimeoutMs: 1_000, cleanupTimeoutMs: 1_000 })
    await expect(ctx.browser.listPages()).resolves.toEqual([])
    await replacement.dispose()
  })

  it('defers executable lookup, startup probe, and timeout failures to the first operation', async () => {
    const failed = new Context()
    contexts.push(failed)
    await failed.plugin(BrowserRuntime)
    await failed.plugin(ScriptedSubprocess)
    ;(failed.subprocess as ScriptedSubprocess).resolveImpl = () => Promise.reject(new Error('not found'))
    await failed.plugin(CinlanBrowser, { command: 'missing', commandTimeoutMs: 100 })
    await expect(failed.browser.listPages())
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLI_UNAVAILABLE' }))

    const unavailable = new Context()
    contexts.push(unavailable)
    await unavailable.plugin(BrowserRuntime)
    await unavailable.plugin(ScriptedSubprocess)
    ;(unavailable.subprocess as ScriptedSubprocess).scripts.push({
      stdout: failure('browser_runtime_unavailable', 'runtime unavailable'),
      outcome: outcome(1),
    })
    await unavailable.plugin(CinlanBrowser, { commandTimeoutMs: 100 })
    await expect(unavailable.browser.listPages())
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CINLAN_BROWSER_RUNTIME_UNAVAILABLE' }))

    vi.useFakeTimers()
    const timed = new Context()
    contexts.push(timed)
    await timed.plugin(BrowserRuntime)
    await timed.plugin(ScriptedSubprocess)
    ;(timed.subprocess as ScriptedSubprocess).resolveImpl = (_command, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error('aborted'))
      }, { once: true })
    })
    await timed.plugin(CinlanBrowser, { commandTimeoutMs: 10 })
    const pending = timed.browser.listPages()
    const timeoutFailure = expect(pending).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLI_TIMEOUT' }))
    await vi.advanceTimersByTimeAsync(10)
    await timeoutFailure
    vi.useRealTimers()
  })
})
