// @vitest-environment jsdom
/** The two Subagent pages as the settings shell renders them: limits, and model selection. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SubagentLimitsSection, type SubagentLimitsSectionProps } from '../src/client/SubagentLimitsSection.tsx'
import {
  SubagentModelSelectionSection, type SubagentModelSelectionSectionProps,
} from '../src/client/SubagentModelSelectionSection.tsx'
import type { SubagentLimitsCardState } from '../src/client/subagent-limits-card-controller.ts'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SubagentModelSelectionCardState } from '../src/client/subagent-model-selection-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

const settled: SettingsFormShell = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
}

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function renderLimits(state: Partial<SubagentLimitsCardState> = {}) {
  const store = createSnapshotStore<SubagentLimitsCardState>({
    ...settled,
    maxDepth: field('3'),
    maxActiveSubagents: field('8'),
    ...state,
  })
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = { ...actions, t, useSubagentLimitsCard: bindSnapshotSelector(store) } as SubagentLimitsSectionProps
  render(<SubagentLimitsSection {...props} />)
  return { ...actions, store }
}

function renderModels(state: Partial<SubagentModelSelectionCardState> = {}) {
  const store = createSnapshotStore<SubagentModelSelectionCardState>({
    ...settled,
    enabled: false,
    candidates: [],
    catalogStatus: 'idle',
    catalogPartial: false,
    conflicted: false,
    ...state,
  })
  const actions = {
    toggleEnabled: vi.fn(),
    toggleModel: vi.fn(),
    retryCatalog: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  }
  const props = {
    ...actions, t, useSubagentModelSelectionCard: bindSnapshotSelector(store),
  } as SubagentModelSelectionSectionProps
  render(<SubagentModelSelectionSection {...props} />)
  return { ...actions, store }
}

describe('SubagentLimitsSection', () => {
  it('renders the unavailable line while the namespace is not served', () => {
    renderLimits({ available: false })

    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
    expect(screen.queryByLabelText(en.subagentMaxDepth)).toBeNull()
  })

  it('reveals field rules on demand without changing staged values', () => {
    renderLimits({ dirty: true, maxDepth: field('2') })
    const depthHelp = screen.getByRole('button', { name: en.subagentDepthHelpLabel })
    const capacityHelp = screen.getByRole('button', { name: en.subagentCapacityHelpLabel })
    expect(depthHelp.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(en.subagentDepthHelp)).toBeNull()
    expect(screen.queryByText(en.subagentCapacityHelp)).toBeNull()

    fireEvent.click(depthHelp)
    expect(depthHelp.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: en.subagentDepthHelpLabel })).toBeTruthy()
    expect(screen.getByText(en.subagentDepthHelp)).toBeTruthy()
    expect(screen.getByRole('table', { name: en.subagentDepthHelpLabel })).toBeTruthy()
    expect(screen.getByRole('row', { name: `0 ${en.subagentDepthZero}` })).toBeTruthy()
    expect(screen.getByRole('row', { name: `1 ${en.subagentDepthOne}` })).toBeTruthy()
    expect(screen.getByText(en.subagentDepthOverride)).toBeTruthy()
    fireEvent.click(capacityHelp)
    expect(screen.getByText(en.subagentCapacityHelp)).toBeTruthy()
    fireEvent.click(depthHelp)
    expect(screen.queryByText(en.subagentDepthHelp)).toBeNull()
    expect(screen.getByLabelText(en.subagentMaxDepth)).toHaveProperty('value', '2')
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
  })

  it('keeps validation visible when the rules are collapsed and links it to the input', () => {
    renderLimits({ dirty: true, invalid: true, maxDepth: field('1.5', { invalid: true }) })
    const depth = screen.getByLabelText(en.subagentMaxDepth)
    const messageId = depth.getAttribute('aria-describedby')!
    expect(document.getElementById(messageId)?.textContent).toBe(en.subagentDepthInvalid)
    expect(screen.queryByRole('region', { name: en.subagentDepthHelpLabel })).toBeNull()
  })

  it('edits and resets limits through the page, and disables them on a read-only document', () => {
    const { edit, resetField, store } = renderLimits({
      dirty: true,
      maxDepth: field('3', { overridden: true }),
      maxActiveSubagents: field('8', { overridden: true }),
    })
    fireEvent.change(screen.getByLabelText(en.subagentMaxDepth), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(en.subagentMaxActive), { target: { value: '12' } })
    expect(edit.mock.calls).toEqual([['maxDepth', '2'], ['maxActiveSubagents', '12']])
    for (const button of screen.getAllByRole('button', { name: en.reset })) fireEvent.click(button)
    expect(resetField.mock.calls).toEqual([['maxDepth'], ['maxActiveSubagents']])
    act(() => { store.set({ ...store.getSnapshot(), writable: false }) })
    expect(screen.getByLabelText(en.subagentMaxActive)).toHaveProperty('disabled', true)
  })

  it('locks the fields while a save is crossing the wire', () => {
    renderLimits({ dirty: true, saving: true })

    expect(screen.getByLabelText(en.subagentMaxDepth)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
  })

  it('discards the draft when leaving the page', () => {
    const { discard } = renderLimits({ dirty: true })
    cleanup()

    expect(discard).toHaveBeenCalledOnce()
  })
})

describe('SubagentModelSelectionSection', () => {
  it('renders the default-off preference in its page', () => {
    const { toggleEnabled } = renderModels()

    const control = screen.getByRole('switch', { name: en.subagentModelSelectionToggle })
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)

    expect(toggleEnabled).toHaveBeenCalledOnce()
  })

  it('groups available adapter candidates by provider', () => {
    const { toggleModel } = renderModels({
      enabled: true,
      candidates: [
        {
          key: 'alpha\0fast',
          provider: 'alpha',
          model: 'fast',
          providerName: 'Alpha API',
          modelName: 'Fast',
          available: true,
          selected: true,
        },
        {
          key: 'alpha\0deep',
          provider: 'alpha',
          model: 'deep',
          providerName: 'Alpha API',
          modelName: 'Deep',
          available: true,
          selected: false,
        },
      ],
      catalogStatus: 'ready',
    })

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Alpha API', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Fast/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Deep/ }))
    expect(toggleModel).toHaveBeenCalledWith('alpha\0fast')
    expect(toggleModel).toHaveBeenCalledWith('alpha\0deep')
  })

  it('renders directory progress, failures, unavailable routes, and validation', () => {
    renderModels({ enabled: true, catalogStatus: 'loading', invalid: true })
    expect(screen.getByText(en.subagentModelSelectionLoading)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionRequired)).toBeTruthy()

    cleanup()
    const errorActions = renderModels({ enabled: true, catalogStatus: 'error' })
    fireEvent.click(screen.getByRole('button', { name: en.subagentModelSelectionRetry }))
    expect(errorActions.retryCatalog).toHaveBeenCalledOnce()

    cleanup()
    renderModels({
      enabled: true,
      catalogStatus: 'ready',
      catalogPartial: true,
      candidates: [{
        key: 'legacy\0old',
        provider: 'legacy',
        model: 'old',
        providerName: 'legacy',
        modelName: 'old',
        available: false,
        selected: true,
      }],
    })
    expect(screen.getByText(en.subagentModelSelectionPartial)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionUnavailable)).toBeTruthy()
    expect(screen.getByText(en.subagentModelSelectionUnavailableGroup)).toBeTruthy()

    cleanup()
    renderModels({ enabled: true, catalogStatus: 'ready' })
    expect(screen.getByText(en.subagentModelSelectionEmpty)).toBeTruthy()
  })

  it('blocks the save while a draft is invalid or conflicted, and distinguishes the conflict from a rejected save', () => {
    const { store } = renderModels({ dirty: true, invalid: true })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)

    act(() => { store.set({ ...store.getSnapshot(), invalid: false, conflicted: true }) })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(screen.getByText(en.subagentModelSelectionConflict)).toBeTruthy()
    expect(screen.queryByText(en.saveFailed)).toBeNull()
  })

  it('disables the switch on a read-only document and discards the draft when leaving the page', () => {
    const readonly = renderModels({ writable: false })
    const control = screen.getByRole('switch') as HTMLButtonElement
    expect(control.disabled).toBe(true)
    fireEvent.click(control)
    expect(readonly.toggleEnabled).not.toHaveBeenCalled()

    cleanup()
    const { discard } = renderModels({ dirty: true })
    cleanup()
    expect(discard).toHaveBeenCalledOnce()
  })
})
