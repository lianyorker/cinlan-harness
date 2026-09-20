// @vitest-environment jsdom
/** Protocol and input capability edits preserve user-owned provider and model settings. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ModelInputTypes } from '../src/client/ModelInputTypes.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import type { ModelDiscoveryOutcome, ModelsOperations } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]
const inputLabel = `${en.modelInputTypes} 1`
const modelSchema = Schema.object({
  id: Schema.string().required(),
  name: Schema.string(),
  inputModalities: Schema.array(Schema.union(['text', 'image'])).min(1).default(['text']),
  imagePixelBudget: Schema.union([Schema.number(), 'low']),
  imageMaxBytes: Schema.number(),
  description: Schema.string(),
})
const DeepSeekConfig = Schema.object({
  apiKeyEnv: Schema.string().default('DEEPSEEK_API_KEY'),
  protocol: Schema.union(['chat-completions', 'messages']).default('chat-completions'),
  baseURL: Schema.string().default('https://api.deepseek.com'),
  models: Schema.array(modelSchema).default([modelSchema({ id: 'default-model' })]),
})

function namespace(user: Record<string, JsonValue> = {}, base: Record<string, JsonValue> = {}): SettingsNamespaceView {
  return {
    ns: 'llm-deepseek',
    schema: JSON.parse(JSON.stringify(DeepSeekConfig.toJSON())) as JsonValue,
    value: DeepSeekConfig({ ...base, ...user }),
    user,
    base,
    applies: 'live',
    revision: 8,
    secrets: [],
  }
}

function operations(view = namespace()) {
  return {
    describeCredential: vi.fn<ModelsOperations['describeCredential']>(async () => ({ configured: true, writable: true })),
    storeCredential: vi.fn<ModelsOperations['storeCredential']>(async () => undefined),
    removeCredential: vi.fn<ModelsOperations['removeCredential']>(async () => undefined),
    writeSettings: vi.fn<ModelsOperations['writeSettings']>(async () => ({ kind: 'written', view })),
    discoverModels: vi.fn<ModelsOperations['discoverModels']>(async () => ({ kind: 'found', models: [] })),
  } satisfies ModelsOperations
}

async function mountProvider(view: SettingsNamespaceView, readOnly = false) {
  const api = operations(view)
  const onClose = vi.fn()
  render(<ProviderEditor
    provider="deepseek-official" displayName="DeepSeek" namespace={view} schema={settingsSchema}
    settingsPath={[]} operations={api} t={t} readOnly={readOnly} onClose={onClose}
  />)
  await screen.findByPlaceholderText(en.keyStored)
  fireEvent.click(screen.getByText(en.customized))
  return { api, onClose }
}

describe('DeepSeek protocol settings', () => {
  it('defaults to chat completions and saves Messages without replacing the gateway or models', async () => {
    const models = [{ id: 'private-vision', inputModalities: ['text', 'image'], description: 'User catalog' }]
    const view = namespace({ baseURL: 'https://gateway.example/v1', models })
    const { api, onClose } = await mountProvider(view)
    const protocol = screen.getByLabelText<HTMLSelectElement>(en.customApi)
    expect(protocol.value).toBe('chat-completions')
    expect([...protocol.options].map(option => option.value)).toEqual(['chat-completions', 'messages'])
    fireEvent.change(protocol, { target: { value: 'messages' } })
    expect(screen.getByLabelText<HTMLInputElement>(en.baseUrl).value).toBe('https://gateway.example/v1')
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('private-vision')
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(api.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [
      { op: 'set', path: ['protocol'], value: 'messages' },
    ], 8)
    expect(view.user).toEqual({ baseURL: 'https://gateway.example/v1', models })
  })

  it('reads an inherited protocol and switches to chat completions without materializing models', async () => {
    const { api, onClose } = await mountProvider(namespace({}, { protocol: 'messages' }))
    expect(screen.getByLabelText<HTMLSelectElement>(en.customApi).value).toBe('messages')
    fireEvent.change(screen.getByLabelText(en.customApi), { target: { value: 'chat-completions' } })
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(api.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [
      { op: 'set', path: ['protocol'], value: 'chat-completions' },
    ], 8)
  })

  it('saves a vision edit in the existing catalog while preserving other rows and hidden fields', async () => {
    const models = [
      { id: 'vision', inputModalities: ['text', 'image'], imagePixelBudget: 'low', imageMaxBytes: 4096, description: 'Keep me' },
      { id: 'second', inputModalities: ['text'], description: 'Keep this row' },
    ]
    const { api, onClose } = await mountProvider(namespace({ protocol: 'messages', models }))
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
    expect(screen.getByLabelText<HTMLSelectElement>(inputLabel).value).toBe('text,image')
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: 'text' } })
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(api.writeSettings).toHaveBeenCalledExactlyOnceWith('llm-deepseek', [{
      op: 'set', path: ['models'], value: [
        { id: 'vision', inputModalities: ['text'], description: 'Keep me' },
        models[1],
      ],
    }], 8)
  })

  it('disables protocol and input edits in a read-only deployment', async () => {
    const { api } = await mountProvider(namespace(), true)
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
    expect(screen.getByLabelText<HTMLSelectElement>(en.customApi).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLSelectElement>(inputLabel).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.apply }).disabled).toBe(true)
    expect(api.writeSettings).not.toHaveBeenCalled()
  })
})

describe('model input types', () => {
  it.each([
    { model: { id: 'model' }, fallback: undefined, selected: 'text' },
    { model: { id: 'model', input: [] }, fallback: ['text', 'image'], selected: 'text,image' },
    { model: { id: 'model', input: ['image'] }, fallback: ['text'], selected: 'image' },
  ])('shows inherited and explicit capabilities: $selected', ({ model, fallback, selected }) => {
    const onChange = vi.fn()
    render(<ModelInputTypes model={model} field="input" fallback={fallback} position={1} disabled={false} t={t} onChange={onChange} />)
    const select = screen.getByLabelText<HTMLSelectElement>(inputLabel)
    expect(select.value).toBe(selected)
    expect([...select.options].map(option => option.value)).toEqual(['text', 'text,image', 'image'])
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: 'text,image' } })
    expect(onChange).toHaveBeenCalledWith({ ...model, input: ['text', 'image'] })
  })

  it('retains image request limits while image input remains enabled', () => {
    const model = { id: 'vision', inputModalities: ['image'], imagePixelBudget: 'low', imageMaxBytes: 8192 }
    const onChange = vi.fn()
    render(<ModelInputTypes model={model} field="inputModalities" position={1} disabled={false} t={t} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: 'text,image' } })
    expect(onChange).toHaveBeenCalledWith({ ...model, inputModalities: ['text', 'image'] })
  })
})

describe('pi-ai capability discovery', () => {
  it('inherits catalog inputs, falls back to provider inputs, and writes only an explicit row edit', async () => {
    const api = operations()
    api.discoverModels.mockResolvedValue({ kind: 'found', models: [{ id: 'vision', inputModalities: ['text', 'image'] }] })
    const models = [{ id: 'vision', headers: { team: 'a' } }, { id: 'private' }]
    const onChange = vi.fn()
    render(<ModelListEditor models={models} catalogProvider="installed" defaultInput={['image']}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'installed', baseURL: 'https://unsaved.example', apiKey: 'unsaved-key' }}
      operations={api} t={t} disabled={false} onChange={onChange}
    />)
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 2`))
    await waitFor(() => { expect(screen.getByLabelText<HTMLSelectElement>(inputLabel).value).toBe('text,image') })
    expect(screen.getByLabelText<HTMLSelectElement>(`${en.modelInputTypes} 2`).value).toBe('image')
    expect(api.discoverModels).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', { provider: 'installed' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: 'text' } })
    expect(onChange).toHaveBeenCalledWith([{ ...models[0], input: ['text'] }, models[1]])
  })

  it('adopts disclosed inputs only for new candidates and preserves every existing row', async () => {
    const api = operations()
    api.discoverModels.mockResolvedValue({ kind: 'found', models: [
      { id: 'existing', name: 'Remote', inputModalities: ['image'] },
      { id: 'new', name: 'Vision', contextWindow: 65536, maxTokens: 8192, inputModalities: ['text', 'image'] },
    ] })
    const models = [{ id: 'existing', name: 'Local', input: ['text'], custom: true }, { id: 'private' }]
    const onChange = vi.fn()
    render(<ModelListEditor models={models} probe={{ settingsNs: 'llm-pi-ai', baseURL: 'https://gateway.example' }}
      operations={api} t={t} disabled={false} onChange={onChange}
    />)
    fireEvent.click(screen.getByRole('button', { name: en.fetchModels }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('checkbox', { name: 'existing' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.fetchAdopt }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith([...models, {
      id: 'new', name: 'Vision', contextWindow: 65536, maxTokens: 8192, input: ['text', 'image'],
    }])
  })

  it('keeps manual capability editing available when the installed catalog is refused', async () => {
    const api = operations()
    api.discoverModels.mockResolvedValue({ kind: 'refused', message: 'Catalog unavailable' })
    const onChange = vi.fn()
    render(<ModelListEditor models={[{ id: 'model' }]} catalogProvider="installed"
      probe={{ settingsNs: 'llm-pi-ai' }} operations={api} t={t} disabled={false} onChange={onChange}
    />)
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
    await screen.findByText('Catalog unavailable')
    fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: 'text,image' } })
    expect(onChange).toHaveBeenCalledWith([{ id: 'model', input: ['text', 'image'] }])
  })

  it('ignores an old provider reply after switching providers', async () => {
    const api = operations()
    const oldReply = Promise.withResolvers<ModelDiscoveryOutcome>()
    api.discoverModels.mockReturnValueOnce(oldReply.promise).mockResolvedValue({
      kind: 'found', models: [{ id: 'model', inputModalities: ['text'] }],
    })
    const props = { models: [{ id: 'model' }], probe: { settingsNs: 'llm-pi-ai' }, operations: api, t, disabled: false, onChange: vi.fn() }
    const view = render(<ModelListEditor {...props} catalogProvider="old" />)
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 1`))
    expect(screen.getByRole('status').textContent).toBe(en.fetching)
    view.rerender(<ModelListEditor {...props} catalogProvider="new" />)
    await screen.findByLabelText(inputLabel)
    await act(async () => { oldReply.resolve({ kind: 'refused', message: 'Old failure' }); await oldReply.promise })
    expect(screen.queryByText('Old failure')).toBeNull()
    expect(screen.getByLabelText<HTMLSelectElement>(inputLabel).value).toBe('text')
    expect(props.onChange).not.toHaveBeenCalled()
  })
})
