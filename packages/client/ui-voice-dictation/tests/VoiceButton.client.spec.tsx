// @vitest-environment jsdom
/* oxlint-disable typescript/no-unnecessary-type-assertion -- branded SessionId test literals intentionally cross the public test seam. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en, type VoiceSettingsKey } from '../src/client/locales.ts'
import { VoiceButton, type VoiceButtonProps } from '../src/client/VoiceButton.tsx'
import type { DictationState } from '../src/client/dictation-controller.ts'
import type { VoiceSettings } from '../src/client/voice-settings.ts'
import { createVoiceCallbacks, modelRow } from './voice-fixtures.client.ts'

const DEFAULT_SETTINGS: VoiceSettings = { enabled: true, dictationMode: 'toggle', sttModel: null, microphoneDeviceId: null }

function props(
  state: DictationState,
  modelsList: VoiceButtonProps['modelsList'],
  toggle = vi.fn(),
  settings: VoiceSettings = DEFAULT_SETTINGS,
): VoiceButtonProps {
  const sessionId = 's1' as never
  return {
    sessionId,
    modelsList,
    useInput: (selector: (value: { phase: 'plain' }) => unknown) => selector({ phase: 'plain' }),
    useDictation: (selector: (value: DictationState) => unknown) => selector(state),
    useSettings: (selector: (value: VoiceSettings) => unknown) => selector(settings),
    toggle,
    t: (key: VoiceSettingsKey) => en[key],
  } as unknown as VoiceButtonProps
}

describe('VoiceButton', () => {
  afterEach(cleanup)

  function readyModels() {
    return createVoiceCallbacks().modelsList.mockResolvedValue({
      models: [modelRow('m', { state: 'ready', cacheDir: '/cache/m' })],
    })
  }

  it('renders a microphone button and toggles the current session', async () => {
    const modelsList = readyModels()
    const toggle = vi.fn()
    const view = render(<VoiceButton {...props({ phase: 'idle' }, modelsList, toggle)} />)
    const button = await waitFor(() => screen.getByRole('button', { name: en.startDictation }))
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    expect(toggle).toHaveBeenCalledWith('s1')
    view.unmount()
  })

  it('renders the stop action while recording and disables during processing', async () => {
    const modelsList = readyModels()
    const view = render(<VoiceButton {...props({ phase: 'recording', sessionId: 's1' as never }, modelsList)} />)
    expect((await waitFor(() => screen.getByRole('button', { name: en.stopDictation })) as HTMLButtonElement).disabled).toBe(false)
    view.rerender(<VoiceButton {...props({ phase: 'processing', sessionId: 's1' as never }, modelsList)} />)
    expect((await waitFor(() => screen.getByRole('button', { name: en.processingDictation })) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not expose another session recording as a stop action', async () => {
    const modelsList = readyModels()
    render(<VoiceButton {...props({ phase: 'recording', sessionId: 's2' as never }, modelsList)} />)
    const button = await waitFor(() => screen.getByRole('button', { name: en.startDictation })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.dataset.dictationPhase).toBe('idle')
  })

  it('renders nothing when disabled or no model is ready', async () => {
    const modelsList = readyModels()
    const view = render(<VoiceButton {...props({ phase: 'idle' }, modelsList, vi.fn(), { ...DEFAULT_SETTINGS, enabled: false })} />)
    expect(view.container.querySelector('button')).toBeNull()
    expect(modelsList).not.toHaveBeenCalled()
    view.unmount()

    modelsList.mockResolvedValue({ models: [] })
    await act(async () => { render(<VoiceButton {...props({ phase: 'idle' }, modelsList)} />) })
    expect(modelsList).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
