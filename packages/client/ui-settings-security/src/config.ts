/** Settings resource observation limits. */
import Schema from '@deepseek-ai/schemastery'

/** Browser resource observation cadence while its settings page is mounted. */
export interface Config {
  /** Interval between Host status requests, in milliseconds. */
  runtimePollIntervalMs: number
}

/** Validated resource observation settings shared by both Loader faces. */
export const Config: Schema<Config> = Schema.object({
  runtimePollIntervalMs: Schema.number().min(100).max(60_000).default(1000),
})
