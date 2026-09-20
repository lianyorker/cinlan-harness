import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runDesktopDevelopment } from '../scripts/dev.ts'
import type { DevelopmentProjectOptions } from '../scripts/development-project.ts'

const fixture = vi.hoisted(() => ({
  prepare: vi.fn<() => Promise<void>>(),
  project: vi.fn<(options: DevelopmentProjectOptions) => string>(),
  spawn: vi.fn<(command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => EventEmitter>(),
}))
vi.mock('../scripts/prepare-primary-runtime.ts', () => ({ preparePrimaryRuntime: fixture.prepare }))
vi.mock('../scripts/development-project.ts', () => ({ prepareDevelopmentProject: fixture.project }))
vi.mock('node:child_process', () => ({ spawn: fixture.spawn }))
vi.mock('node:module', () => ({ createRequire: () => () => 'fixture-electron' }))
vi.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: (path: string) => JSON.stringify({ version: path.includes('pnpm') ? '11.7.0' : '0.1.6-alpha.2' }),
}))

beforeEach(() => {
  vi.stubEnv('npm_execpath', 'fixture-pnpm')
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'win32')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
  vi.stubEnv('DSH_DESKTOP_DEVELOPMENT_ROOT', resolve('fixture-development'))
  vi.stubEnv('DSH_HOME', resolve('fixture-home'))
  vi.stubEnv('DSH_DESKTOP_HOST_INSPECT_PORT', '0')
  vi.stubEnv('DSH_DESKTOP_PRIMARY_RUNTIME', resolve('stale-payload'))
  fixture.prepare.mockReset().mockResolvedValue(undefined)
  fixture.project.mockReset()
  fixture.spawn.mockReset().mockImplementation(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0, null))
    return child
  })
})
afterEach(() => { vi.unstubAllEnvs() })

it.each([false, true])('prepares a primary payload before launch with skip-build=%s', async (skipBuild) => {
  let prepared = false
  fixture.prepare.mockImplementation(async () => { prepared = true })
  fixture.spawn.mockImplementation((command: string) => {
    if (command === 'fixture-electron') expect(prepared).toBe(true)
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0, null))
    return child
  })
  await runDesktopDevelopment(skipBuild ? ['--skip-build'] : [])
  expect(fixture.prepare).toHaveBeenCalledExactlyOnceWith()
  const calls = fixture.spawn.mock.calls
  expect(calls.length).toBe(skipBuild ? 1 : 3)
  if (!skipBuild) {
    expect(calls.slice(0, 2).map(([, args]) => args)).toEqual([
      ['fixture-pnpm', 'run', 'build'], ['fixture-pnpm', 'run', 'build'],
    ])
  }
  const [command, args, options] = calls.at(-1)!
  const appRoot = resolve(import.meta.dirname, '..')
  expect(command).toBe('fixture-electron')
  expect(args).toContain('--user-data-dir=' + join(resolve('fixture-development'), 'electron-user-data'))
  expect(options.env).toMatchObject({
    DSH_HOME: resolve('fixture-home'),
    DSH_DESKTOP_DEV_PROJECT_DIR: join(resolve('fixture-development'), 'project'),
    DSH_DESKTOP_NODE_BINARY: process.execPath,
    DSH_DESKTOP_PRIMARY_RUNTIME: join(appRoot, '.desktop-build', 'targets', 'win-x64', 'runtime', 'primary-runtime'),
  })
  expect(options.env.DSH_DESKTOP_HOST_INSPECT_PORT).toBeUndefined()
  expect(fixture.project.mock.calls[0]![0].release.nodeVersion).toBe(process.versions.node)
})

it('does not launch Electron when payload preparation fails', async () => {
  fixture.prepare.mockRejectedValue(new Error('primary archive unavailable'))
  await expect(runDesktopDevelopment(['--skip-build'])).rejects.toThrow('primary archive unavailable')
  expect(fixture.spawn).not.toHaveBeenCalled()
})
