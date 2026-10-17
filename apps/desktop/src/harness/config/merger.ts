/** Deep merge configuration objects with proper handling of arrays and nested objects */

import type { HarnessConfig, PartialHarnessConfig } from './types.ts'

/** Check if value is a plain object */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Copy defaults and recursively apply object overrides. */
function mergeObjects<T extends object>(defaults: T, ...configs: object[]): T {
  const result = { ...defaults }
  const entries = result as Record<string, unknown>
  for (const config of configs) {
    for (const [key, value] of Object.entries(config) as Array<[string, unknown]>) {
      if (value === undefined) continue

      const previous = entries[key]
      if (isPlainObject(value) && isPlainObject(previous)) {
        entries[key] = mergeObjects(previous, value)
      } else {
        entries[key] = value
      }
    }
  }

  return result
}

/**
 * Merge nested overrides without modifying the source configurations.
 * @param defaults - complete configuration supplying all required fields.
 * @param configs - partial overrides, in increasing priority.
 * @returns configuration with arrays replaced and undefined overrides skipped.
 */
export function mergeConfigs(defaults: HarnessConfig, ...configs: PartialHarnessConfig[]): HarnessConfig {
  return mergeObjects(defaults, ...configs)
}
