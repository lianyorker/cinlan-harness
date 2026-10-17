export type WorkStepsDisplay = 'always' | 'running' | 'hidden'
export type BusySendMode = 'queue' | 'steer'

export interface MobilePreferences {
  workSteps: WorkStepsDisplay
  busySend: BusySendMode
}

const KEY = 'cinlan-mobile:preferences-v1'
const defaults: MobilePreferences = { workSteps: 'running', busySend: 'steer' }

/** Load the mobile-only presentation and busy-send preferences. */
export function loadMobilePreferences(): MobilePreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!value || typeof value !== 'object') return defaults
    const record = z.record(z.string(), z.unknown()).parse(value)
    return {
      workSteps: record.workSteps === 'always' || record.workSteps === 'hidden' ? record.workSteps : defaults.workSteps,
      busySend: record.busySend === 'queue' ? 'queue' : defaults.busySend,
    }
  } catch (_invalidPreferences) {
    return defaults
  }
}

/** Persist preferences shared by the settings and session screens. */
export function saveMobilePreferences(value: MobilePreferences): void {
  localStorage.setItem(KEY, JSON.stringify(value))
}
import { z } from 'zod'

