/** Native Android wire parsers reject malformed outputs without exposing device payloads. */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { MobileDeviceError } from '@deepseek-ai/dsh-mobile-device'
import { parseActivity, parseBootId, parseDevices, parseDisplaySize, parseHierarchy, parseScreenshot } from '../src/protocol.ts'

function protocolFailure(action: () => unknown) {
  expect(action).toThrow(MobileDeviceError)
  expect(action).toThrow(expect.objectContaining({ code: 'MOBILE_ADB_PROTOCOL', message: 'The Android device returned invalid protocol data.' }))
}
const header = 'List of devices attached\n'

describe('ADB inventory', () => {
  it('retains offline and unauthorized records while requiring a verified transport for available devices', () => {
    expect(parseDevices(header + [
      'emulator-5554 device product:sdk model:Pixel_9 device:emu transport_id:1',
      'abc123 unauthorized transport_id:2', '192.0.2.1:5555 offline', 'usb-connected device',
    ].join('\n'))).toEqual([
      { serial: 'emulator-5554', transportId: '1', device: { id: 'android:emulator-5554', backend: 'android', name: 'Pixel 9', state: 'device', isAvailable: true } },
      { serial: 'abc123', transportId: '2', device: { id: 'android:abc123', backend: 'android', name: 'abc123', state: 'unauthorized', isAvailable: false } },
      { serial: '192.0.2.1:5555', transportId: null, device: { id: 'android:192.0.2.1:5555', backend: 'android', name: '192.0.2.1:5555', state: 'offline', isAvailable: false } },
      { serial: 'usb-connected', transportId: null, device: { id: 'android:usb-connected', backend: 'android', name: 'usb-connected', state: 'device', isAvailable: false } },
    ])
  })

  it('supports empty rosters, CRLF, tabs, and non-operational ADB states', () => {
    expect(parseDevices('List of devices attached\r\n\r\n')).toEqual([])
    for (const state of ['recovery', 'sideload', 'bootloader', 'authorizing', 'connecting']) {
      expect(parseDevices('List of devices attached\r\nserial\t' + state + ' transport_id:1\r\n')[0]?.device.isAvailable).toBe(false)
    }
  })

  it.each(['', 'adb version 1.0.41', '* daemon started successfully *\n' + header, header + 'serial', header + 'serial connected'])('rejects malformed inventory %j', (text) => {
    protocolFailure(() => parseDevices(text))
  })

  it.each(['-s', 'abc;id', 'abc&echo', 'abc|cmd', 'abc$HOME', 'abc$(id)', 'abc\u0000', 'abc\u001b[31m', 'abc/../../device', 'abc\\device', 'abc"', "abc'"])(
    'rejects unsafe serial %j', (serial) => { protocolFailure(() => parseDevices(header + serial + ' device transport_id:1')) },
  )

  it.each(['0', '-1', '01', '1.5', '1e2', '9007199254740992', 'abc', '1:2'])('rejects malformed transport id %s', (transport) => {
    protocolFailure(() => parseDevices(header + 'serial device transport_id:' + transport))
  })

  it.each([
    'serial device transport_id:1\nserial offline transport_id:2',
    'serial device transport_id:1\nother device transport_id:1',
    'serial device transport_id:1 transport_id:2',
    'serial device arbitrary-payload',
  ])('rejects duplicate or ambiguous inventory %j', (text) => { protocolFailure(() => parseDevices(header + text)) })
})

describe('UI Automator hierarchy', () => {
  it.each([0, 1, 2, 3] as const)('preserves raw XML and extracts rotation %s', (rotation) => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="' + String(rotation) + '"><node text="a &amp; b" bounds="[0,0][100,200]" /></hierarchy>\n'
    expect(parseHierarchy(xml)).toEqual({ tree: xml, rotation })
  })

  it.each([
    '', '<hierarchy rotation="0"><node></hierarchy>', '<hierarchy rotation="0">',
    '<other rotation="0"/>', '<hierarchy/>', '<hierarchy rotation="4"/>', '<hierarchy rotation="-1"/>',
    '<hierarchy rotation="01"/>', '<hierarchy rotation="0" rotation="1"/>',
    '<hierarchy rotation="0"/><hierarchy rotation="1"/>', '<hierarchy rotation="0"/><other/>',
    '<?xml version="2.0"?><hierarchy rotation="0"/>', '<?xml version="1.1"?><hierarchy rotation="0"/>',
    '<!DOCTYPE hierarchy SYSTEM "file:///private-secret"><hierarchy rotation="0"/>',
    '<!DOCTYPE hierarchy [<!ENTITY external SYSTEM "https://private.invalid/secret">]><hierarchy rotation="0">&external;</hierarchy>',
    '<hierarchy rotation="0"><node text="secret\u0000"/></hierarchy>',
    'UI hierarchy dumped to: /data/local/tmp/tree.xml',
  ])('rejects malformed or unsupported hierarchy %j', (xml) => { protocolFailure(() => parseHierarchy(xml)) })
})

describe('Display dimensions and device generation', () => {
  it.each([0, 1, 2, 3])('prefers display override and applies rotation %s', (rotation) => {
    expect(parseDisplaySize('Physical size: 1080x2400\r\nOverride size: 720x1600\r\n', rotation)).toEqual(
      rotation % 2 ? { width: 1600, height: 720 } : { width: 720, height: 1600 },
    )
    expect(parseDisplaySize('Physical size: 1080x2400\n', rotation)).toEqual(
      rotation % 2 ? { width: 2400, height: 1080 } : { width: 1080, height: 2400 },
    )
  })

  it.each(['', 'Override size: 720x1600', 'Physical size: 0x100', 'Physical size: -1x100',
    'Physical size: 1.5x100', 'Physical size: 9007199254740992x100', 'Physical size: 100x100\nPhysical size: 200x200',
    'Physical size: 100x100\nOverride size: 80x80\nOverride size: 70x70', 'Physical size: 100x100\nprivate output'])('rejects unsafe display output %j', (text) => {
    protocolFailure(() => parseDisplaySize(text, 0))
  })
  it.each([-1, 4, 0.5, NaN, Infinity])('rejects invalid rotation %s', (rotation) => {
    protocolFailure(() => parseDisplaySize('Physical size: 100x200', rotation))
  })

  it('normalizes a boot UUID without accepting multiple records or trailing payloads', () => {
    const id = '12345678-ABCD-4567-89AB-0123456789AB'
    expect(parseBootId(id + '\n')).toBe(id.toLowerCase())
    for (const text of ['', 'not-a-uuid', id + '\n' + id, id + ' secret', id.replace('A', 'Z')]) protocolFailure(() => parseBootId(text))
  })
})

describe('Current Android activity', () => {
  it('extracts version-specific resumed fields and prefers top resumed activity', () => {
    expect(parseActivity('  mResumedActivity: ActivityRecord{ab12 u0 com.example/.MainActivity t4}\nprivate history')).toBe('com.example/.MainActivity')
    expect(parseActivity('topResumedActivity=ActivityRecord{abc u0 com.new/com.new.Main t8}\n mResumedActivity: ActivityRecord{ab u0 com.old/.Old t4}')).toBe('com.new/com.new.Main')
  })
  it('returns explicit unknown for absent, malformed or ambiguous current activities', () => {
    for (const text of ['', 'mResumedActivity: null', 'arbitrary secret full dump',
      'mResumedActivity: ActivityRecord{ab u0 com.evil/.Main;secret t4}',
      'topResumedActivity=ActivityRecord{ab u0 com.one/.Main t4}\ntopResumedActivity=ActivityRecord{bc u0 com.two/.Other t5}']) {
      expect(parseActivity(text)).toBe('unknown')
    }
  })
})

async function png() {
  return sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()
}
const imageFailure = { code: 'MOBILE_IMAGE_INVALID', message: 'The Android device returned an invalid PNG screenshot.' }

describe('Screenshot decoding', () => {
  it('fully decodes a PNG, preserves its exact byte array, and accepts the pixel boundary', async () => {
    const data = await png()
    const result = await parseScreenshot(data, 6)
    expect(result).toMatchObject({ mediaType: 'image/png', width: 3, height: 2 })
    expect(result.data).toBe(data)
    await expect(parseScreenshot(data, 5)).rejects.toMatchObject(imageFailure)
  })
  it('rejects other image formats even when they decode successfully', async () => {
    const jpeg = await sharp(await png()).jpeg().toBuffer()
    await expect(parseScreenshot(jpeg, 100)).rejects.toMatchObject(imageFailure)
  })
  it('rejects malformed and truncated PNG data without exposing decoder diagnostics', async () => {
    const valid = await png()
    for (const data of [new Uint8Array(), new TextEncoder().encode('private payload'), valid.subarray(0, 16), valid.subarray(0, Math.floor(valid.length / 2)), valid.subarray(0, valid.length - 12)]) {
      await expect(parseScreenshot(data, 100)).rejects.toMatchObject(imageFailure)
    }
    const corrupt = Uint8Array.from(valid)
    corrupt[40] = corrupt[40]! ^ 255
    await expect(parseScreenshot(corrupt, 100)).rejects.toMatchObject(imageFailure)
  })
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid pixel limit %s', async (limit) => {
    await expect(parseScreenshot(await png(), limit)).rejects.toMatchObject(imageFailure)
  })
})
