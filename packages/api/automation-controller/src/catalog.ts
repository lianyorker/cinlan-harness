/** Advisory selectors read from the same services that resolve runtime inputs. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-workspace'
import type {
  AutomationCatalog, AutomationChoiceAvailability, AutomationModelChoice, AutomationPermissionChoice,
  AutomationPresetChoice, AutomationProviderChoice, AutomationWorkspaceChoice,
} from './types.ts'

/** Read selector metadata without executing a model.
 * @param ctx - injected selector owners.
 * @returns current metadata without a model execution.
 */
export async function automationCatalog(ctx: Context): Promise<AutomationCatalog> {
  const defaultPreset = ctx.agentPresets.defaultId
  const defaultModel = ctx.agentDefaultModel.currentSelection()
  const defaultPermission = ctx.permissionPresets.defaultPreset
  const workspaces = await Promise.all(ctx.workspaceRegistry.list().map(async (workspace): Promise<AutomationWorkspaceChoice> => {
    let availability: AutomationChoiceAvailability
    try {
      availability = await workspace.status() === 'ok' ? 'ready' : 'missing'
    } catch {
      // Directory status errors classify this row without exposing filesystem diagnostics.
      availability = 'unavailable'
    }
    return { id: workspace.id, title: workspace.title, path: workspace.path, availability }
  }))
  const agentPresets: AutomationPresetChoice[] = (await ctx.agentPresets.list()).map(preset => ({
    id: preset.id,
    ...preset.name === undefined ? {} : { name: preset.name },
    ...preset.description === undefined ? {} : { description: preset.description },
    availability: preset.broken === undefined ? 'ready' : 'broken',
  }))
  if (!agentPresets.some(preset => preset.id === defaultPreset)) {
    agentPresets.push({ id: defaultPreset, availability: 'missing' })
  }
  const providers: AutomationProviderChoice[] = []
  const models: AutomationModelChoice[] = []
  for (const provider of ctx.llm.listProviders()) {
    try {
      const catalog = await ctx.llm.listModels(provider.id)
      providers.push({ ...provider, availability: 'ready' })
      models.push(...catalog.map(model => ({
        provider: model.provider, id: model.id, name: model.name,
        ...model.description === undefined ? {} : { description: model.description },
        availability: 'ready' as const,
      })))
    } catch {
      // Provider list failures are advisory; no provider text or credentials leave the Host.
      providers.push({ ...provider, availability: 'unavailable' })
    }
  }
  const provider = providers.find(item => item.id === defaultModel.provider)
  const modelAvailability: AutomationChoiceAvailability = models.some(model =>
    model.provider === defaultModel.provider && model.id === defaultModel.model)
    ? 'ready' : provider === undefined ? 'missing' : provider.availability === 'ready' ? 'unlisted' : 'unavailable'
  if (provider === undefined) {
    providers.push({ id: defaultModel.provider, name: defaultModel.provider, availability: 'missing' })
  }
  if (modelAvailability !== 'ready') {
    models.push({ provider: defaultModel.provider, id: defaultModel.model, availability: modelAvailability })
  }
  const permissionPresets: AutomationPermissionChoice[] = ctx.permissionPresets.names.map((id) => {
    const option = ctx.permissionPresets.optionOf(id)
    const resolved = ctx.permissionPresets.resolve(id)
    return {
      id, name: option.name,
      ...option.description === undefined ? {} : { description: option.description },
      availability: 'ready', permission: { sandbox: resolved.sandbox, approval: resolved.approval },
    }
  })
  if (!permissionPresets.some(preset => preset.id === defaultPermission)) {
    permissionPresets.push({ id: defaultPermission, name: defaultPermission, availability: 'missing', permission: null })
  }
  return {
    workspaces, agentPresets, providers, models, permissionPresets,
    defaults: { agentPresetId: defaultPreset, model: defaultModel, modelAvailability, permissionPresetId: defaultPermission },
  }
}
