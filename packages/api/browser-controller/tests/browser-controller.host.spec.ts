/** Cookie file parsing rejects invalid input before calling the native Provider. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import BrowserController from '../src/index.ts'
const roots: Context[] = []
function fixture() {
  const ctx = new Context(); roots.push(ctx)
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  const importCookies = vi.fn(async () => ({ imported: 1 }))
  ctx.provide('browser', { currentProfile: () => 'default', importCookies } as never)
  return { controller: new BrowserController(ctx), importCookies, signal: new AbortController().signal }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose())) })
it('parses an explicit cookie array and returns only count and profile', async () => {
  const b = fixture()
  const value = [{ name: 'fixture', value: 'not-a-real-cookie', domain: 'example.test' }]
  const extendedReceipt = { imported: 1, value: 'must-not-leave-provider' }
  b.importCookies.mockResolvedValueOnce(extendedReceipt)
  const receipt = await b.controller.importCookies({ profileName: 'default', json: JSON.stringify(value) }, b.signal)
  expect(receipt).toEqual({ imported: 1, profileName: 'default' })
  expect(b.importCookies).toHaveBeenCalledWith({ profileName: 'default', cookies: value }, b.signal)
})
it('rejects empty, malformed, oversized, and unknown-field JSON before provider access', async () => {
  const b = fixture()
  for (const json of ['{invalid', '[]', '{}', 'x'.repeat(262145), JSON.stringify([{ name: 'fixture', value: 'fixture', domain: 'example.test', unknown: true }])]) {
    await expect(b.controller.importCookies({ profileName: 'default', json }, b.signal)).rejects.toMatchObject({ code: 'browser/invalid-request' })
  }
  expect(b.importCookies).not.toHaveBeenCalled()
})
it('masks native cookie errors and respects pre-admission cancellation', async () => {
  const b = fixture(), json = '[{"name":"fixture","value":"fixture","domain":"example.test"}]'
  b.importCookies.mockRejectedValueOnce(new Error('native implementation detail'))
  await expect(b.controller.importCookies({ profileName: 'default', json }, b.signal)).rejects.toMatchObject({ code: 'browser/operation-failed', message: 'Cookie import failed; refresh the active profile and check the file' })
  const aborted = new AbortController(); aborted.abort(new Error('cancelled'))
  await expect(b.controller.importCookies({ profileName: 'default', json }, aborted.signal)).rejects.toThrow('cancelled')
  expect(b.importCookies).toHaveBeenCalledTimes(1)
})

it('refuses upload decoding beyond the configured limit and invalid base64', async () => {
  const ctx = new Context(); roots.push(ctx)
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  const upload = vi.fn(async () => {})
  ctx.provide('browser', { upload } as never)
  const controller = new BrowserController(ctx, { maxFileBytes: 4 })
  const request = { pageId: 'page' as never, observationId: 'observation' as never, elementId: 'element' as never, name: 'fixture.bin' }
  for (const base64 of ['not base64', Buffer.from('12345').toString('base64')]) {
    await expect(controller.upload({ ...request, base64 }, new AbortController().signal)).rejects.toMatchObject({ code: 'browser/invalid-request' })
  }
  expect(upload).not.toHaveBeenCalled()
  expect(await controller.upload({ ...request, base64: Buffer.from('1234').toString('base64') }, new AbortController().signal)).toEqual({ bytes: 4 })
})
