/** Settings-owned root grant; existing Session bindings are never rewritten. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { AssessmentScopePolicy } from '@deepseek-ai/dsh-assessment-scope'
import type { AssessmentGrant } from '@deepseek-ai/dsh-assessment-scope'
import * as StaticScope from '@deepseek-ai/dsh-assessment-scope-static'
import schema from '@deepseek-ai/schemastery'
import type { Config as StaticConfig } from '@deepseek-ai/dsh-assessment-scope-static'

/** Initial root configuration, with no inline credential values. */
export type Config = StaticConfig

/** Settings-backed root policy; each read sees the last committed canonical configuration. */
export class SettingsAssessmentScopePolicy extends AssessmentScopePolicy {
  static inject = ['settings']
  static Config: schema<Config> = schema.intersect([StaticScope.Config])
  private readonly settingsScope: SettingsScope<Config>

  /**
   * @param ctx - Context carrying Settings.
   * @param config - Initial operator root grant used below stored preferences.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.settingsScope = ctx.settings.register('assessment-scope', SettingsAssessmentScopePolicy.Config, {
      base: config,
      applies: 'live',
      validate: (value) => { StaticScope.resolveAssessmentScopeConfig(value) },
    })
  }

  /** Canonical root authority from the committed Settings value, without an asynchronous policy mirror. */
  override get rootGrant(): AssessmentGrant {
    return StaticScope.resolveAssessmentScopeConfig(this.settingsScope.get())
  }
}

export default SettingsAssessmentScopePolicy
