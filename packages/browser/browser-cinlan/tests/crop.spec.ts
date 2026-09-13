import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { boundedElementRect, cropElementScreenshot } from '../src/crop.ts'

describe('Cinlan element crop', () => {
  const viewport = { width: 4, height: 3 }
  const rect = { x: 1, y: 1, width: 2, height: 1 }

  it('clips visible CSS bounds and admits the exact pixel budget', () => {
    expect(boundedElementRect({ x: -1, y: -2, width: 5, height: 5 }, viewport, 12))
      .toEqual({ x: 0, y: 0, width: 4, height: 3 })
    expect(() => boundedElementRect({ x: 0, y: 0, width: 4, height: 3 }, viewport, 11))
      .toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_BOUNDS' }))
  })

  it.each([
    { x: 4, y: 0, width: 1, height: 1 },
    { x: 0, y: -2, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: Number.NaN, y: 0, width: 1, height: 1 },
  ])('rejects invisible or non-finite rectangles: %j', (invalid) => {
    expect(() => boundedElementRect(invalid, viewport, 12))
      .toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_BOUNDS' }))
  })

  it.each(['png', 'jpeg'] as const)('scales CSS bounds to device pixels for %s', async (format) => {
    const data = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#123456' } })
      .toFormat(format).toBuffer()
    const crop = await cropElementScreenshot(data, format, rect, viewport, 4_096)
    expect(await sharp(crop).metadata()).toMatchObject({ format, width: 4, height: 2 })
    expect(await cropElementScreenshot(data, format, rect, viewport, crop.byteLength)).toEqual(crop)
    await expect(cropElementScreenshot(data, format, rect, viewport, crop.byteLength - 1))
      .rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CAPTURE_TOO_LARGE' })
  })

  it('extracts pixels from the selected origin instead of the viewport origin', async () => {
    const source = Uint8Array.from({ length: 8 * 6 * 3 }, (_, i) => i % 251)
    const data = await sharp(source, { raw: { width: 8, height: 6, channels: 3 } }).png().toBuffer()
    const crop = await cropElementScreenshot(data, 'png', rect, viewport, 4_096)
    const pixels = await sharp(crop).removeAlpha().raw().toBuffer()
    const expected = Buffer.concat([source.slice((2 * 8 + 2) * 3, (2 * 8 + 6) * 3), source.slice((3 * 8 + 2) * 3, (3 * 8 + 6) * 3)])
    expect(pixels).toEqual(expected)
  })

  it.each([new Uint8Array(), Uint8Array.of(1, 2, 3)])('maps constructor and decoder failures to BrowserError', async (data) => {
    await expect(cropElementScreenshot(data, 'png', rect, viewport, 4_096))
      .rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CAPTURE_FAILED', cause: expect.any(Error) })
  })

  it('rejects an image whose actual encoding differs from the response format', async () => {
    const data = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#123456' } }).jpeg().toBuffer()
    await expect(cropElementScreenshot(data, 'png', rect, viewport, 4_096))
      .rejects.toMatchObject({ code: 'BROWSER_CINLAN_PROTOCOL' })
  })
})
