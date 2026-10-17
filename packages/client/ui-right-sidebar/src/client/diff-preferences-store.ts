/** Store and hooks for editor and diff review preferences. */
import { useEffect, useState } from 'react'

/** Supported view modes for diff presentation. */
export type DiffViewMode = 'inline' | 'side-by-side'

/** Preferences for diff review and editor display. */
export interface DiffPreferences {
  readonly diffViewMode: DiffViewMode
  readonly diffWordWrap: boolean
  readonly showWhitespace: boolean
  readonly collapseUnchanged: boolean
}

export const DEFAULT_DIFF_PREFERENCES: DiffPreferences = {
  diffViewMode: 'inline',
  diffWordWrap: true,
  showWhitespace: false,
  collapseUnchanged: false,
}

const STORAGE_KEY = 'dsh.editor.diff.preferences'

function readPersisted(): DiffPreferences {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return DEFAULT_DIFF_PREFERENCES
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_DIFF_PREFERENCES
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      diffViewMode: parsed.diffViewMode === 'side-by-side' ? 'side-by-side' : 'inline',
      diffWordWrap: typeof parsed.diffWordWrap === 'boolean' ? parsed.diffWordWrap : DEFAULT_DIFF_PREFERENCES.diffWordWrap,
      showWhitespace: typeof parsed.showWhitespace === 'boolean' ? parsed.showWhitespace : DEFAULT_DIFF_PREFERENCES.showWhitespace,
      collapseUnchanged: typeof parsed.collapseUnchanged === 'boolean' ? parsed.collapseUnchanged : DEFAULT_DIFF_PREFERENCES.collapseUnchanged,
    }
  } catch {
    return DEFAULT_DIFF_PREFERENCES
  }
}

let activePreferences: DiffPreferences = readPersisted()
const subscribers = new Set<(prefs: DiffPreferences) => void>()

/**
 * Get current diff preferences snapshot.
 * @returns Immutable diff preferences snapshot.
 */
export function getDiffPreferences(): DiffPreferences {
  return activePreferences
}

/**
 * Update diff preferences and persist them.
 * @param updates - Partial diff preferences updates.
 */
export function setDiffPreferences(updates: Partial<DiffPreferences>): void {
  activePreferences = { ...activePreferences, ...updates }
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activePreferences))
    } catch {
      // storage unavailable or full
    }
  }
  for (const subscriber of subscribers) {
    subscriber(activePreferences)
  }
}

/**
 * Reset diff preferences to defaults.
 */
export function resetDiffPreferences(): void {
  activePreferences = DEFAULT_DIFF_PREFERENCES
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  for (const subscriber of subscribers) {
    subscriber(activePreferences)
  }
}

/**
 * Subscribe to diff preferences changes.
 * @param listener - Callback receiving fresh preferences.
 * @returns Disposer function.
 */
export function subscribeDiffPreferences(listener: (prefs: DiffPreferences) => void): () => void {
  subscribers.add(listener)
  return () => {
    subscribers.delete(listener)
  }
}

/**
 * React hook for consuming and updating diff preferences.
 * @returns Pair of current preferences and update function.
 */
export function useDiffPreferences(): [DiffPreferences, (updates: Partial<DiffPreferences>) => void] {
  const [state, setState] = useState<DiffPreferences>(getDiffPreferences)
  useEffect(() => {
    setState(getDiffPreferences())
    return subscribeDiffPreferences(setState)
  }, [])
  return [state, setDiffPreferences]
}
