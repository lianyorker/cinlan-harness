/** Durable mobile emulator preferences shared by the Host settings provider and browser UI. */

import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by the mobile device settings. */
export const MOBILE_DEVICE_NAMESPACE = 'mobile-device'

/** User-controlled mobile emulator preferences. */
export interface MobileDeviceSettings {
  enabled: boolean
  defaultDeviceId: string
  androidSdkPath: string
}

/** Schema used by Host registration and Client settings decoding. */
export const MobileDeviceSettingsSchema: s<MobileDeviceSettings> = s.object({
  enabled: s.boolean().default(false),
  defaultDeviceId: s.string().default(''),
  androidSdkPath: s.string().default(''),
})
