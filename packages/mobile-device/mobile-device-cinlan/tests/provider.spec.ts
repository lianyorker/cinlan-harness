import { Context } from '@deepseek-ai/cordis'
import MobileDeviceRuntime, { MobileDeviceId, MobileObservationId } from '@deepseek-ai/dsh-mobile-device'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import * as CinlanMobileDevice from '../src/index.ts'
import {
  apply,
  CinlanMobileDeviceProvider,
  CINLAN_MOBILE_LOCAL_ENV,
  resolveCinlanMobileDeviceConfig,
} from '../src/index.ts'
import type { ResolvedConfig } from '../src/index.ts'

function device(id = 'device-1') {
  return { backend: 'android', id, name: 'Pixel', state: 'booted', isAvailable: true }
}

function devicesResult() {
  return [device()]
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    device: device(),
    deviceGeneration: 'generation-1',
    observationId: 'observation-1',
    coordinateSpace: 'normalized',
    tree: 'button Continue',
    screenshotStatus: { state: 'skipped' },
    ...overrides,
  }
}

function acknowledgement(overrides: Record<string, unknown> = {}) {
  return { ok: true, ...overrides }
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

  async terminalEnvironment(): Promise<never> {
    throw new Error('fixture does not provide terminal subprocesses')
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
      control: undefined,
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
  return resolveCinlanMobileDeviceConfig({ commandTimeoutMs: 1_000, graceMs: 10 })
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(MobileDeviceRuntime, { provider: 'cinlan' })
  await ctx.plugin(FixtureSubprocess)
  return { ctx, subprocess: ctx.subprocess as FixtureSubprocess }
}

function success(subprocess: FixtureSubprocess, value: unknown, runtimeId = 'runtime') {
  subprocess.responses.push({ text: envelope(value, runtimeId) })
}

async function observe(provider: CinlanMobileDeviceProvider, subprocess: FixtureSubprocess, id = 'observation-1') {
  success(subprocess, observation({ observationId: id }))
  return provider.observe({ deviceId: MobileDeviceId('device-1') })
}

describe('CinlanMobileDeviceProvider configuration', () => {
  it('defaults and validates every field', () => {
    expect(resolveCinlanMobileDeviceConfig()).toMatchObject({
      providerId: 'cinlan', command: process.platform === 'linux' ? 'orca-ide' : 'orca',
      commandTimeoutMs: 65_000, graceMs: 3_000,
      maxJsonBytes: 24 * 1024 * 1024, maxStderrBytes: 64 * 1024,
      maxTreeBytes: 1024 * 1024, maxImageBytes: 16 * 1024 * 1024,
      maxTextBytes: 256 * 1024,
    })
    for (const config of [
      { providerId: '' }, { command: ' cinlan' }, { cwd: '' }, { commandTimeoutMs: 0 },
      { graceMs: Number.MAX_SAFE_INTEGER }, { maxJsonBytes: 0 }, { maxStderrBytes: 0 },
      { maxTreeBytes: 0 }, { maxImageBytes: 0 }, { maxTextBytes: 0 }, { extra: true },
    ]) expect(() => resolveCinlanMobileDeviceConfig(config as never)).toThrow()
    expect(CINLAN_MOBILE_LOCAL_ENV).toEqual({
      ORCA_PAIRING_CODE: undefined, ORCA_REMOTE_PAIRING: undefined, ORCA_ENVIRONMENT: undefined,
    })
  })
})

describe('CinlanMobileDeviceProvider operations', () => {
  it('lists, observes, taps, swipes, types through stdin, and presses buttons', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanMobileDeviceProvider(ctx, resolved())
    success(subprocess, devicesResult())
    await expect(provider.listDevices()).resolves.toMatchObject([{ id: 'device-1' }])

    let current = await observe(provider, subprocess)
    success(subprocess, observation({ observationId: 'observation-image' }))
    await provider.observe({ deviceId: MobileDeviceId('device-1'), captureScreenshot: true })
    expect(subprocess.specs.at(-1)?.argv).not.toContain('--no-screenshot')
    current = await observe(provider, subprocess, 'observation-current')
    const base = () => ({ deviceId: MobileDeviceId('device-1'), observationId: current.observationId })
    async function mutate(call: () => Promise<unknown>, nextId: string) {
      success(subprocess, devicesResult())
      success(subprocess, acknowledgement())
      await expect(call()).resolves.toEqual({
        device: current.device,
        deviceGeneration: current.deviceGeneration,
        observationId: current.observationId,
      })
      current = await observe(provider, subprocess, nextId)
    }
    await mutate(() => provider.touch({ ...base(), kind: 'tap', x: 0.25, y: 0.75 }), 'observation-2')
    await mutate(() => provider.touch({
      ...base(), kind: 'swipe', fromX: 0.1, fromY: 0.2, toX: 0.8, toY: 0.9,
    }), 'observation-3')
    await mutate(() => provider.typeText({ ...base(), text: 'typed secret' }), 'observation-4')
    success(subprocess, devicesResult())
    success(subprocess, acknowledgement())
    await expect(provider.pressButton({ ...base(), button: 'home' })).resolves.toEqual({
      device: current.device,
      deviceGeneration: current.deviceGeneration,
      observationId: current.observationId,
    })

    expect(subprocess.specs.every(spec => spec.env === CINLAN_MOBILE_LOCAL_ENV)).toBe(true)
    expect(subprocess.specs.every(spec => spec.argv.at(-1) === '--json')).toBe(true)
    const typeSpec = subprocess.specs.find(spec => spec.argv.includes('--text-stdin'))
    expect(typeSpec?.stdio.stdin).toEqual({ data: 'typed secret' })
    expect(typeSpec?.argv).not.toContain('typed secret')
    expect(subprocess.specs.find(spec => spec.argv.includes('tap'))?.argv).toContain('--observation-id')
    expect(subprocess.specs.find(spec => spec.argv.includes('gesture'))?.argv).toContain('--observation-id')
    expect(subprocess.specs.find(spec => spec.argv.includes('button'))?.argv).toContain('--observation-id')
    await provider.dispose()
    expect(provider.available()).toBe(false)
    await expect(provider.dispose()).resolves.toBeUndefined()
    expect(() => provider.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_DISPOSED' }))
    await ctx.fiber.dispose()
  })

  it('enforces latest one-use observations, exact targets, acknowledgements, and runtime replacement', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanMobileDeviceProvider(ctx, resolved())
    success(subprocess, observation({
      device: { ...device(), name: 'Observed Pixel', detail: 'API 35' },
    }))
    let current = await provider.observe({ deviceId: MobileDeviceId('device-1') })

    await expect(provider.pressButton({
      deviceId: MobileDeviceId('other'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: MobileObservationId('other-observation'), button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
    success(subprocess, devicesResult())
    success(subprocess, acknowledgement())
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).resolves.toEqual({
      device: current.device,
      deviceGeneration: current.deviceGeneration,
      observationId: current.observationId,
    })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })

    current = await observe(provider, subprocess, 'observation-reused')
    current = await observe(provider, subprocess, 'observation-reused')
    success(subprocess, devicesResult())
    success(subprocess, acknowledgement({ extra: true }))
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_CINLAN_PROTOCOL' })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })

    current = await observe(provider, subprocess, 'observation-runtime')
    success(subprocess, devicesResult(), 'runtime-next')
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_RUNTIME_STALE' })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })

    success(subprocess, observation({ device: device('other'), observationId: 'observation-other' }), 'runtime-next')
    await expect(provider.observe({ deviceId: MobileDeviceId('device-1') }))
      .rejects.toMatchObject({ code: 'MOBILE_CINLAN_PROTOCOL' })
    await provider.dispose()
    await ctx.fiber.dispose()
  })

  it('classifies limits, failures, aborts, and lifecycle disposal', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanMobileDeviceProvider(ctx, resolveCinlanMobileDeviceConfig({
      commandTimeoutMs: 1_000, graceMs: 10, maxTextBytes: 3,
    }))
    expect(() => provider.typeText({
      deviceId: MobileDeviceId('device-1'), observationId: MobileObservationId('observation-1'), text: 'long',
    })).toThrow(expect.objectContaining({ code: 'MOBILE_TEXT_TOO_LARGE' }))
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false,
      error: { code: 'device_not_found', message: 'missing', data: { nextSteps: ['list devices'] } },
      _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    await expect(provider.listDevices()).rejects.toMatchObject({
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest's asymmetric matcher is typed as any.
      code: 'MOBILE_DEVICE_NOT_FOUND', message: expect.stringContaining('Next step'),
    })
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false, error: { code: 'custom-error', message: 'failed' }, _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    await expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CINLAN_CUSTOM_ERROR' })
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false, error: { code: '---', message: 'failed' }, _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    await expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CINLAN_ERROR' })
    subprocess.responses.push({ text: envelope(devicesResult()), exitCode: 1 })
    await expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CINLAN_PROTOCOL' })
    subprocess.responses.push({ text: envelope(devicesResult()), lossy: true })
    await expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CLI_RESPONSE_TOO_LARGE' })
    subprocess.responses.push({ text: '', reject: new Error('spawn failed') })
    await expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CLI_FAILED' })

    const caller = new AbortController()
    const reason = new Error('caller aborted')
    subprocess.responses.push({ text: envelope(devicesResult()), onSpawn: () => { caller.abort(reason) } })
    await expect(provider.listDevices(caller.signal)).rejects.toBe(reason)

    subprocess.responses.push({ text: '', pending: true })
    const operation = provider.listDevices()
    const rejected = expect(operation).rejects.toMatchObject({ code: 'MOBILE_PROVIDER_DISPOSED' })
    await provider.dispose()
    await rejected
    await ctx.fiber.dispose()

    const timeoutHarness = await harness()
    const timeoutProvider = new CinlanMobileDeviceProvider(
      timeoutHarness.ctx,
      resolveCinlanMobileDeviceConfig({ commandTimeoutMs: 1, graceMs: 10 }),
    )
    timeoutHarness.subprocess.responses.push({ text: '', pending: true })
    await expect(timeoutProvider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CLI_TIMEOUT' })
    await timeoutProvider.dispose()
    await timeoutHarness.ctx.fiber.dispose()
  })

  it('consumes an observation before mutation preflight failure or caller abort', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanMobileDeviceProvider(ctx, resolved())
    let current = await observe(provider, subprocess)
    subprocess.responses.push({ text: JSON.stringify({
      id: 'id', ok: false,
      error: { code: 'emulator_device_not_found', message: 'missing' },
      _meta: { runtimeId: 'runtime' },
    }), exitCode: 1 })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_DEVICE_NOT_FOUND' })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })

    current = await observe(provider, subprocess, 'observation-abort')
    const caller = new AbortController()
    const reason = new Error('preflight aborted')
    subprocess.responses.push({ text: envelope(devicesResult()), onSpawn: () => { caller.abort(reason) } })
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    }, caller.signal)).rejects.toBe(reason)
    await expect(provider.pressButton({
      deviceId: MobileDeviceId('device-1'), observationId: current.observationId, button: 'home',
    })).rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
    await provider.dispose()
    await ctx.fiber.dispose()
  })
})

describe('mobile-device-cinlan plugin apply', () => {
  it('registers immediately and resolves the executable lazily on first operation', async () => {
    const { ctx, subprocess } = await harness()
    const fiber = await ctx.plugin(CinlanMobileDevice, { command: 'cinlan', commandTimeoutMs: 1_000 })
    expect(subprocess.specs).toHaveLength(0)
    success(subprocess, devicesResult())
    await expect(ctx.mobileDevice.listDevices()).resolves.toMatchObject([{ id: 'device-1' }])
    expect(subprocess.specs[0]?.argv).toEqual(['C:\\bin\\cinlan.exe', 'emulator', 'devices', '--json'])
    await fiber.dispose()
    expect(() => ctx.mobileDevice.listDevices()).toThrow(expect.objectContaining({ code: 'MOBILE_PROVIDER_CONFIGURED_MISSING' }))

    const replacement = await ctx.plugin(CinlanMobileDevice, { commandTimeoutMs: 1_000 })
    success(subprocess, devicesResult())
    await expect(ctx.mobileDevice.listDevices()).resolves.toMatchObject([{ id: 'device-1' }])
    const defaultCommand = process.platform === 'linux' ? 'orca-ide' : 'orca'
    expect(subprocess.specs.at(-1)?.argv[0]).toBe(`C:\\bin\\${defaultCommand}.exe`)
    await replacement.dispose()
    await ctx.fiber.dispose()
  })

  it('defers executable resolution and timeout failures to the first operation', async () => {
    const unavailable = await harness()
    unavailable.subprocess.resolveError = new Error('missing')
    apply(unavailable.ctx, { commandTimeoutMs: 1_000 })
    await expect(unavailable.ctx.mobileDevice.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CLI_UNAVAILABLE' })
    await unavailable.ctx.fiber.dispose()

    const timeout = await harness()
    timeout.subprocess.resolvePending = true
    apply(timeout.ctx, { commandTimeoutMs: 1 })
    await expect(timeout.ctx.mobileDevice.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CLI_TIMEOUT' })
    await timeout.ctx.fiber.dispose()
  })
})

describe('CinlanMobileDeviceProvider readiness recovery', () => {
  it('retries executable lookup after the CLI becomes available', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanMobileDeviceProvider(ctx, resolved())
    try {
      subprocess.resolveError = new Error('not installed')
      await expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_CLI_UNAVAILABLE' })
      subprocess.resolveError = undefined
      success(subprocess, devicesResult())
      await expect(provider.listDevices()).resolves.toBeDefined()
      expect(subprocess.specs).toHaveLength(1)
    } finally {
      await provider.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('cancels an outstanding executable lookup during disposal without spawning', async () => {
    const { ctx, subprocess } = await harness()
    const provider = new CinlanMobileDeviceProvider(ctx, resolved())
    subprocess.resolvePending = true
    try {
      const pending = expect(provider.listDevices()).rejects.toMatchObject({ code: 'MOBILE_PROVIDER_DISPOSED' })
      await provider.dispose()
      await pending
      expect(subprocess.specs).toHaveLength(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
