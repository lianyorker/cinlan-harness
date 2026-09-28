/** Computer Use settings plugin: provider activation and readiness ownership. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { COMPUTER_CAPABILITY, type ComputerSectionInjected } from './CapabilitySection.tsx'
import { registerCapabilitySection } from './capability-registration.ts'
import { createCapabilityShared, createDeviceProbe } from './capability-shared.ts'

/** Dependencies owned by the Computer registration. */
export const inject = [
  'settingsMetadata', 'slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.deviceCapabilities',
]

/** Register the Computer feature inside its own Cordis fiber. */
export function apply(ctx: ClientContext): void {
  const shared = createCapabilityShared(ctx)
  const checkDevice = createDeviceProbe(ctx, shared.t)
  const injectSection = (): ComputerSectionInjected => ({
    ...shared.providerActivation, list: shared.list, definition: COMPUTER_CAPABILITY, checkDevice,
  })
  registerCapabilitySection(ctx, shared, COMPUTER_CAPABILITY, IconBrowseOutline16, injectSection)
}
