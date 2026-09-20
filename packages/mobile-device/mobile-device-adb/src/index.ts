/** Direct Android ADB provider with exact transport targeting and one-use observation tokens. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomUUID } from 'node:crypto'
import { MobileDeviceError, MobileDeviceGeneration, MobileObservationId } from '@deepseek-ai/dsh-mobile-device'
import type {
  MobileButtonRequest, MobileDevice, MobileDeviceId, MobileDeviceProvider, MobileMutationRequest, MobileMutationResult,
  MobileObservation, MobileObserveSpec, MobileScreenshot, MobileTouchRequest, MobileTypeRequest,
} from '@deepseek-ai/dsh-mobile-device'
import { Config, resolveConfig } from './config.ts'
import type { ResolvedConfig } from './config.ts'
import { AdbRunner } from './runner.ts'
import { parseActivity, parseBootId, parseDevices, parseDisplaySize, parseHierarchy, parseScreenshot } from './protocol.ts'
import type { AdbDevice } from './protocol.ts'

export { Config, resolveConfig } from './config.ts'
/** Native provider plugin name. */
export const name = 'mobile-device-adb'
/** Existing Mobile Device service and Harness-owned subprocess execution. */
export const inject = ['mobileDevice', 'subprocess']
interface ObservationToken {
  readonly observation: MobileObservation
  readonly transportId: string
  readonly bootId: string
  readonly executable: string
  readonly width: number
  readonly height: number
  readonly rotation: number
}
const BUTTONS: Readonly<Record<string, string>> = {
  home: '3', back: '4', power: '26', recents: '187', enter: '66', menu: '82',
  volume_up: '24', volume_down: '25', tab: '61', delete: '67', escape: '111',
}
function failure(message: string, code: string): MobileDeviceError { return new MobileDeviceError(message, code) }
function coordinate(value: number, length: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw failure('Touch coordinates must be within 0..1', 'MOBILE_COORDINATE_INVALID')
  return String(Math.round(value * (length - 1)))
}
/** Native Android implementation; provider availability does not imply a connected device. */
export class AdbMobileDeviceProvider implements MobileDeviceProvider {
  readonly id: string
  private readonly runner: AdbRunner
  private readonly observations = new Map<MobileDeviceId, ObservationToken>()
  private readonly busy = new Set<MobileDeviceId>()
  private readonly pending = new Set<Promise<unknown>>()
  private disposed = false
  /** @param ctx - Existing Mobile Device and subprocess services.
   * @param config - Fully resolved native deployment configuration.
   */
  constructor(ctx: Context, private readonly config: ResolvedConfig) {
    this.id = config.providerId
    this.runner = new AdbRunner(ctx, config, () => ctx.mobileDevice.getPreferences().androidSdkPath)
  }
  /** @inheritdoc */
  available(): boolean { return !this.disposed }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(failure('Native Android provider is disposed', 'MOBILE_PROVIDER_DISPOSED'))
    const task = this.runner.scoped(operation)
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }
  private exclusive<T>(id: MobileDeviceId, operation: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) return Promise.reject(failure('Another operation owns this Android device', 'MOBILE_DEVICE_BUSY'))
    this.busy.add(id)
    return (async () => {
      try { return await this.track(operation) } finally { this.busy.delete(id) }
    })()
  }
  private async text(args: readonly string[], signal?: AbortSignal, cleanup = false): Promise<string> {
    const bytes = await this.runner.run(args, signal, this.config.maxOutputBytes, cleanup)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  private async inventory(signal?: AbortSignal): Promise<readonly AdbDevice[]> {
    const devices = parseDevices(await this.text(['devices', '-l'], signal))
    for (const [id, token] of this.observations) {
      const current = devices.find(candidate => candidate.device.id === id)
      if (!current?.device.isAvailable || current.transportId !== token.transportId) this.observations.delete(id)
    }
    return devices
  }
  private async target(id: MobileDeviceId, signal?: AbortSignal): Promise<AdbDevice & { transportId: string }> {
    const device = (await this.inventory(signal)).find(candidate => candidate.device.id === id)
    if (!device) throw failure('The exact Android device is not connected', 'MOBILE_DEVICE_NOT_FOUND')
    if (!device.device.isAvailable || !device.transportId) throw failure('The Android device is not authorized and online', 'MOBILE_DEVICE_UNAVAILABLE')
    return { ...device, transportId: device.transportId }
  }
  private async boot(transport: string, signal?: AbortSignal): Promise<string> {
    return parseBootId(await this.text(['-t', transport, 'exec-out', 'cat', '/proc/sys/kernel/random/boot_id'], signal))
  }
  private async hierarchy(transport: string, signal?: AbortSignal): Promise<ReturnType<typeof parseHierarchy>> {
    const file = '/data/local/tmp/dsh-ui-' + randomUUID() + '.xml'
    let primary: unknown
    try {
      await this.text(['-t', transport, 'shell', 'uiautomator', 'dump', '--compressed', file], signal)
      return parseHierarchy(await this.text(['-t', transport, 'exec-out', 'cat', file], signal))
    } catch (error) {
      primary = error
      throw error
    } finally {
      try { await this.text(['-t', transport, 'shell', 'rm', '-f', file], undefined, true) } catch (cleanupError) {
        if (primary === undefined) throw failure('Android hierarchy capture cleanup failed', 'MOBILE_ADB_CLEANUP_FAILED')
        // Preserve the operation error; disconnected devices may leave the documented uniquely named dump file.
        void cleanupError
      }
    }
  }
  /** @inheritdoc */
  listDevices(signal?: AbortSignal): Promise<readonly MobileDevice[]> {
    return this.track(async () => (await this.inventory(signal)).map(value => value.device))
  }
  /** @inheritdoc */
  observe(request: MobileObserveSpec, signal?: AbortSignal): Promise<MobileObservation> {
    return this.exclusive(request.deviceId, async () => {
      this.observations.delete(request.deviceId)
      const executable = this.runner.selection()
      const device = await this.target(request.deviceId, signal)
      const bootId = await this.boot(device.transportId, signal)
      const hierarchy = await this.hierarchy(device.transportId, signal)
      const dimensions = parseDisplaySize(await this.text(['-t', device.transportId, 'shell', 'wm', 'size'], signal), hierarchy.rotation)
      const activity = parseActivity(await this.text(['-t', device.transportId, 'shell', 'dumpsys', 'activity', 'activities'], signal))
      let screenshot: MobileScreenshot | undefined
      if (request.captureScreenshot !== false) {
        screenshot = await parseScreenshot(await this.runner.run(
          ['-t', device.transportId, 'exec-out', 'screencap', '-p'], signal, this.config.maxImageBytes,
        ), this.config.maxImagePixels)
        if (screenshot.width !== dimensions.width || screenshot.height !== dimensions.height) {
          throw failure('Android display changed during capture; observe again', 'MOBILE_OBSERVATION_STALE')
        }
      }
      const current = await this.target(request.deviceId, signal)
      if (current.transportId !== device.transportId || await this.boot(device.transportId, signal) !== bootId
        || this.runner.selection() !== executable) {
        throw failure('Android transport changed during capture; observe again', 'MOBILE_OBSERVATION_STALE')
      }
      const tree = 'Current activity: ' + activity + '\n' + hierarchy.tree
      if (Buffer.byteLength(tree) > this.config.maxOutputBytes) throw failure('Android observation exceeds the configured byte limit', 'MOBILE_ADB_OUTPUT_TOO_LARGE')
      signal?.throwIfAborted()
      const observation: MobileObservation = {
        device: device.device,
        deviceGeneration: MobileDeviceGeneration(createHash('sha256').update(executable + ':' + device.transportId + ':' + bootId).digest('hex')),
        observationId: MobileObservationId(randomUUID()), coordinateSpace: 'normalized',
        tree,
        ...(screenshot ? { screenshot } : {}), screenshotStatus: { state: screenshot ? 'captured' : 'skipped' },
      }
      this.observations.set(request.deviceId, {
        observation, transportId: device.transportId, bootId, executable, ...dimensions, rotation: hierarchy.rotation,
      })
      return observation
    })
  }
  private async mutate(
    request: MobileMutationRequest, input: (token: ObservationToken) => readonly string[], signal?: AbortSignal,
  ): Promise<MobileMutationResult> {
    return this.exclusive(request.deviceId, async () => {
      const token = this.observations.get(request.deviceId)
      if (!token || token.observation.observationId !== request.observationId) throw failure('Observe this Android device again before input', 'MOBILE_OBSERVATION_STALE')
      this.observations.delete(request.deviceId)
      const args = input(token)
      const current = await this.target(request.deviceId, signal)
      if (current.transportId !== token.transportId || this.runner.selection() !== token.executable
        || await this.boot(token.transportId, signal) !== token.bootId) {
        throw failure('Android device generation changed; observe again', 'MOBILE_OBSERVATION_STALE')
      }
      const hierarchy = await this.hierarchy(token.transportId, signal)
      const size = parseDisplaySize(await this.text(['-t', token.transportId, 'shell', 'wm', 'size'], signal), hierarchy.rotation)
      if (size.width !== token.width || size.height !== token.height || hierarchy.rotation !== token.rotation) {
        throw failure('Android display geometry changed; observe again', 'MOBILE_OBSERVATION_STALE')
      }
      const beforeInput = await this.target(request.deviceId, signal)
      if (beforeInput.transportId !== token.transportId || await this.boot(token.transportId, signal) !== token.bootId
        || this.runner.selection() !== token.executable) {
        throw failure('Android device generation changed before input; observe again', 'MOBILE_OBSERVATION_STALE')
      }
      await this.text(['-t', token.transportId, 'shell', 'input', ...args], signal)
      return { device: current.device, deviceGeneration: token.observation.deviceGeneration, observationId: request.observationId }
    })
  }
  /** @inheritdoc */
  touch(request: MobileTouchRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.mutate(request, token => request.kind === 'tap'
      ? ['tap', coordinate(request.x, token.width), coordinate(request.y, token.height)]
      : ['swipe', coordinate(request.fromX, token.width), coordinate(request.fromY, token.height),
        coordinate(request.toX, token.width), coordinate(request.toY, token.height), String(this.config.swipeDurationMs)], signal)
  }
  /** @inheritdoc */
  typeText(request: MobileTypeRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.mutate(request, () => {
      // ADB joins remote shell argv; only this literal-safe alphabet and encoded spaces enter input text.
      if (!/^[A-Za-z0-9 @_.:,/+=-]*$/.test(request.text) || Buffer.byteLength(request.text) > this.config.maxTextBytes) {
        throw failure('Native ADB text supports bounded ASCII letters, digits, spaces and @_.:,/+=- only; Unicode and shell syntax are unsupported', 'MOBILE_TEXT_UNSUPPORTED')
      }
      return ['text', request.text.replaceAll(' ', '%s')]
    }, signal)
  }
  /** @inheritdoc */
  pressButton(request: MobileButtonRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.mutate(request, () => {
      const key = BUTTONS[request.button]
      if (!key) throw failure('This Android navigation button is unsupported', 'MOBILE_OPERATION_UNSUPPORTED')
      return ['keyevent', key]
    }, signal)
  }
  /** Abort input and observation work, clean device dumps, and join every owned process.
   * @returns Settlement after provider quiescence.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.observations.clear()
    await this.runner.dispose()
    await Promise.allSettled([...this.pending])
    await this.runner.dispose()
  }
}
/** Register the native Provider with fiber-owned disposal.
 * @param ctx - Mobile Device and subprocess services.
 * @param config - Native execution bounds and executable choice.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new AdbMobileDeviceProvider(ctx, resolveConfig(config))
  ctx.effect(function* () {
    const unregister = ctx.mobileDevice.registerProvider(provider)
    yield async () => { unregister(); await provider.dispose() }
  })
}
