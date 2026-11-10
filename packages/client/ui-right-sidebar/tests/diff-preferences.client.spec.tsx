// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_DIFF_PREFERENCES,
  getDiffPreferences,
  resetDiffPreferences,
  setDiffPreferences,
} from '../src/client/diff-preferences-store.ts'
import { DiffPreferencesRow } from '../src/client/DiffPreferencesRow.tsx'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { en } from '../src/client/locales.ts'

// The row consumes none of the standard hooks in these specs.
const standard = {} as GlobalStandardProps

beforeEach(() => {
  localStorage.clear()
  resetDiffPreferences()
})

afterEach(cleanup)

describe('diff-preferences-store', () => {
  it('initializes with default diff preferences', () => {
    expect(getDiffPreferences()).toEqual(DEFAULT_DIFF_PREFERENCES)
  })

  it('updates preferences and persists to localStorage', () => {
    setDiffPreferences({ diffViewMode: 'side-by-side', diffWordWrap: false, showWhitespace: true })
    expect(getDiffPreferences().diffViewMode).toBe('side-by-side')
    expect(getDiffPreferences().diffWordWrap).toBe(false)
    expect(getDiffPreferences().showWhitespace).toBe(true)

    const raw = localStorage.getItem('dsh.editor.diff.preferences')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.diffViewMode).toBe('side-by-side')
  })

  it('resets preferences back to defaults and clears storage', () => {
    setDiffPreferences({ diffViewMode: 'side-by-side' })
    resetDiffPreferences()
    expect(getDiffPreferences().diffViewMode).toBe('inline')
    expect(localStorage.getItem('dsh.editor.diff.preferences')).toBeNull()
  })
})

describe('DiffPreferencesRow component', () => {
  const t = (key: keyof typeof en) => en[key] ?? key

  it('renders title, description, and autoSave managed status badge', () => {
    render(<DiffPreferencesRow {...standard} t={t} />)
    expect(screen.getByText(en['review.diffPreferencesTitle'])).toBeTruthy()
    expect(screen.getByText(en['review.diffPreferencesDesc'])).toBeTruthy()
    expect(screen.getByText(en['review.autoSaveTitle'])).toBeTruthy()
    expect(screen.getByText(en['review.autoSaveDesc'])).toBeTruthy()
    expect(screen.getByText(en['review.autoSaveBadge'])).toBeTruthy()
  })

  it('allows switching view mode and toggling word-wrap and whitespace', () => {
    render(<DiffPreferencesRow {...standard} t={t} />)

    // Switch to side-by-side
    const sideBySideBtn = screen.getByText(en['review.viewSideBySide'])
    fireEvent.click(sideBySideBtn)
    expect(getDiffPreferences().diffViewMode).toBe('side-by-side')

    // Switch back to inline
    const inlineBtn = screen.getByText(en['review.viewInline'])
    fireEvent.click(inlineBtn)
    expect(getDiffPreferences().diffViewMode).toBe('inline')

    // Toggle word wrap
    const wordWrapSwitch = screen.getByRole('switch', { name: en['review.wordWrap'] })
    expect(wordWrapSwitch.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(wordWrapSwitch)
    expect(getDiffPreferences().diffWordWrap).toBe(false)

    // Toggle show whitespace
    const whitespaceSwitch = screen.getByRole('switch', { name: en['review.showWhitespace'] })
    expect(whitespaceSwitch.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(whitespaceSwitch)
    expect(getDiffPreferences().showWhitespace).toBe(true)
  })
})
