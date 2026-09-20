import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

describe('startup Host cleanup retry', () => {
  it('retries a failed stop after late child closure while permanently rejecting restart', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const request = new PassThrough()
    const response = new PassThrough()
    const child = Object.assign(new EventEmitter(), {
      connected: true, pid: 123,
      stdio: [null, stdout, stderr, request, response], stdout, stderr,
      send: vi.fn(), kill: vi.fn(() => true),
    })
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess)
    vi.useFakeTimers()
    const host = new DesktopHostProcess('fixture-node', '/private-fixture')
    try {
      const ready = host.start()
      child.emit('message', { type: 'ready', protocolVersion: 4, dshVersion: 'fixture' })
      await ready
      const stopping = host.stop()
      expect(host.stop()).toBe(stopping)
      const failure = expect(stopping).rejects.toThrow('did not exit after SIGKILL')
      await vi.advanceTimersByTimeAsync(20_000)
      await failure
      expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
      await expect(host.start()).rejects.toThrow('is stopping')
      child.emit('close', null)
      await expect(host.stop()).resolves.toBeUndefined()
      await expect(host.start()).rejects.toThrow('is stopping')
    } finally {
      child.emit('close', null)
      await host.stop()
      stdout.unpipe(process.stdout)
      for (const stream of [stdout, stderr, request, response]) stream.destroy()
      vi.useRealTimers()
      vi.mocked(spawn).mockReset()
    }
  })
})
