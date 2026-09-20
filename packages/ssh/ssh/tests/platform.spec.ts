/** A Windows host must refuse SSH before spawning a transport or reading credentials. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SshConnection } from '../src/index.ts'

const transport = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }))
vi.mock('node:child_process', () => transport)

describe.skipIf(process.platform !== 'win32')('SSH client platform admission', () => {
  it('rejects a Windows client before starting OpenSSH', async () => {
    const ctx = new Context()
    try {
      expect(() => new SshConnection(ctx, {
        host: 'mock-host', node: '/remote/node', helper: '/remote/helper.js',
        helperHash: 'a'.repeat(64), workspace: '/remote/workspace',
      })).toThrow('SSH runtime requires a POSIX client')
      expect(transport.spawn).not.toHaveBeenCalled()
      expect(transport.execFile).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
})
