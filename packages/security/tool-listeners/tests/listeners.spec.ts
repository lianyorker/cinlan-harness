import { describe, expect, it, vi } from 'vitest'
import { buildNtlmRelayArgv, buildResponderArgv } from '../src/argv.ts'
import { collectedSources, listenerOutcome, subprocessJob } from '../src/jobs.ts'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

describe('buildResponderArgv', () => {
  it('builds a fixed poisoning session argv', () => {
    expect(buildResponderArgv('/usr/bin/Responder', { interface: 'eth0' })).toEqual([
      '/usr/bin/Responder', '-I', 'eth0', '-v',
    ])
  })

  it('rejects injection-shaped interface names', () => {
    expect(() => buildResponderArgv('Responder', { interface: '-w' })).toThrow(TypeError)
    expect(() => buildResponderArgv('Responder', { interface: 'eth0;id' })).toThrow(TypeError)
    expect(() => buildResponderArgv('Responder', { interface: 'a'.repeat(16) })).toThrow(TypeError)
    expect(() => buildResponderArgv('Responder', { interface: '' })).toThrow(TypeError)
  })
})

describe('buildNtlmRelayArgv', () => {
  it('builds an smb relay with the fixed relay-support flag', () => {
    expect(buildNtlmRelayArgv('/usr/bin/ntlmrelayx', { target: '10.0.0.5' })).toEqual([
      '/usr/bin/ntlmrelayx', '-t', 'smb://10.0.0.5', '-smb2support',
    ])
    expect(buildNtlmRelayArgv('ntlmrelayx', { target: 'dc01.lab.example.invalid', scheme: 'ldaps' })).toEqual([
      'ntlmrelayx', '-t', 'ldaps://dc01.lab.example.invalid', '-smb2support',
    ])
  })

  it('rejects injection-shaped targets and unsupported schemes', () => {
    expect(() => buildNtlmRelayArgv('ntlmrelayx', { target: '-t' })).toThrow(TypeError)
    expect(() => buildNtlmRelayArgv('ntlmrelayx', { target: '10.0.0.5/../x' })).toThrow(TypeError)
    expect(() => buildNtlmRelayArgv('ntlmrelayx', { target: '10.0.0.5', scheme: 'dns' })).toThrow(TypeError)
  })
})

describe('listenerOutcome', () => {
  it('maps signal kills and normal exits', () => {
    expect(listenerOutcome({ exitCode: null, signal: 'SIGTERM' })).toEqual({ status: 'killed', detail: 'signal: SIGTERM' })
    expect(listenerOutcome({ exitCode: null, signal: null })).toEqual({ status: 'killed', detail: 'killed before exit' })
    expect(listenerOutcome({ exitCode: 0, signal: null })).toEqual({ status: 'completed', detail: 'exit code: 0' })
  })
})

function fakeHandle(outcome: SubprocessOutcome, done?: Promise<SubprocessOutcome>): SubprocessHandle {
  return {
    terminate: vi.fn(),
    done: done ?? Promise.resolve(outcome),
    collected: {
      stdout: { readFrom: (from: number) => ({ text: `stdout-from-${from}`, nextOffset: from + 5, lossy: false }) },
      stderr: { readFrom: (from: number) => ({ text: `stderr-from-${from}`, nextOffset: from + 5, lossy: false }) },
    },
  } as never
}

describe('collectedSources and subprocessJob', () => {
  it('binds lazily and reads through the collected streams', () => {
    const sources = collectedSources(() => undefined)
    expect(sources[0]!.read(0)).toEqual({ text: '', nextOffset: 0, lossy: false })
    const handleRef: { current: SubprocessHandle | undefined } = { current: undefined }
    const bound = collectedSources(() => handleRef.current)
    handleRef.current = fakeHandle({ exitCode: 0, signal: null })
    expect(bound[0]!.read(3)).toEqual({ text: 'stdout-from-3', nextOffset: 8, lossy: false })
    expect(bound[1]!.read(1)).toEqual({ text: 'stderr-from-1', nextOffset: 6, lossy: false })
  })

  it('settles through the handle outcome and terminates on cancel', async () => {
    const handle = fakeHandle({ exitCode: null, signal: 'SIGTERM' })
    const hooks = subprocessJob(async () => handle)
    hooks.cancel('window closed')
    await expect(hooks.done).resolves.toEqual({ status: 'killed', detail: 'signal: SIGTERM' })
    expect(handle.terminate).toHaveBeenCalled()
  })

  it('reports a failed spawn and a pre-spawn cancel as the matching outcomes', async () => {
    const failed = subprocessJob(() => Promise.reject(new Error('spawn denied')))
    await expect(failed.done).resolves.toMatchObject({ status: 'failed', detail: 'spawn denied' })
    const cancelled = subprocessJob(signal => new Promise<SubprocessHandle>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    cancelled.cancel('stopped')
    await expect(cancelled.done).resolves.toMatchObject({ status: 'killed' })
  })
})
