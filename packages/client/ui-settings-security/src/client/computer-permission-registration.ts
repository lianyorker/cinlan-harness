/** Register Computer Use policy settings only when the active Host serves them. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconShieldOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { COMPUTER_CAPABILITY } from './CapabilitySection.tsx'
import { ComputerPermissionPolicySection, type ComputerPermissionPolicyInjected, type ComputerUsePermissionSettings } from './ComputerPermissionPolicySection.tsx'
import { registerCapabilitySection } from './capability-registration.ts'
import { createCapabilityShared } from './capability-shared.ts'
import { COMPUTER_FIELDS } from './settings-fields.ts'

/** Dependencies owned by the policy page registration. */
export const computerPermissionInject = ['settingsMetadata', 'slots', 'locale', 'settingsScope', 'remote.deviceCapabilities']

/** Bind the policy namespace and follow its availability across Host updates. */
export function applyComputerPermissionSettings(ctx: ClientContext): void {
  const { t } = createCapabilityShared(ctx)
  const permissionSettings = ctx.settingsScope.bind<ComputerUsePermissionSettings>({ namespace: 'computer-use-permission-policy' })
  let release: (() => void) | undefined
  const sync = (): void => {
    const available = permissionSettings.getSnapshot().status === 'ready'
    if (available && release === undefined) {
      const injectSection = (): ComputerPermissionPolicyInjected => ({
        definition: COMPUTER_CAPABILITY,
        permissionSettings,
        osPermissions: {
          read: async (signal) => {
            const result = await ctx.remote.deviceCapabilities.computerPermissionStatus(signal)
            if (!result.ok) throw new Error(t('computerOsPermissionFailed'))
            return result.value
          },
          request: async (signal) => {
            const result = await ctx.remote.deviceCapabilities.requestComputerPermissions(signal)
            if (!result.ok) throw new Error(t('computerOsPermissionFailed'))
            return result.value
          },
          openScreenRecordingSettings: async (signal) => {
            const result = await ctx.remote.deviceCapabilities.openComputerScreenRecordingSettings(signal)
            if (!result.ok) throw new Error(t('computerOsPermissionFailed'))
            return result.value
          },
        },
        hooks: { permissionSettings },
      })
      release = registerCapabilitySection(
        ctx, { t }, COMPUTER_CAPABILITY, IconShieldOutlineRegular, injectSection, ComputerPermissionPolicySection, COMPUTER_FIELDS,
      )
    } else if (!available && release !== undefined) {
      release()
      release = undefined
    }
  }
  const unsubscribe = permissionSettings.subscribe(sync)
  sync()
  ctx.effect(() => () => { unsubscribe(); release?.(); release = undefined }, 'ui-settings-security: computer permission settings')
}
