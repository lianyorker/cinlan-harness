/** The top-level build must execute its leaf steps and stop before recording partial artifacts. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeClientBuildRecord } from './client-build-environment.ts'
import { buildRepository } from './build.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(() => ({ status: 0, signal: null })) }))
vi.mock('node:fs', () => ({ rmSync: vi.fn() }))
vi.mock('./client-build-environment.ts', () => ({
  CLIENT_BUILD_RECORD_PATH: '.dsh-build/client-build.json',
  CLIENT_BUILD_PROFILE_SELECTOR: 'DSH_BUILD_CLIENT_PROFILE',
  repositoryClientBuildEnvironment: vi.fn(() => ({})),
  resolveClientBuildEnvironment: vi.fn(() => ({})),
  clientBuildProcessEnvironment: vi.fn((environment: NodeJS.ProcessEnv) => environment),
  writeClientBuildRecord: vi.fn(() => ({ artifacts: { fileCount: 1 }, environment: {} })),
}))

beforeEach(() => { vi.clearAllMocks() })

describe('repository build', () => {
  it('executes Host, Client, and Web leaves before publishing a build record', () => {
    buildRepository({ npm_execpath: 'fixture-pnpm.cjs' })
    expect(vi.mocked(spawnSync).mock.calls.map(call => call[1])).toEqual([
      ['fixture-pnpm.cjs', 'run', 'build:native-system'],
      ['fixture-pnpm.cjs', 'run', 'build:lib:host'],
      ['fixture-pnpm.cjs', 'run', 'build:lib:client'],
      ['fixture-pnpm.cjs', '--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'],
    ])
    expect(writeClientBuildRecord).toHaveBeenCalledTimes(1)
    const recordOrder = vi.mocked(writeClientBuildRecord).mock.invocationCallOrder[0]!
    expect(recordOrder).toBeGreaterThan(vi.mocked(spawnSync).mock.invocationCallOrder.at(-1)!)
  })

  it('does not record artifacts or run later phases after a failed Host build', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, signal: null } as never)
      .mockReturnValueOnce({ status: 2, signal: null } as never)
    expect(() => { buildRepository({ npm_execpath: 'fixture-pnpm.cjs' }) }).toThrow('build: run build:lib:host exited with 2')
    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(writeClientBuildRecord).not.toHaveBeenCalled()
  })
})
