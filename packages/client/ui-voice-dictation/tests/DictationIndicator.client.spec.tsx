// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { en, type VoiceSettingsKey } from '../src/client/locales.ts'
import { DictationIndicator, type DictationIndicatorProps } from '../src/client/DictationIndicator.tsx'
import type { DictationState } from '../src/client/dictation-controller.ts'

function props(state: DictationState, stop = vi.fn()): DictationIndicatorProps {
  const dictation = createSnapshotStore(state)
  return {
    useDictation: (selector: (value: DictationState) => unknown) => selector(dictation.getSnapshot()),
    stop,
    t: (key: VoiceSettingsKey) => en[key],
  } as unknown as DictationIndicatorProps
}

describe('DictationIndicator', () => {
  afterEach(cleanup)

  it.each([
    [{ phase: 'starting', sessionId: SessionId('s1') }, en.startingDictation],
    [{ phase: 'recording', sessionId: SessionId('s1') }, en.recordingDictation],
    [{ phase: 'processing', sessionId: SessionId('s1') }, en.processingDictation],
  ] as const)('shows the application-wide %s state', (state, label) => {
    render(<DictationIndicator {...props(state)} />)
    expect(screen.getByRole('status').textContent).toContain(label)
  })

  it('stops the session that owns recording and disables stop during transcription', () => {
    const stop = vi.fn()
    const view = render(<DictationIndicator {...props({ phase: 'recording', sessionId: SessionId('s1') }, stop)} />)
    fireEvent.click(screen.getByRole('button', { name: en.stopDictation }))
    expect(stop).toHaveBeenCalledWith('s1')

    view.rerender(<DictationIndicator {...props({ phase: 'processing', sessionId: SessionId('s1') }, stop)} />)
    expect((screen.getByRole('button', { name: en.stopDictation }) as HTMLButtonElement).disabled).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('shows the latest partial hypothesis while recording', () => {
    render(<DictationIndicator {...props({ phase: 'recording', sessionId: SessionId('s1'), transcript: 'partial words' })} />)
    expect(screen.getByRole('status').textContent).toContain('partial words')
  })

  it('renders no status strip while idle or after an error', () => {
    const view = render(<DictationIndicator {...props({ phase: 'idle' })} />)
    expect(screen.queryByRole('status')).toBeNull()
    view.rerender(<DictationIndicator {...props({ phase: 'error', message: 'Capture failed' })} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
