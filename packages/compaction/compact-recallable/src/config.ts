/**
 * Configuration validation and policy resolution for recallable compaction.
 *
 * @module @deepseek-ai/dsh-compact-recallable/config
 */

import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type {
  ModelCompactPolicyConfig,
  RecallableCompactionConfig,
  ResolvedCompactSpec,
  ResolvedConfig,
  ResolvedRetention,
  ResolvedTargetPolicy,
} from './types.ts'

export const DEFAULT_THRESHOLD_RATIO = 0.8
export const DEFAULT_RETAIN_RATIO = 0.16
export const DEFAULT_CHUNK_TOKENS = 4000
export const DEFAULT_STUB_TOKENS = 200
export const DEFAULT_MAX_TOKENS = 8192

const POLICY_CONFIG_KEYS = [
  'thresholdRatio',
  'retainRatio',
  'retainTokens',
  'chunkTokens',
  'stubTokens',
  'summarizationProvider',
  'summarizationModel',
  'maxTokens',
  'compactionRetries',
  'maxOverflowRetries',
] as const

const RECALLABLE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  ...POLICY_CONFIG_KEYS,
  'modelPolicies',
  'auto',
])

const MODEL_POLICY_KEYS: ReadonlySet<string> = new Set([
  'provider',
  'model',
  ...POLICY_CONFIG_KEYS,
])

/** Target-specific pressure configuration failure eligible for warning suppression. */
export class TargetPressureConfigError extends Error {
  constructor(readonly targetKey: string, message: string) {
    super(message)
  }
}

function validateKeys(
  value: object,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${location}: unknown key "${key}"`)
    }
  }
}

function validateRatioRetention(
  thresholdRatio: number,
  retention: ResolvedRetention,
  location: string,
): void {
  if (thresholdRatio <= 0 || thresholdRatio > 1) {
    throw new Error(`${location}: thresholdRatio must sit in (0, 1], got ${thresholdRatio}`)
  }
  if (retention.retainRatio !== undefined) {
    if (retention.retainRatio <= 0 || retention.retainRatio >= 1) {
      throw new Error(`${location}: retainRatio must sit in (0, 1), got ${retention.retainRatio}`)
    }
    if (retention.retainRatio >= thresholdRatio) {
      throw new Error(
        `${location}: retainRatio (${retention.retainRatio}) must sit strictly below thresholdRatio (${thresholdRatio})`,
      )
    }
  }
}

function validatePolicy(
  policy: {
    thresholdRatio?: number
    retainRatio?: number
    retainTokens?: number
    chunkTokens?: number
    stubTokens?: number
    summarizationProvider?: string
    summarizationModel?: string
    maxTokens?: number
    compactionRetries?: number
    maxOverflowRetries?: number
  },
  location: string,
): void {
  if (policy.retainRatio !== undefined && policy.retainTokens !== undefined) {
    throw new Error(`${location}: set retainRatio or retainTokens, not both`)
  }
  if (policy.retainTokens !== undefined && (!Number.isSafeInteger(policy.retainTokens) || policy.retainTokens < 0)) {
    throw new Error(`${location}: retainTokens must be a non-negative integer`)
  }
  if (policy.chunkTokens !== undefined && (!Number.isSafeInteger(policy.chunkTokens) || policy.chunkTokens < 100)) {
    throw new Error(`${location}: chunkTokens must be an integer >= 100`)
  }
  if (policy.stubTokens !== undefined && (!Number.isSafeInteger(policy.stubTokens) || policy.stubTokens < 20)) {
    throw new Error(`${location}: stubTokens must be an integer >= 20`)
  }
  const hasProvider = policy.summarizationProvider !== undefined && policy.summarizationProvider.length > 0
  const hasModel = policy.summarizationModel !== undefined && policy.summarizationModel.length > 0
  if (hasProvider !== hasModel) {
    throw new Error(`${location}: summarizationProvider and summarizationModel must be set together`)
  }
  if (policy.maxTokens !== undefined && (!Number.isSafeInteger(policy.maxTokens) || policy.maxTokens < 1)) {
    throw new Error(`${location}: maxTokens must be a positive integer`)
  }
  if (policy.compactionRetries !== undefined
    && (!Number.isSafeInteger(policy.compactionRetries) || policy.compactionRetries < 0)) {
    throw new Error(`${location}: compactionRetries must be a non-negative integer`)
  }
  if (policy.maxOverflowRetries !== undefined
    && (!Number.isSafeInteger(policy.maxOverflowRetries) || policy.maxOverflowRetries < 0)) {
    throw new Error(`${location}: maxOverflowRetries must be a non-negative integer`)
  }
}

function resolveRetention(
  source: { retainRatio?: number; retainTokens?: number },
  fallback: ResolvedRetention,
): ResolvedRetention {
  if (source.retainTokens !== undefined) return { retainTokens: source.retainTokens }
  if (source.retainRatio !== undefined) return { retainRatio: source.retainRatio }
  return fallback
}

function resolveModelPolicies(
  policies?: readonly ModelCompactPolicyConfig[],
): readonly ModelCompactPolicyConfig[] {
  if (policies === undefined) return Object.freeze([])
  const seen = new Set<string>()
  return Object.freeze(policies.map((policy, index) => {
    validateKeys(policy, MODEL_POLICY_KEYS, `RecallableCompactionConfig: modelPolicies[${index}]`)
    validatePolicy(policy, `RecallableCompactionConfig: modelPolicies[${index}]`)
    const key = `${policy.provider}/${policy.model}`
    if (seen.has(key)) {
      throw new Error(`RecallableCompactionConfig: duplicate model policy for ${key}`)
    }
    seen.add(key)
    return deepFreeze({ ...policy })
  }))
}

/**
 * Resolve and validate configuration for RecallableCompactionEngine.
 * @param config - untrusted plugin configuration.
 * @returns validated immutable configuration.
 */
export function resolveConfig(config: RecallableCompactionConfig = {}): ResolvedConfig {
  validateKeys(config, RECALLABLE_CONFIG_KEYS, 'RecallableCompactionConfig')
  validatePolicy(config, 'RecallableCompactionConfig')
  if (config.auto !== undefined && typeof config.auto !== 'boolean') {
    throw new Error('RecallableCompactionConfig: auto must be a boolean')
  }

  const thresholdRatio = config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO
  const retention = resolveRetention(config, { retainRatio: DEFAULT_RETAIN_RATIO })
  validateRatioRetention(thresholdRatio, retention, 'RecallableCompactionConfig')
  const modelPolicies = resolveModelPolicies(config.modelPolicies)
  for (const [index, policy] of modelPolicies.entries()) {
    validateRatioRetention(
      policy.thresholdRatio ?? thresholdRatio,
      resolveRetention(policy, retention),
      `RecallableCompactionConfig: modelPolicies[${index}]`,
    )
  }

  return deepFreeze({
    thresholdRatio,
    ...retention,
    chunkTokens: config.chunkTokens ?? DEFAULT_CHUNK_TOKENS,
    stubTokens: config.stubTokens ?? DEFAULT_STUB_TOKENS,
    summarizationProvider: config.summarizationProvider ?? '',
    summarizationModel: config.summarizationModel ?? '',
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    compactionRetries: config.compactionRetries ?? 1,
    maxOverflowRetries: config.maxOverflowRetries ?? 1,
    modelPolicies,
    auto: config.auto ?? true,
  })
}

/**
 * Merge an exact-target override over the base resolved configuration.
 * @param base - root resolved configuration.
 * @param target - provider/model route.
 * @returns effective target policy.
 */
export function resolveTargetPolicy(
  base: ResolvedConfig,
  target: Pick<LlmCallConfig, 'provider' | 'model'>,
): ResolvedTargetPolicy {
  const match = base.modelPolicies.find(
    p => p.provider === target.provider && p.model === target.model,
  )
  if (match === undefined) {
    return {
      thresholdRatio: base.thresholdRatio,
      ...base.retainTokens !== undefined ? { retainTokens: base.retainTokens } : {},
      ...base.retainRatio !== undefined ? { retainRatio: base.retainRatio } : {},
      chunkTokens: base.chunkTokens,
      stubTokens: base.stubTokens,
      summarizationProvider: base.summarizationProvider,
      summarizationModel: base.summarizationModel,
      maxTokens: base.maxTokens,
      compactionRetries: base.compactionRetries,
      maxOverflowRetries: base.maxOverflowRetries,
    }
  }

  return {
    thresholdRatio: match.thresholdRatio ?? base.thresholdRatio,
    ...resolveRetention(match, {
      ...base.retainTokens !== undefined ? { retainTokens: base.retainTokens } : {},
      ...base.retainRatio !== undefined ? { retainRatio: base.retainRatio } : {},
    }),
    chunkTokens: match.chunkTokens ?? base.chunkTokens,
    stubTokens: match.stubTokens ?? base.stubTokens,
    summarizationProvider: match.summarizationProvider ?? base.summarizationProvider,
    summarizationModel: match.summarizationModel ?? base.summarizationModel,
    maxTokens: match.maxTokens ?? base.maxTokens,
    compactionRetries: match.compactionRetries ?? base.compactionRetries,
    maxOverflowRetries: match.maxOverflowRetries ?? base.maxOverflowRetries,
  }
}

/**
 * Resolve concrete token targets given an active context window.
 * @param policy - resolved target policy.
 * @param contextWindow - total context capacity in tokens.
 * @returns effective token numbers.
 */
export function resolveCompactSpec(
  policy: ResolvedTargetPolicy,
  contextWindow: number,
): ResolvedCompactSpec {
  const thresholdTokens = Math.floor(contextWindow * policy.thresholdRatio)
  const retainTokens = policy.retainTokens ?? Math.floor(contextWindow * (policy.retainRatio ?? DEFAULT_RETAIN_RATIO))
  return {
    thresholdTokens,
    retainTokens,
    chunkTokens: policy.chunkTokens,
    stubTokens: policy.stubTokens,
    maxTokens: policy.maxTokens,
    compactionRetries: policy.compactionRetries,
  }
}
