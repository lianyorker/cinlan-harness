/** Public field descriptions; runtime values never enter settings search metadata. */
import type { CapabilitySettingsKey } from './locales.ts'

/** A fixed public title and explanation for an owned DOM target. */
interface Field {
  readonly anchorId: string
  readonly title: CapabilitySettingsKey
  readonly description: CapabilitySettingsKey
}

/** Every Mobile Emulator setting and guidance target this page renders. */
export const MOBILE_FIELDS = [
  { anchorId: 'mobile-readiness', title: 'mobileSdkStatusTitle', description: 'deviceAvailableDescription' },
  { anchorId: 'mobile-enabled', title: 'mobileEnable', description: 'mobileEnableDescription' },
  { anchorId: 'mobile-sdk-path', title: 'mobileSdkCustomPath', description: 'mobileSdkPathHelp' },
  { anchorId: 'mobile-device', title: 'mobileDefaultDevice', description: 'mobileDefaultDeviceDescription' },
  { anchorId: 'mobile-agent', title: 'mobileAgentControl', description: 'mobileHowToUseDescription' },
  { anchorId: 'mobile-commands', title: 'mobileCommandsTitle', description: 'mobileCommandsDescription' },
  { anchorId: 'mobile-usage', title: 'examplesTitle', description: 'mobileExamplesDescription' },
  { anchorId: 'mobile-resources', title: 'mobileResourcesTitle', description: 'mobileResourcesDescription' },
] as const satisfies readonly Field[]
