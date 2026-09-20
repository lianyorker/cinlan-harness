/** Host schema for the mobile-device capability's durable preferences. */

import z from '@deepseek-ai/schemastery'
import type { MobileDeviceSettings } from './types.ts'

/** Settings namespace shared by runtime readers and settings Consumers. */
export const MOBILE_DEVICE_NAMESPACE = 'mobile-device'

/** Saved preferences shared by native ADB execution, SDK checks, and human resource management. */
export const MobileDeviceSettingsSchema: z<MobileDeviceSettings> = z.object({
  enabled: z.boolean().default(false),
  defaultDeviceId: z.string().default(''),
  androidSdkPath: z.string().default(''),
})
