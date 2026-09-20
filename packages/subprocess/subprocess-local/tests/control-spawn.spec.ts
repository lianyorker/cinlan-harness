import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUBPROCESS_CONTROL_ENV } from '@deepseek-ai/dsh-subprocess/control'
import { controlEnvironment, controlPipe } from '../src/control-spawn.ts'
import { spawnSubprocess } from '../src/spawn.ts'

const channels = new Set<PassThrough>()
afterEach(() => {
  for (const channel of channels) channel.destroy()
  channels.clear()
})

describe('control pipe launch plumbing', () => {
  it('reserves fd 7 independently of standard output in the fallback launcher', async () => {
    const control = new PassThrough()
    channels.add(control)
    const child = Object.assign(new EventEmitter(), {
      pid: undefined, stdin: null, stdout: null, stderr: null,
      stdio: [null, null, null, null, null, null, null, control],
    })
    const spawn = vi.fn(() => child)
    const handle = spawnSubprocess({
      argv: ['mocked-node'], cwd: process.cwd(), graceMs: 100,
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', control: 'pipe' },
    }, { platform: 'win32', spawn: spawn as never })
    expect(spawn).toHaveBeenCalledExactlyOnceWith('mocked-node', [], expect.objectContaining({
      windowsHide: true, detached: false,
      env: expect.objectContaining({ [SUBPROCESS_CONTROL_ENV]: 'pipe' }),
      stdio: ['ignore', 'inherit', 'inherit', 'ignore', 'ignore', 'ignore', 'ignore', 'pipe'],
    }))
    expect(handle.control).toBe(control)
    expect(handle.stdout).toBeUndefined()
    expect(handle.stderr).toBeUndefined()
    child.emit('exit', 0, null)
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(control.destroyed).toBe(false)
  })

  it.each(['DSH_SUBPROCESS_CONTROL', 'dsh_subprocess_control'])('rejects caller overrides of %s before stamping the marker', (name) => {
    expect(() => controlEnvironment({ [name]: 'caller' }, 'pipe')).toThrow('reserved')
    expect(() => controlEnvironment({ [name]: 'caller' })).toThrow('reserved')
  })

  it('omits absent endpoints and permits an unset private marker', () => {
    expect(controlPipe({ stdio: [] }, 'pipe')).toBeUndefined()
    expect(controlPipe({ stdio: [] })).toBeUndefined()
    const env = { DSH_SUBPROCESS_CONTROL: undefined } as NodeJS.ProcessEnv
    expect(controlEnvironment(env, 'pipe')).toEqual({ DSH_SUBPROCESS_CONTROL: 'pipe' })
    expect(controlEnvironment({ SAFE: 'value' })).toEqual({ SAFE: 'value' })
  })
})
