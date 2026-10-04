// @vitest-environment jsdom
/** The agent-loop General row: its live number input, reset, and availability. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AgentLoopCard, type AgentLoopCardProps } from '../src/client/AgentLoopCard.tsx'
import type { AgentLoopCardState } from '../src/client/agent-loop-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

function renderRow(state: Partial<AgentLoopCardState> = {}) {
  const store = createSnapshotStore<AgentLoopCardState>({
    available: true, writable: true, maxParallelToolCalls: 10, overridden: false, ...state,
  })
  const actions = { setMaxParallel: vi.fn(), resetMaxParallel: vi.fn() }
  const props = { ...actions, t, useAgentLoopCard: bindSnapshotSelector(store) } as AgentLoopCardProps
  render(<AgentLoopCard {...props} />)
  return { ...actions, store }
}

describe('AgentLoopCard', () => {
  it('renders nothing while the namespace is unavailable', () => {
    renderRow({ available: false })

    expect(screen.queryByLabelText(en.maxParallel)).toBeNull()
  })

  it('writes every whole-number keystroke through and keeps the draft on display', () => {
    const { setMaxParallel } = renderRow()
    const input = screen.getByLabelText(en.maxParallel)

    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.change(input, { target: { value: '12' } })

    expect(setMaxParallel.mock.calls).toEqual([[2], [12]])
    expect(input).toHaveProperty('value', '12')
  })

  it('writes neither for an invalid draft and blurs back to the accepted cap', () => {
    const { setMaxParallel } = renderRow({ maxParallelToolCalls: 10 })
    const input = screen.getByLabelText(en.maxParallel)

    fireEvent.change(input, { target: { value: '0' } })
    expect(setMaxParallel).not.toHaveBeenCalled()
    fireEvent.blur(input)

    expect(input).toHaveProperty('value', '10')
  })

  it('treats a blanked draft as reset when an override stands, and as a plain revert otherwise', () => {
    const overridden = renderRow({ maxParallelToolCalls: 4, overridden: true })
    const overrideInput = screen.getByLabelText(en.maxParallel)
    fireEvent.change(overrideInput, { target: { value: '' } })
    fireEvent.blur(overrideInput)
    expect(overridden.resetMaxParallel).toHaveBeenCalledOnce()

    cleanup()
    const plain = renderRow()
    const plainInput = screen.getByLabelText(en.maxParallel)
    fireEvent.change(plainInput, { target: { value: '' } })
    fireEvent.blur(plainInput)
    expect(plain.resetMaxParallel).not.toHaveBeenCalled()
    expect(plainInput).toHaveProperty('value', '10')
  })

  it('steps from the displayed value with the stepper arrows and floors at 1', () => {
    const { setMaxParallel } = renderRow({ maxParallelToolCalls: 2 })
    const input = screen.getByLabelText(en.maxParallel)

    fireEvent.click(screen.getByRole('button', { name: en.increase }))
    expect(setMaxParallel).toHaveBeenCalledWith(3)
    expect(input).toHaveProperty('value', '3')
    fireEvent.click(screen.getByRole('button', { name: en.decrease }))
    expect(setMaxParallel).toHaveBeenCalledWith(2)

    cleanup()
    renderRow({ maxParallelToolCalls: 1 })
    expect(screen.getByRole('button', { name: en.decrease })).toHaveProperty('disabled', true)
  })

  it('offers the reset only while an override stands and disables the control on a read-only document', () => {
    const { resetMaxParallel } = renderRow({ maxParallelToolCalls: 4, overridden: true })

    fireEvent.click(screen.getByRole('button', { name: en.reset }))
    expect(resetMaxParallel).toHaveBeenCalledOnce()

    cleanup()
    renderRow({ writable: false })
    expect(screen.getByLabelText(en.maxParallel)).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
  })
})
