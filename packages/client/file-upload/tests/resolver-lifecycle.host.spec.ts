import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import FileUploads from '../src/index.ts'

/** Mount the host service with the small dependency face its constructor uses. */
async function mount(): Promise<{ ctx: Context; uploads: FileUploads }> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  ctx.provide('agents', { get: () => undefined } as never)
  ctx.provide('attachments', {} as never)
  ctx.provide('commands', { registerFileReceiptResolver: () => () => {} } as never)
  ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
  await ctx.plugin(FileUploads)
  const uploads = ctx.get('fileUploads')
  if (uploads === undefined) throw new Error('file upload service did not load')
  return { ctx, uploads }
}

describe('FileUploads resolver lifecycle', () => {
  it('allows a new resolver after the previous Cordis-proxied registration disposes', async () => {
    const { uploads } = await mount()
    const dispose = uploads.registerAgentResolver(async () => ({}) as never)
    dispose()
    expect(() => uploads.registerAgentResolver(async () => ({}) as never)).not.toThrow()
  })
})
