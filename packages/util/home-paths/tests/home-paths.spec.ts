import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  CINLAN_HARNESS_HOME_ENV,
  CLH_HOME_DIR_NAME,
  CLH_HOME_ENV,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_CLH_HOME_DISPLAY,
  DEFAULT_DSH_HOME_DISPLAY,
  DSH_HOME_DIR_NAME,
  DSH_HOME_ENV,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  clhCachePath,
  clhHomeDisplay,
  clhHomePath,
  defaultAgentsHome,
  defaultClhHome,
  defaultDshHome,
  dshCachePath,
  dshHomeDisplay,
  dshHomePath,
  dshPath,
  expandHomePath,
  resolveAgentsHome,
  resolveClhHome,
  resolveDshHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clh path helpers', () => {
  it('owns the Cinlan Harness home directory name and its deprecated aliases', () => {
    expect(CLH_HOME_DIR_NAME).toBe('.clh')
    expect(DEFAULT_CLH_HOME_DISPLAY).toBe('~/.clh')
    expect(defaultClhHome()).toBe(join(homedir(), '.clh'))
    expect(DSH_HOME_DIR_NAME).toBe(CLH_HOME_DIR_NAME)
    expect(DEFAULT_DSH_HOME_DISPLAY).toBe(DEFAULT_CLH_HOME_DISPLAY)
    expect(defaultDshHome()).toBe(defaultClhHome())
  })

  it('keeps the official DSH_HOME variable readable but never resolves through it', () => {
    expect(CLH_HOME_ENV).toBe('CLH_HOME')
    expect(CINLAN_HARNESS_HOME_ENV).toBe('CINLAN_HARNESS_HOME')
    expect(DSH_HOME_ENV).toBe('DSH_HOME')
    // A machine that also runs the official harness keeps the two roots apart:
    // the official override cannot relocate the Cinlan Harness home.
    expect(resolveClhHome(undefined, { DSH_HOME: '~/official-dsh' })).toBe(defaultClhHome())
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.clh')).toBe(join(homedir(), '.clh'))
    expect(expandHomePath('~\\.clh')).toBe(join(homedir(), '.clh'))
    expect(expandHomePath('/tmp/.clh')).toBe('/tmp/.clh')
    expect(expandHomePath('~other/.clh')).toBe('~other/.clh')
  })

  it('resolves explicit path before CLH_HOME, CINLAN_HARNESS_HOME, and the default', () => {
    const envHome = join(homedir(), 'env-clh')
    const cinlanHome = join(homedir(), 'env-cinlan')

    expect(resolveClhHome('/tmp/explicit-clh', { CLH_HOME: '~/env-clh' })).toBe(resolve('/tmp/explicit-clh'))
    expect(resolveClhHome(undefined, { CLH_HOME: '~/env-clh' })).toBe(envHome)
    expect(resolveClhHome(undefined, { CINLAN_HARNESS_HOME: '~/env-cinlan' })).toBe(cinlanHome)
    expect(resolveClhHome(undefined, { CLH_HOME: '~/env-clh', CINLAN_HARNESS_HOME: '~/env-cinlan' })).toBe(envHome)
    expect(resolveClhHome(undefined, {})).toBe(defaultClhHome())
    // The deprecated resolver is the same resolution.
    expect(resolveDshHome(undefined, { CLH_HOME: '~/env-clh' })).toBe(envHome)
  })

  it('treats empty or whitespace-only home variables as unset', () => {
    expect(resolveClhHome(undefined, { CLH_HOME: '' })).toBe(defaultClhHome())
    expect(resolveClhHome(undefined, { CLH_HOME: '   ' })).toBe(defaultClhHome())
    expect(resolveClhHome(undefined, { CINLAN_HARNESS_HOME: '' })).toBe(defaultClhHome())
    // A blank CLH_HOME falls through to CINLAN_HARNESS_HOME.
    expect(resolveClhHome(undefined, { CLH_HOME: ' ', CINLAN_HARNESS_HOME: '~/env-cinlan' }))
      .toBe(join(homedir(), 'env-cinlan'))
  })

  it('joins child segments onto the resolved CLH_HOME', () => {
    vi.stubEnv(CLH_HOME_ENV, '~/env-clh')
    expect(clhHomePath()).toBe(join(homedir(), 'env-clh'))
    expect(clhHomePath('storages', 'cache')).toBe(join(homedir(), 'env-clh', 'storages', 'cache'))
    expect(dshHomePath('storages')).toBe(join(homedir(), 'env-clh', 'storages'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(clhHomeDisplay(resolve(defaultClhHome()))).toBe('~/.clh')
    expect(clhHomeDisplay('/some/other/root')).toBe('$CLH_HOME')
    expect(dshHomeDisplay('/some/other/root')).toBe('$CLH_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before DSH_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { DSH_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { DSH_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only DSH_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { DSH_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { DSH_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$DSH_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.clh')],
    ['', join(homedir(), '.clh')],
    ['   ', join(homedir(), '.clh')],
    ['~/env-clh', join(homedir(), 'env-clh')],
    ['./relative-clh', resolve('./relative-clh')],
  ] as const)('resolves cache paths with CLH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv(CLH_HOME_ENV, home)
    try {
      expect(clhCachePath()).toBe(join(expectedHome, 'cache'))
      expect(clhCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
      expect(dshCachePath()).toBe(join(expectedHome, 'cache'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv(CLH_HOME_ENV, '~/env-clh')
    try {
      expect(clhCachePath({ clhHome: '~/explicit-clh' })).toBe(join(homedir(), 'explicit-clh', 'cache'))
      expect(dshCachePath({ clhHome: './explicit-clh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-clh/cache/attachments/request-images'))
      expect(dshCachePath({ dshHome: './explicit-legacy' })).toBe(resolve('./explicit-legacy/cache'))
      expect(clhCachePath({}, 'attachments')).toBe(join(homedir(), 'env-clh', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    [undefined, join(homedir(), '.clh')],
    ['', join(homedir(), '.clh')],
    ['~/env-clh', join(homedir(), 'env-clh')],
    ['./relative-clh', resolve('./relative-clh')],
  ] as const)('resolves category paths with CLH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv(CLH_HOME_ENV, home)
    for (const category of ['config', 'data', 'state', 'cache', 'backup'] as const) {
      expect(dshPath(category)).toBe(join(expectedHome, category))
      expect(dshPath(category, 'owner', 'file.json')).toBe(join(expectedHome, category, 'owner', 'file.json'))
    }
  })

  it('resolves a configured category home before the environment', () => {
    vi.stubEnv(CLH_HOME_ENV, '~/env-clh')
    expect(dshPath({ category: 'state', clhHome: '~/explicit-clh' }, 'logs')).toBe(join(homedir(), 'explicit-clh', 'state', 'logs'))
    expect(dshPath({ category: 'state', dshHome: '~/explicit-legacy' }, 'logs')).toBe(join(homedir(), 'explicit-legacy', 'state', 'logs'))
    expect(dshPath({ category: 'data', clhHome: undefined })).toBe(join(homedir(), 'env-clh', 'data'))
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
