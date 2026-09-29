/**
 * Configuration and result types for the recallable compaction backend.
 *
 * @module @deepseek-ai/dsh-compact-recallable/types
 */

import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session'

/** Model-specific override for compaction policy. */
export interface ModelCompactPolicyConfig {
  provider: string
  model: string
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
}

/** Deployment configuration for RecallableCompactionEngine. */
export interface RecallableCompactionConfig {
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
  modelPolicies?: ModelCompactPolicyConfig[]
  auto?: boolean
}

/** Normalized retention settings. */
export interface ResolvedRetention {
  readonly retainRatio?: number
  readonly retainTokens?: number
}

/** Fully resolved root configuration. */
export interface ResolvedConfig {
  readonly thresholdRatio: number
  readonly retainRatio?: number
  readonly retainTokens?: number
  readonly chunkTokens: number
  readonly stubTokens: number
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
  readonly compactionRetries: number
  readonly maxOverflowRetries: number
  readonly modelPolicies: readonly ModelCompactPolicyConfig[]
  readonly auto: boolean
}

/** Fully resolved policy for a specific provider/model route. */
export interface ResolvedTargetPolicy {
  readonly thresholdRatio: number
  readonly retainRatio?: number
  readonly retainTokens?: number
  readonly chunkTokens: number
  readonly stubTokens: number
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
  readonly compactionRetries: number
  readonly maxOverflowRetries: number
}

/** Fully resolved token thresholds for a specific compaction context. */
export interface ResolvedCompactSpec {
  readonly thresholdTokens: number
  readonly retainTokens: number
  readonly chunkTokens: number
  readonly stubTokens: number
  readonly maxTokens: number
  readonly compactionRetries: number
}

/** A single slice of surface nodes partitioned for compaction. */
export interface ChunkSlice {
  readonly startSeq: SessionSeq
  readonly endSeq: SessionSeq
  readonly startIdx: number
  readonly endIdx: number
  readonly shadowedSeqs: readonly SessionSeq[]
  readonly estimatedTokens: number
  readonly isRecalledOnly: boolean
}

/** The execution plan for a recallable compaction pass. */
export interface PartitionPlan {
  readonly chunks: readonly ChunkSlice[]
  readonly trailingSlice: ChunkSlice
  readonly compactableStartSeq: SessionSeq
  readonly compactableEndSeq: SessionSeq
}

/** Result of summarizing one index chunk. */
export interface StubSummaryResult {
  readonly summary: ContentBlock[]
  readonly keywords: readonly string[]
  readonly provider: string
  readonly model: string
  readonly usage?: TokenUsage
}

/** Result of summarizing the mutable state checkpoint. */
export interface StateSummaryResult {
  readonly summary: ContentBlock[]
  readonly provider: string
  readonly model: string
  readonly usage?: TokenUsage
}
