/** Typed voice callbacks and Remote results scripted independently by each test. */
import { vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { VoiceApi, VoiceModelRow } from '../src/client/api.ts'

type VoiceRemote = ClientRemote['voice']

/**
 * Create independent plain callbacks for component props.
 * @returns typed operation mocks with a ready engine and empty model roster.
 */
export function createVoiceCallbacks() {
  return {
    engineStatus: vi.fn<VoiceApi['engineStatus']>().mockResolvedValue({ ok: true }),
    modelsList: vi.fn<VoiceApi['modelsList']>().mockResolvedValue({ models: [] }),
    modelsDownload: vi.fn<VoiceApi['modelsDownload']>().mockResolvedValue({ cacheDir: '/cache/zh' }),
    modelsRemove: vi.fn<VoiceApi['modelsRemove']>().mockResolvedValue({}),
    transcribe: vi.fn<VoiceApi['transcribe']>().mockResolvedValue({ text: 'hello world' }),
  }
}

/**
 * Create the voice namespace accepted by the adapter and TestRemote.
 * @returns typed Remote operation mocks, including request objects and carrier signals.
 */
export function createVoiceRemote() {
  return {
    engineStatus: vi.fn<VoiceRemote['engineStatus']>()
      .mockResolvedValue({ ok: true, value: { ok: true } }),
    modelsList: vi.fn<VoiceRemote['modelsList']>()
      .mockResolvedValue({ ok: true, value: { models: [] } }),
    modelsDownload: vi.fn<VoiceRemote['modelsDownload']>()
      .mockResolvedValue({ ok: true, value: { cacheDir: '/cache/zh' } }),
    modelsRemove: vi.fn<VoiceRemote['modelsRemove']>()
      .mockResolvedValue({ ok: true, value: {} }),
    transcribe: vi.fn<VoiceRemote['transcribe']>()
      .mockResolvedValue({ ok: true, value: { text: 'hello world' } }),
  }
}

/**
 * Create a complete display row with a branded model identifier.
 * @param id - model identifier addressed by operation callbacks.
 * @param status - provider-reported installation state.
 * @param definition - display metadata overrides.
 * @returns one typed model row.
 */
export function modelRow(
  id: string,
  status: VoiceModelRow['status'] = { state: 'not-downloaded' },
  definition: Partial<Omit<VoiceModelRow['definition'], 'id'>> = {},
): VoiceModelRow {
  return {
    definition: {
      id: id as VoiceModelRow['definition']['id'],
      name: `${id}-model`,
      description: '',
      recommended: false,
      approximateBytes: 100,
      ...definition,
    },
    status,
  }
}
