/** Deterministic emulator boundary for the authored Mobile Device session snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import { MobileDeviceGeneration, MobileDeviceId, MobileObservationId } from '@deepseek-ai/dsh-mobile-device'
import type { MobileDevice, MobileMutationResult } from '@deepseek-ai/dsh-mobile-device'

/** Snapshot Provider plugin name. */
export const name = 'mobile-device-snapshot-provider'
/** Real mobile runtime required by this emulator fixture. */
export const inject = ['mobileDevice']

const devices: MobileDevice[] = [
  { backend: 'android', id: MobileDeviceId('snapshot-other'), name: 'Other emulator', state: 'booted', isAvailable: true },
  { backend: 'android', id: MobileDeviceId('snapshot-default'), name: 'Saved emulator', state: 'booted', isAvailable: true },
]

function rejectMutation(): Promise<MobileMutationResult> {
  return Promise.reject(new Error('The observation snapshot does not allow mutations.'))
}

/**
 * Register deterministic discovery and observation over the real mobile runtime.
 * @param ctx - snapshot plugin lifetime.
 */
export function apply(ctx: Context): void {
  ctx.mobileDevice.registerProvider({
    id: 'snapshot',
    available: () => true,
    listDevices: () => Promise.resolve(devices),
    observe: (request) => {
      const device = devices.find(candidate => candidate.id === request.deviceId)
      if (device === undefined) throw new Error('Unknown snapshot device.')
      return Promise.resolve({
        device,
        deviceGeneration: MobileDeviceGeneration(`generation-${device.id}`),
        observationId: MobileObservationId(`observation-${device.id}`),
        coordinateSpace: 'normalized',
        tree: 'button Continue',
        screenshotStatus: { state: 'skipped' },
      })
    },
    touch: rejectMutation,
    typeText: rejectMutation,
    pressButton: rejectMutation,
  })
}
