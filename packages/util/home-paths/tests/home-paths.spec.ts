import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLH_HOME_DIR_NAME,
  DEFAULT_CLH_HOME_DISPLAY,
  canonicalizeWatchPath,
  clhCachePath,
  clhHomeDisplay,
  clhHomePath,
  defaultClhHome,
  expandHomePath,
  resolveClhHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clh/dsh path helpers', () => {
  it('owns the shared default CLH home directory name', () => {
    expect(CLH_HOME_DIR_NAME).toBe('.clh')
    expect(DEFAULT_CLH_HOME_DISPLAY).toBe('~/.clh')
    expect(defaultClhHome()).toBe(join(homedir(), '.clh'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.clh')).toBe(join(homedir(), '.clh'))
    expect(expandHomePath('~\\.clh')).toBe(join(homedir(), '.clh'))
    expect(expandHomePath('/tmp/.clh')).toBe('/tmp/.clh')
    expect(expandHomePath('~other/.clh')).toBe('~other/.clh')
  })

  it('resolves explicit path before environment and the default', () => {
    const envHome = join(homedir(), 'env-clh')

    expect(resolveClhHome('/tmp/explicit-clh', { CLH_HOME: '~/env-clh' })).toBe(resolve('/tmp/explicit-clh'))
    expect(resolveClhHome(undefined, { CLH_HOME: '~/env-clh' })).toBe(envHome)
    expect(resolveClhHome(undefined, {})).toBe(defaultClhHome())
  })

  it('respects precedence: CLH_HOME > CINLAN_HARNESS_HOME', () => {
    expect(resolveClhHome(undefined, {
      CLH_HOME: '/clh-1',
      CINLAN_HARNESS_HOME: '/clh-2',
    })).toBe(resolve('/clh-1'))

    expect(resolveClhHome(undefined, {
      CINLAN_HARNESS_HOME: '/clh-2',
    })).toBe(resolve('/clh-2'))
  })

  it('never inherits the official DSH_HOME root', () => {
    // A machine running both products must keep the two roots apart; inheriting
    // the official home would let CLH read or clean the official sessions.
    expect(resolveClhHome(undefined, { DSH_HOME: '/official-dsh' })).toBe(defaultClhHome())
    expect(resolveClhHome(undefined, {
      CLH_HOME: '/clh-1',
      DSH_HOME: '/official-dsh',
    })).toBe(resolve('/clh-1'))
  })

  it('treats an empty or whitespace-only home env as unset', () => {
    expect(resolveClhHome(undefined, { CLH_HOME: '' })).toBe(defaultClhHome())
    expect(resolveClhHome(undefined, { CLH_HOME: '   ' })).toBe(defaultClhHome())
    expect(resolveClhHome(undefined, { CINLAN_HARNESS_HOME: '' })).toBe(defaultClhHome())
    expect(resolveClhHome(undefined, { CINLAN_HARNESS_HOME: '   ' })).toBe(defaultClhHome())
  })

  it('joins child segments onto the resolved home', () => {
    vi.stubEnv('CLH_HOME', '~/env-clh')
    expect(clhHomePath()).toBe(join(homedir(), 'env-clh'))
    expect(clhHomePath('storages', 'cache')).toBe(join(homedir(), 'env-clh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(clhHomeDisplay(resolve(defaultClhHome()))).toBe('~/.clh')
    expect(clhHomeDisplay('/some/other/root')).toBe('$CLH_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.clh')],
    ['', join(homedir(), '.clh')],
    ['   ', join(homedir(), '.clh')],
    ['~/env-clh', join(homedir(), 'env-clh')],
    ['./relative-clh', resolve('./relative-clh')],
  ] as const)('resolves cache paths with CLH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('CLH_HOME', home)
    try {
      expect(clhCachePath()).toBe(join(expectedHome, 'cache'))
      expect(clhCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ignores DSH_HOME when resolving cache paths', () => {
    vi.stubEnv('DSH_HOME', '~/official-dsh')
    try {
      expect(clhCachePath()).toBe(join(defaultClhHome(), 'cache'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('CLH_HOME', '~/env-clh')
    try {
      expect(clhCachePath({ clhHome: '~/explicit-clh' })).toBe(join(homedir(), 'explicit-clh', 'cache'))
      expect(clhCachePath({ clhHome: './explicit-clh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-clh/cache/attachments/request-images'))
      expect(clhCachePath({}, 'attachments')).toBe(join(homedir(), 'env-clh', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
