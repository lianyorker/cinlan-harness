/** REA settings registration: read-only status and detected host tools. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@cinlan/api-security-research-controller/remote'
import { REA_CAPABILITY } from './CapabilitySection.tsx'
import { ReaSection, type ReaSectionInjected } from './ReaSection.tsx'
import { registerCapabilitySection } from './capability-registration.ts'
import { createCapabilityShared } from './capability-shared.ts'
import { REA_FIELDS } from './settings-fields.ts'

/** Dependencies owned by the REA registration. */
export const inject = [
  'settingsMetadata', 'slots', 'locale', 'remote', 'remote.securityResearch',
]

/** Register the REA feature inside its own Cordis fiber. */
export function apply(ctx: ClientContext): void {
  const { t } = createCapabilityShared(ctx)
  const describeRea: ReaSectionInjected['describeRea'] = async (signal) => {
    const result = await ctx.remote.securityResearch.reaDoctor(signal)
    if (!result.ok) throw new Error(t('reaCheckFailed'))
    return result.value
  }
  const injectSection = (): ReaSectionInjected => ({ definition: REA_CAPABILITY, describeRea })
  ctx.effect(() => registerCapabilitySection(
    ctx, { t }, REA_CAPABILITY, IconSkillOutline16, injectSection, ReaSection, REA_FIELDS,
  ))
}
