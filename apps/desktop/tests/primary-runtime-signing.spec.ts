import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { signWindowsPrimaryRuntime, windowsRuntimeCode } from '../scripts/sign-primary-runtime.ts'

const inspection = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>())
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const execFile = vi.fn()
  Object.defineProperty(execFile, promisify.custom, { value: inspection })
  return { ...actual, execFile }
})

let root: string
const pe = Buffer.alloc(68)
pe.writeUInt16LE(0x5a4d, 0)
pe.writeUInt32LE(64, 60)
pe.writeUInt32LE(0x4550, 64)
const valid = { status: 'Valid', timestamped: true, thumbprint: 'A'.repeat(40) }
const unsigned = { status: 'NotSigned', timestamped: false, thumbprint: null }

beforeEach(async () => {
  inspection.mockReset()
  root = await mkdtemp(join(tmpdir(), 'desktop-runtime-signing-'))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('discovers Python, Node, DLLs and native addons without selecting foreign code or data', async () => {
  await mkdir(join(root, 'nested'))
  for (const name of ['python.exe', 'node.exe', 'native.DLL', 'extension.pyd', 'addon.node']) {
    await writeFile(join(root, 'nested', name), pe)
  }
  await writeFile(join(root, 'foreign.node'), Buffer.from('cffaedfe', 'hex'))
  await writeFile(join(root, 'README.txt'), pe)
  expect((await windowsRuntimeCode(root)).map(path => basename(path))).toEqual(['addon.node', 'extension.pyd', 'native.DLL', 'node.exe', 'python.exe'])
})

it.each(['broken.exe', 'broken.dll', 'broken.pyd', 'broken.node'])('rejects malformed PE headers in %s', async (name) => {
  await writeFile(join(root, name), Buffer.from('MZtruncated'))
  await expect(windowsRuntimeCode(root)).rejects.toThrow('invalid PE file')
})

it('rejects directory links without following their target', async () => {
  await mkdir(join(root, 'real'))
  await symlink(join(root, 'real'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(windowsRuntimeCode(root)).rejects.toThrow('directory links are not signable')
})

it('preserves vendor bytes, checks all code before signing and smokes only after verification', async () => {
  await writeFile(join(root, 'node.exe'), pe)
  await writeFile(join(root, 'python.exe'), pe)
  const signed = new Set<string>()
  const events: string[] = []
  const inspect = async (path: string) => {
    events.push('inspect:' + basename(path))
    return basename(path) === 'node.exe' || signed.has(path) ? valid : unsigned
  }
  await signWindowsPrimaryRuntime(root, {
    thumbprint: valid.thumbprint.toLowerCase(), inspect,
    sign: async ({ path, hash, isNest }) => {
      events.push('sign:' + basename(path))
      expect(hash).toBe('sha256')
      expect(isNest).toBe(false)
      signed.add(path)
      await writeFile(path, Buffer.concat([pe, Buffer.from('signature')]))
    },
    smoke: (path) => { expect(path).toBe(root); events.push('smoke') },
  })
  expect(events).toEqual(['inspect:node.exe', 'inspect:python.exe', 'sign:python.exe', 'inspect:python.exe', 'smoke'])
  expect(await readFile(join(root, 'node.exe'))).toEqual(pe)
  expect(await readFile(join(root, 'python.exe'))).not.toEqual(pe)
})

it('refuses untrusted signatures before touching the private key', async () => {
  await writeFile(join(root, 'a.exe'), pe)
  await writeFile(join(root, 'z.dll'), pe)
  const sign = vi.fn(), smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, {
    thumbprint: valid.thumbprint, sign, smoke,
    inspect: async path => basename(path) === 'a.exe' ? unsigned : { ...valid, status: 'HashMismatch' },
  })).rejects.toThrow('refusing HashMismatch')
  expect(sign).not.toHaveBeenCalled()
  expect(smoke).not.toHaveBeenCalled()
})

it.each([
  { ...valid, status: 'NotTrusted' }, { ...valid, timestamped: false }, { ...valid, thumbprint: 'B'.repeat(40) },
])('prevents smoke when signed code fails verification: %j', async (verification) => {
  await writeFile(join(root, 'python.exe'), pe)
  const inspect = vi.fn().mockResolvedValueOnce(unsigned).mockResolvedValue(verification)
  const sign = vi.fn(), smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint: valid.thumbprint, inspect, sign, smoke }))
    .rejects.toThrow('signing verification failed')
  expect(sign).toHaveBeenCalledTimes(1)
  expect(smoke).not.toHaveBeenCalled()
})

it('does not retry a signer failure or execute the payload', async () => {
  await writeFile(join(root, 'python.exe'), pe)
  const sign = vi.fn().mockRejectedValue(new Error('token signing failed')), smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, {
    thumbprint: valid.thumbprint, inspect: async () => unsigned, sign, smoke,
  })).rejects.toThrow('token signing failed')
  expect(sign).toHaveBeenCalledTimes(1)
  expect(smoke).not.toHaveBeenCalled()
})

it.each([
  { stdout: 'not json', stderr: '' },
  { stdout: JSON.stringify(valid), stderr: 'inspection warning' },
  { stdout: JSON.stringify({ ...valid, status: 5 }), stderr: '' },
  { stdout: JSON.stringify({ ...valid, timestamped: 'true' }), stderr: '' },
  { stdout: JSON.stringify({ ...valid, thumbprint: 'wrong fingerprint' }), stderr: '' },
])('rejects invalid signature process output: %j', async (output) => {
  await writeFile(join(root, 'python.exe'), pe)
  inspection.mockResolvedValue(output)
  const sign = vi.fn(), smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint: valid.thumbprint, sign, smoke })).rejects.toThrow()
  expect(sign).not.toHaveBeenCalled()
  expect(smoke).not.toHaveBeenCalled()
})

it('parses trusted signature process output before permitting smoke', async () => {
  await writeFile(join(root, 'python.exe'), pe)
  inspection.mockResolvedValue({ stdout: JSON.stringify(valid), stderr: '' })
  const sign = vi.fn(), smoke = vi.fn()
  await signWindowsPrimaryRuntime(root, { thumbprint: valid.thumbprint, sign, smoke })
  const call = inspection.mock.calls[0]!
  expect(call[0]).toBe('powershell.exe')
  expect(call[1]).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive']))
  expect(call[2]).toHaveProperty('env.DSH_RUNTIME_VERIFY_FILE', join(root, 'python.exe'))
  expect(sign).not.toHaveBeenCalled()
  expect(smoke).toHaveBeenCalledExactlyOnceWith(root)
})

it('rejects an empty code tree without reporting a successful smoke', async () => {
  const sign = vi.fn(), smoke = vi.fn()
  await expect(signWindowsPrimaryRuntime(root, { thumbprint: valid.thumbprint, sign, smoke }))
    .rejects.toThrow('no Windows code found')
  expect(smoke).not.toHaveBeenCalled()
})
