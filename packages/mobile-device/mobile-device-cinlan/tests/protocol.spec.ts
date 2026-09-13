import { describe, expect, it } from 'vitest'
import {
  parseAcknowledgement,
  parseCinlanMobileEnvelope,
  parseDevices,
  parseObservation,
} from '../src/protocol.ts'

function png(width = 1, height = 1): string {
  const data = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data)
  data.write('IHDR', 12, 'ascii')
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  return data.toString('base64')
}

function device(overrides: Record<string, unknown> = {}) {
  return {
    backend: 'android', id: 'device-1', name: 'Pixel', state: 'booted', isAvailable: true,
    ...overrides,
  }
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    device: device(),
    deviceGeneration: 'generation-1',
    observationId: 'observation-1',
    coordinateSpace: 'normalized',
    tree: 'button Continue',
    screenshotStatus: { state: 'skipped' },
    ...overrides,
  }
}

describe('Cinlan Mobile Device envelope parser', () => {
  it('parses exact success and failure envelopes', () => {
    expect(parseCinlanMobileEnvelope(JSON.stringify({
      id: '1', ok: true, result: { value: 1 }, _meta: { runtimeId: 'runtime' },
    }))).toEqual({ ok: true, result: { value: 1 }, runtimeId: 'runtime' })
    expect(parseCinlanMobileEnvelope(JSON.stringify({
      id: '1', ok: false,
      error: { code: 'failed', message: 'no', data: { nextSteps: ['retry'] } },
      _meta: { runtimeId: 'runtime' },
    }))).toEqual({
      ok: false, error: { code: 'failed', message: 'no', nextSteps: ['retry'] }, runtimeId: 'runtime',
    })
    expect(parseCinlanMobileEnvelope(JSON.stringify({
      id: '1', ok: false, error: { code: 'failed', message: 'no' }, _meta: { runtimeId: 'runtime' },
    }))).toMatchObject({ ok: false, error: { nextSteps: [] } })
    expect(parseCinlanMobileEnvelope(JSON.stringify({
      id: '1', ok: false, error: { code: 'failed', message: 'no', data: {} }, _meta: { runtimeId: 'runtime' },
    }))).toMatchObject({ ok: false, error: { nextSteps: [] } })
  })

  it.each([
    ['not json'],
    [JSON.stringify([])],
    [JSON.stringify({ id: '', ok: true, result: {}, _meta: { runtimeId: 'r' } })],
    [JSON.stringify({ id: '1', ok: 'yes', result: {}, _meta: { runtimeId: 'r' } })],
    [JSON.stringify({ id: '1', ok: true, result: {}, _meta: { runtimeId: '' } })],
    [JSON.stringify({ id: '1', ok: true, _meta: { runtimeId: 'r' } })],
    [JSON.stringify({ id: '1', ok: true, result: {}, extra: true, _meta: { runtimeId: 'r' } })],
    [JSON.stringify({ id: '1', ok: false, error: { code: '', message: 'm' }, _meta: { runtimeId: 'r' } })],
    [JSON.stringify({ id: '1', ok: false, error: { code: 'c', message: 'm', data: { nextSteps: [1] } }, _meta: { runtimeId: 'r' } })],
    [JSON.stringify({ id: '1', ok: false, error: { code: 'c', message: 'm', data: { extra: true } }, _meta: { runtimeId: 'r' } })],
  ])('rejects hostile envelope %j', (value) => {
    expect(() => parseCinlanMobileEnvelope(value)).toThrow(/mobile-device-cinlan/)
  })
})

describe('Cinlan Mobile Device result parsers', () => {
  it('parses canonical devices, observations, screenshots, and acknowledgements', () => {
    expect(parseDevices([device({ detail: 'API 35' })]))
      .toEqual([{ ...device(), detail: 'API 35' }])
    expect(parseObservation(observation(), 1024, 1024)).toMatchObject({
      device: { id: 'device-1' }, observationId: 'observation-1', screenshotStatus: { state: 'skipped' },
    })
    expect(parseObservation(observation({
      screenshot: { mediaType: 'image/png', dataBase64: png(2, 3), width: 2, height: 3 },
      screenshotStatus: { state: 'captured' },
    }), 1024, 1024)).toMatchObject({ screenshot: { width: 2, height: 3 } })
    expect(parseObservation(observation({
      screenshotStatus: { state: 'failed', code: 'emulator_screenshot_failed', message: 'unavailable' },
    }), 1024, 1024)).toMatchObject({ screenshotStatus: { state: 'failed' } })
    expect(parseAcknowledgement({ ok: true })).toEqual({ ok: true })
  })

  it.each([
    [{ protocolVersion: 1, devices: [] }],
    [[device(), device()]],
    [[device({ id: '' })]],
    [[device({ backend: 'web' })]],
    [[device({ state: 'online' })]],
    [[device({ isAvailable: 'yes' })]],
    [[device({ detail: '' })]],
    [[device({ extra: true })]],
  ])('rejects hostile device result %j', (value) => {
    expect(() => parseDevices(value)).toThrow()
  })

  it.each([
    [{}],
    [{ ok: false }],
    [{ ok: true, extra: true }],
    [[]],
  ])('rejects hostile mutation acknowledgement %j', (value) => {
    expect(() => parseAcknowledgement(value)).toThrow()
  })

  it.each([
    [observation({ protocolVersion: 2 }), 1024, 1024],
    [observation({ coordinateSpace: 'pixels' }), 1024, 1024],
    [observation({ tree: 'long' }), 3, 1024],
    [observation({ screenshotStatus: { state: 'unknown' } }), 1024, 1024],
    [observation({ screenshotStatus: { state: 'skipped', reason: 'not_requested' } }), 1024, 1024],
    [observation({ screenshotStatus: { state: 'failed', code: 'capture_failed', message: 'no' } }), 1024, 1024],
    [observation({ screenshotStatus: { state: 'captured' } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/jpeg', dataBase64: png(), width: 1, height: 1 } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 1, dataBase64: png(), width: 1, height: 1 } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/png', dataBase64: '!!!', width: 1, height: 1 } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/png', dataBase64: Buffer.alloc(8).toString('base64'), width: 1, height: 1 } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/png', dataBase64: Buffer.alloc(24).toString('base64'), width: 1, height: 1 } }), 1024, 1024],
    [observation({ screenshot: {
      mediaType: 'image/png',
      dataBase64: (() => {
        const data = Buffer.from(png(), 'base64')
        data.write('NOPE', 12, 'ascii')
        return data.toString('base64')
      })(),
      width: 1,
      height: 1,
    } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/png', dataBase64: png(), width: 0, height: 1 } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/png', dataBase64: png(2, 1), width: 1, height: 1 } }), 1024, 1024],
    [observation({ screenshot: { mediaType: 'image/png', dataBase64: png(), width: 1, height: 1 } }), 1024, 4],
  ])('rejects hostile observation %#', (value, treeLimit, imageLimit) => {
    expect(() => parseObservation(value, treeLimit, imageLimit)).toThrow()
  })

  it('accepts canonical PNG base64 with two padding characters', () => {
    const data = Buffer.alloc(25)
    Buffer.from(png(), 'base64').copy(data)
    expect(parseObservation(observation({
      screenshot: { mediaType: 'image/png', dataBase64: data.toString('base64'), width: 1, height: 1 },
      screenshotStatus: { state: 'captured' },
    }), 1024, 1024)).toMatchObject({ screenshot: { width: 1, height: 1 } })
  })
})
