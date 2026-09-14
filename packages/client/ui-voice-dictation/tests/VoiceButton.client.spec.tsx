/* oxlint-disable typescript/no-unnecessary-type-assertion -- branded SessionId test literals intentionally cross the public test seam. */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { en, type VoiceSettingsKey } from '../src/client/locales.ts'
import { VoiceButton, type VoiceButtonProps } from '../src/client/VoiceButton.tsx'
import type { DictationState } from '../src/client/dictation-controller.ts'

function props(state: DictationState, toggle = vi.fn()): VoiceButtonProps {
  const sessionId = 's1' as never
  return {
    sessionId,
    useInput: (selector: (value: { phase: 'plain' }) => unknown) => selector({ phase: 'plain' }),
    useDictation: (selector: (value: DictationState) => unknown) => selector(state),
    toggle,
    t: (key: VoiceSettingsKey) => en[key],
  } as unknown as VoiceButtonProps
}

describe('VoiceButton', () => {
  it('renders a microphone button and toggles the current session', () => {
    const toggle = vi.fn()
    const view = render(<VoiceButton {...props({ phase: 'idle' }, toggle)} />)
    const button = screen.getByRole('button', { name: en.startDictation })
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    expect(toggle).toHaveBeenCalledWith('s1')
    view.unmount()
  })

  it('renders the stop action while recording and disables during processing', () => {
    const view = render(<VoiceButton {...props({ phase: 'recording', sessionId: 's1' as never })} />)
    expect((screen.getByRole('button', { name: en.stopDictation }) as HTMLButtonElement).disabled).toBe(false)
    view.rerender(<VoiceButton {...props({ phase: 'processing', sessionId: 's1' as never })} />)
    expect((screen.getByRole('button', { name: en.processingDictation }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not expose another session recording as a stop action', () => {
    render(<VoiceButton {...props({ phase: 'recording', sessionId: 's2' as never })} />)
    const button = screen.getByRole('button', { name: en.startDictation }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.dataset.dictationPhase).toBe('idle')
  })
})
