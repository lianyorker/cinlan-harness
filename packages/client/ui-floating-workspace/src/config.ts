/** Deployment-only cadence for observing closure of an opener-owned app window. */
import Schema from '@deepseek-ai/schemastery'

/** This cadence changes observation latency, never popup admission or preference values. */
export interface Config { windowClosedPollMs: number }

/** WindowProxy.closed has no browser event; polling exists only while an owned window is open. */
export const Config: Schema<Config> = Schema.object({
  windowClosedPollMs: Schema.number().step(1).min(100).max(5000).default(500),
})
