import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import type { VoiceModelTask } from '@deepseek-ai/dsh-voice'
import * as sherpaDeps from '@deepseek-ai/dsh-voice-sherpa-onnx/src/sherpa-deps.ts'
import { authenticatedCookie, createHarness, FIXTURE_PLUGIN, installModel, models, MODEL_ID, nativeRecognizer, remoteResult, terminalTask } from './harness.ts'

const PROVIDER = '@deepseek-ai/dsh-voice-sherpa-onnx'
const CONTROLLER = '@deepseek-ai/dsh-api-voice-controller'
const ROSTER = [
  'zh-streaming-zipformer-14m', 'bilingual-streaming-zipformer', 'en-streaming-zipformer-20m',
  'bilingual-streaming-paraformer', 'sense-voice-zh-en-ja-ko-yue', 'whisper-tiny', MODEL_ID,
]
const PCM = Buffer.from(new Float32Array([0, 0.25, -0.5]).buffer).toString('base64')

async function task(harness: Awaited<ReturnType<typeof createHarness>>, method = 'modelsDownload', signal?: AbortSignal) {
  const result = await remoteResult(await harness.remote(method, { request: { modelId: MODEL_ID } }, signal))
  if (!result.ok) throw new Error(result.error.message)
  const receipt = result.value as VoiceModelTask
  expect(receipt.modelId).toBe(MODEL_ID)
  expect(receipt.taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  return receipt
}

async function fixtureRow(harness: Awaited<ReturnType<typeof createHarness>>) {
  const row = (await models(harness)).find(row => row.definition.id === MODEL_ID)
  if (row === undefined) throw new Error('fixture model missing from roster')
  return row
}

describe('voice real Loader and carriers', () => {
  it('serves the shipped roster and engine status through desktop Fetch without a WebServer', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    expect(harness.ctx.get('webServer')).toBeUndefined()
    expect(harness.ctx.get('subprocess')).toBeDefined()
    const roster = await models(harness)
    expect(roster.filter(model => model.definition.id !== MODEL_ID).map(model => model.definition.id))
      .toEqual(ROSTER.filter(id => id !== MODEL_ID))
    expect(roster.filter(model => model.definition.id === MODEL_ID)).toHaveLength(1)
    expect(roster.every(model => model.status.state === 'not-downloaded')).toBe(true)
    expect(roster.every(model => model.resource.integrity === 'missing' && model.task === null)).toBe(true)
    expect(await remoteResult(await harness.remote('engineStatus'))).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
    expect(native.construct).not.toHaveBeenCalled()
  })

  it('reports native-addon degradation as status with provider repair guidance', async () => {
    vi.spyOn(sherpaDeps, 'loadSherpaOnnx').mockReturnValue(null)
    vi.spyOn(sherpaDeps, 'sherpaOnnxLoadCause').mockReturnValue(new Error('native module missing'))
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote('engineStatus'))).toMatchObject({ ok: true, value: {
      ok: false, cause: 'native module missing', command: expect.stringContaining('dsh plugin --profile') as unknown,
      note: expect.stringContaining('allowBuilds: sherpa-onnx-node: true') as unknown,
    } })
    const roster = await models(harness)
    expect(roster.filter(model => model.definition.id !== MODEL_ID).map(model => model.definition.id))
      .toEqual(ROSTER.filter(id => id !== MODEL_ID))
  })

  it.each([
    { method: 'modelsDownload', request: { modelId: '' } },
    { method: 'modelsRemove', request: { modelId: '' } },
    { method: 'modelsCancel', request: { modelId: MODEL_ID, taskId: 'not-a-task-id' } },
    { method: 'transcribe', request: { modelId: MODEL_ID, pcm16kMonoBase64: 'not base64' } },
    { method: 'transcribe', request: { modelId: MODEL_ID, pcm16kMonoBase64: Buffer.from('one').toString('base64') } },
    { method: 'transcribe', request: { modelId: MODEL_ID, pcm16kMonoBase64: Buffer.from(new Float32Array([NaN]).buffer).toString('base64') } },
  ])('returns a typed invalid-request refusal for $method payload $request', async ({ method, request }) => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote(method, { request }))).toMatchObject({
      ok: false, error: { code: 'voice/invalid-request', details: { code: 'VOICE_INVALID_REQUEST' } },
    })
    expect(native.construct).not.toHaveBeenCalled()
    expect((await models(harness)).every(model => model.status.state === 'not-downloaded')).toBe(true)
  })

  it('rejects non-string model selectors before starting a download', async () => {
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote('modelsDownload', { request: { modelId: 42 } }))).toMatchObject({
      ok: false, error: { code: 'voice/invalid-request', details: { code: 'VOICE_INVALID_REQUEST' } },
    })
    expect((await models(harness)).every(model => model.status.state === 'not-downloaded')).toBe(true)
  })

  it.each(['modelsDownload', 'modelsReinstall', 'modelsUpdate', 'modelsRemove', 'transcribe'])('returns the typed unknown-model refusal for %s', async (method) => {
    const harness = await createHarness()
    const request = method === 'transcribe' ? { modelId: 'unknown-model', pcm16kMonoBase64: PCM } : { modelId: 'unknown-model' }
    expect(await remoteResult(await harness.remote(method, { request }))).toMatchObject({
      ok: false, error: { code: 'voice/model-unknown', details: { code: 'VOICE_MODEL_UNKNOWN' } },
    })
  })

  it('refuses transcription before model installation without loading the native addon', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toMatchObject({ ok: false, error: { code: 'voice/model-not-ready', details: { code: 'VOICE_MODEL_NOT_READY' } } })
    expect(native.load).not.toHaveBeenCalled()
  })

  it('transcribes through the real provider and removes only the private installed model', async () => {
    const native = nativeRecognizer('recognized locally')
    const harness = await createHarness()
    const cacheDir = await installModel(harness)
    expect((await fixtureRow(harness)).status).toEqual({ state: 'ready', cacheDir })
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toEqual({ ok: true, value: { text: 'recognized locally' } })
    expect(native.construct).toHaveBeenCalledOnce()
    expect(native.acceptWaveform.mock.calls[0]?.[0]).toEqual({ sampleRate: 16_000, samples: new Float32Array([0, 0.25, -0.5]) })
    expect(native.getResult).toHaveBeenCalledOnce()
    expect(await remoteResult(await harness.remote('modelsRemove', { request: { modelId: MODEL_ID } }))).toEqual({ ok: true, value: {} })
    await expect(access(cacheDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fixtureRow(harness)).status).toEqual({ state: 'not-downloaded' })
  })

  it('sanitizes an unclassified native failure on the Remote wire', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    await installModel(harness)
    native.getResult.mockImplementationOnce(() => { throw new Error(harness.root + ' private-native-diagnostic') })
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toEqual({ ok: false, error: {
        code: 'voice/operation-failed',
        message: 'Voice operation failed; check the local engine and model files',
        details: { code: 'VOICE_OPERATION_FAILED' },
      } })
    expect(native.getResult).toHaveBeenCalledOnce()
  })

  it('rejects missing and tampered HTTP cookies before native work and accepts Connection authentication', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness(true)
    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    for (const credentials of [undefined, cookie + 'tampered']) {
      const refused = await harness.http('engineStatus', {}, credentials)
      expect(refused.status).toBe(401)
      expect(await refused.text()).toBe('unauthorized')
    }
    expect(native.load).not.toHaveBeenCalled()
    const admitted = await remoteResult(await harness.http('engineStatus', {}, cookie))
    expect(admitted).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
  })

  it('returns the same roster, engine status, and recognition from desktop and optional HTTP adapters', async () => {
    nativeRecognizer('same local result')
    const harness = await createHarness(true)
    await installModel(harness)
    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    const request = { modelId: MODEL_ID, pcm16kMonoBase64: PCM }
    for (const [remote, legacy, args, payload] of [
      ['engineStatus', 'engine.status', {}, {}],
      ['modelsList', 'models.list', {}, {}],
      ['transcribe', 'transcribe', { request }, request],
    ] as const) {
      const expected = await remoteResult(await harness.remote(remote, args))
      expect(await remoteResult(await harness.http(remote, args, cookie))).toEqual(expected)
      const response = await harness.legacy(legacy, payload)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expected)
    }
    const invalid = await harness.legacy('transcribe', { modelId: MODEL_ID, pcm16kMonoBase64: 'not base64' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('keeps an admitted download running after desktop transport cancellation', async () => {
    const harness = await createHarness()
    const hold = harness.fixture.hold()
    const caller = new AbortController()
    const receipt = await task(harness, 'modelsDownload', caller.signal)
    expect(receipt.state).toBe('running')
    const response = await hold.entered
    caller.abort(new DOMException('desktop disconnected', 'AbortError'))
    const running = await fixtureRow(harness)
    expect(running.task).toMatchObject({ taskId: receipt.taskId, state: 'running' })
    expect(response.destroyed).toBe(false)
    hold.release()
    const ready = await terminalTask(harness, receipt.taskId)
    expect(ready.task?.state).toBe('succeeded')
    expect(ready.resource.integrity).toBe('verified')
    if (ready.status.state !== 'ready') throw new Error('download did not publish')
    expect(await readFile(join(ready.status.cacheDir, 'encoder.onnx'))).toEqual(harness.fixture.files.get('encoder.onnx'))
  })

  it('cancels only the exact task and joins the transfer before admitting a replacement', async () => {
    const harness = await createHarness()
    const hold = harness.fixture.hold()
    const receipt = await task(harness)
    await hold.entered
    expect((await task(harness)).taskId).toBe(receipt.taskId)
    expect(harness.fixture.requests).toHaveLength(1)
    expect(await remoteResult(await harness.remote('modelsCancel', { request: { modelId: MODEL_ID, taskId: randomUUID() } })))
      .toEqual({ ok: true, value: { cancelled: false } })
    expect((await fixtureRow(harness)).task?.state).toBe('running')
    expect(await remoteResult(await harness.remote('modelsCancel', { request: { modelId: MODEL_ID, taskId: receipt.taskId } })))
      .toEqual({ ok: true, value: { cancelled: true } })
    await hold.closed
    expect((await fixtureRow(harness)).task).toMatchObject({ taskId: receipt.taskId, state: 'cancelled' })
    expect((await fixtureRow(harness)).resource.integrity).toBe('missing')
    expect(await readdir(join(harness.cacheRoot, '.tasks'))).toEqual([])
    const next = await task(harness)
    expect(next.taskId).not.toBe(receipt.taskId)
    expect(await remoteResult(await harness.remote('modelsCancel', { request: { modelId: MODEL_ID, taskId: receipt.taskId } })))
      .toEqual({ ok: true, value: { cancelled: false } })
    expect((await terminalTask(harness, next.taskId)).task?.state).toBe('succeeded')
  })

  it('preserves the installed generation during replacement and after transfer failure', async () => {
    const native = nativeRecognizer('old generation works')
    const harness = await createHarness()
    const cacheDir = await installModel(harness)
    const installed = await fixtureRow(harness)
    const hold = harness.fixture.hold()
    const receipt = await task(harness, 'modelsReinstall')
    await hold.entered
    expect((await fixtureRow(harness)).status).toEqual({ state: 'ready', cacheDir })
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } })))
      .toEqual({ ok: true, value: { text: 'old generation works' } })
    harness.fixture.fail()
    hold.release()
    const failed = await terminalTask(harness, receipt.taskId)
    expect(failed.task).toMatchObject({ state: 'failed', operation: 'reinstall' })
    expect(failed.task?.error?.code).toEqual(expect.any(String))
    expect(failed.task?.error?.message).toEqual(expect.any(String))
    expect(failed.status).toEqual({ state: 'ready', cacheDir })
    expect(failed.resource).toEqual(installed.resource)
    expect(await readFile(join(cacheDir, 'tokens.txt'))).toEqual(harness.fixture.files.get('tokens.txt'))
    expect(native.construct).toHaveBeenCalledOnce()
  })

  it('publishes a fresh generation after a successful reinstall', async () => {
    const harness = await createHarness()
    const oldDirectory = await installModel(harness)
    const before = await fixtureRow(harness)
    const receipt = await task(harness, 'modelsReinstall')
    const after = await terminalTask(harness, receipt.taskId)
    expect(after.task).toMatchObject({ operation: 'reinstall', state: 'succeeded' })
    expect(after.resource.integrity).toBe('verified')
    expect(after.resource.installedVersion).toBe(before.resource.installedVersion)
    expect(after.resource.revision).not.toBe(before.resource.revision)
    if (after.status.state !== 'ready') throw new Error('replacement was not committed')
    expect(after.status.cacheDir).not.toBe(oldDirectory)
    expect(await readFile(join(after.status.cacheDir, 'tokens.txt'))).toEqual(harness.fixture.files.get('tokens.txt'))
    await expect(access(oldDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('updates an unchanged manifest without replacing verified files', async () => {
    const harness = await createHarness()
    await installModel(harness)
    const before = await fixtureRow(harness)
    const count = harness.fixture.requests.length
    const receipt = await task(harness, 'modelsUpdate')
    const after = await terminalTask(harness, receipt.taskId)
    expect(after.task).toMatchObject({ operation: 'update', state: 'succeeded' })
    expect(after.resource).toEqual(before.resource)
    expect(after.status).toEqual(before.status)
    expect(harness.fixture.requests).toHaveLength(count)
  })

  it('advertises and installs a changed pinned manifest through a reloaded catalog row', async () => {
    const harness = await createHarness()
    await installModel(harness)
    const before = await fixtureRow(harness)
    const definition = harness.fixture.definition
    if (definition.download.type !== 'files') throw new Error('expected pinned files')
    const tokens = Buffer.from('new pinned vocabulary')
    harness.fixture.files.set('tokens.txt', tokens)
    harness.fixture.definition = {
      ...definition,
      download: { type: 'files', entries: definition.download.entries.map(entry => entry.name === 'tokens.txt'
        ? { ...entry, bytes: tokens.byteLength, sha256: createHash('sha256').update(tokens).digest('hex') } : entry) },
    }
    await harness.setEnabled(FIXTURE_PLUGIN, false)
    await harness.setEnabled(FIXTURE_PLUGIN, true)
    const available = await fixtureRow(harness)
    expect(available.resource.installedVersion).toBe(before.resource.installedVersion)
    expect(available.resource.availableVersion).not.toBe(before.resource.availableVersion)
    expect(available.resource.updateAvailable).toBe(true)
    expect(available.status).toEqual(before.status)
    const receipt = await task(harness, 'modelsUpdate')
    const updated = await terminalTask(harness, receipt.taskId)
    expect(updated.task?.state).toBe('succeeded')
    expect(updated.resource.installedVersion).toBe(available.resource.availableVersion)
    expect(updated.resource.updateAvailable).toBe(false)
    if (updated.status.state !== 'ready') throw new Error('updated model not ready')
    expect(await readFile(join(updated.status.cacheDir, 'tokens.txt'))).toEqual(tokens)
  })

  it('keeps tasks Host-local while two Loader Hosts share committed resources', async () => {
    const first = await createHarness()
    const second = await createHarness(false, { cacheRoot: first.cacheRoot, fixture: first.fixture })
    const hold = first.fixture.hold()
    const receipt = await task(first)
    await hold.entered
    expect((await fixtureRow(second)).task).toBeNull()
    expect(await remoteResult(await second.remote('modelsCancel', { request: { modelId: MODEL_ID, taskId: receipt.taskId } })))
      .toEqual({ ok: true, value: { cancelled: false } })
    hold.release()
    const committed = await terminalTask(first, receipt.taskId)
    const observed = await fixtureRow(second)
    expect(observed.status).toEqual(committed.status)
    expect(observed.resource).toEqual(committed.resource)
    expect(observed.task).toBeNull()
  })

  it('keeps a second Host removal authoritative over an already admitted download', async () => {
    const first = await createHarness()
    const second = await createHarness(false, { cacheRoot: first.cacheRoot, fixture: first.fixture })
    const hold = first.fixture.hold()
    const receipt = await task(first)
    await hold.entered
    expect(await remoteResult(await second.remote('modelsRemove', { request: { modelId: MODEL_ID } })))
      .toEqual({ ok: true, value: {} })
    const removed = await fixtureRow(second)
    expect(removed.resource.revision).not.toBe('0')
    hold.release()
    const refused = await terminalTask(first, receipt.taskId)
    expect(refused.task).toMatchObject({ state: 'failed', error: { code: 'VOICE_RESOURCE_CONFLICT' } })
    expect(refused.resource.revision).toBe(removed.resource.revision)
    expect(refused.resource.integrity).toBe('missing')
    expect((await fixtureRow(second)).resource).toEqual(removed.resource)
  })

  it('joins provider cancellation, withdraws its routes and reloads catalog contributions once', async () => {
    const harness = await createHarness(true)
    const hold = harness.fixture.hold()
    await task(harness)
    await hold.entered
    await harness.setEnabled(PROVIDER, false)
    await hold.closed
    expect(await remoteResult(await harness.remote('modelsList'))).toMatchObject({
      ok: false, error: { code: 'voice/unavailable', details: { code: 'VOICE_UNAVAILABLE' } },
    })
    expect(harness.ctx.voice.listDefinitions().map(model => model.id)).toEqual([MODEL_ID])
    expect(harness.ctx.voice.engineOrUndefined).toBeUndefined()
    const absent = await harness.legacy('models.list')
    expect(absent.status).toBe(404)
    await absent.text()
    await harness.setEnabled(PROVIDER, true)
    expect((await models(harness)).map(model => model.definition.id).sort()).toEqual([...ROSTER].sort())
    expect((await fixtureRow(harness)).task).toBeNull()
    expect((await fixtureRow(harness)).resource.integrity).toBe('missing')
    await harness.setEnabled(FIXTURE_PLUGIN, false)
    expect(harness.ctx.voice.listDefinitions().some(model => model.id === MODEL_ID)).toBe(false)
  })

  it('withdraws the controller endpoint and reattaches it once through the Loader', async () => {
    const native = nativeRecognizer()
    const harness = await createHarness()
    await harness.setEnabled(CONTROLLER, false)
    expect(harness.ctx.get('voiceController')).toBeUndefined()
    const absent = await harness.remote('engineStatus')
    expect(absent.status).toBe(404)
    await absent.text()
    expect(native.load).not.toHaveBeenCalled()
    await harness.setEnabled(CONTROLLER, true)
    expect(await remoteResult(await harness.remote('engineStatus'))).toEqual({ ok: true, value: { ok: true } })
    expect(native.load).toHaveBeenCalledOnce()
  })
})
