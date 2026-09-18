/** Host schema for the mobile-device capability's durable preferences. */

import z from '@deepseek-ai/schemastery'
import type { MobileDeviceSettings } from './types.ts'

/** Settings namespace shared by runtime readers and settings Consumers. */
export const MOBILE_DEVICE_NAMESPACE = 'mobile-device'

/** Saved preferences; SDK paths do not configure a remote Cinlan device backend. */
export const MobileDeviceSettingsSchema: z<MobileDeviceSettings> = z.object({
  enabled: z.boolean().default(false),
  defaultDeviceId: z.string().default(''),
  androidSdkPath: z.string().default(''),
})
