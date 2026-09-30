import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DSH_HOME_DISPLAY,
  DSH_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultDshHome,
  dshCachePath,
  dshHomeDisplay,
  dshHomePath,
  expandHomePath,
  resolveDshHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('clh/dsh path helpers', () => {
  it('owns the shared default CLH home directory name', () => {
    expect(DSH_HOME_DIR_NAME).toBe('.clh')
    expect(DEFAULT_DSH_HOME_DISPLAY).toBe('~/.clh')
    expect(defaultDshHome()).toBe(join(homedir(), '.clh'))
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

    expect(resolveDshHome('/tmp/explicit-clh', { CLH_HOME: '~/env-clh' })).toBe(resolve('/tmp/explicit-clh'))
    expect(resolveDshHome(undefined, { CLH_HOME: '~/env-clh' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('respects precedence: CLH_HOME > CINLAN_HARNESS_HOME > DSH_HOME', () => {
    expect(resolveDshHome(undefined, {
      CLH_HOME: '/clh-1',
      CINLAN_HARNESS_HOME: '/clh-2',
      DSH_HOME: '/clh-3',
    })).toBe(resolve('/clh-1'))

    expect(resolveDshHome(undefined, {
      CINLAN_HARNESS_HOME: '/clh-2',
      DSH_HOME: '/clh-3',
    })).toBe(resolve('/clh-2'))

    expect(resolveDshHome(undefined, {
      DSH_HOME: '/clh-3',
    })).toBe(resolve('/clh-3'))
  })

  it('treats an empty or whitespace-only home env as unset', () => {
    expect(resolveDshHome(undefined, { CLH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { CLH_HOME: '   ' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { DSH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { DSH_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved home', () => {
    vi.stubEnv('CLH_HOME', '~/env-clh')
    expect(dshHomePath()).toBe(join(homedir(), 'env-clh'))
    expect(dshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-clh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.clh')
    expect(dshHomeDisplay('/some/other/root')).toBe('$CLH_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.clh')],
    ['', join(homedir(), '.clh')],
    ['   ', join(homedir(), '.clh')],
    ['~/env-dsh', join(homedir(), 'env-dsh')],
    ['./relative-dsh', resolve('./relative-dsh')],
  ] as const)('resolves cache paths with DSH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('DSH_HOME', home)
    try {
      expect(dshCachePath()).toBe(join(expectedHome, 'cache'))
      expect(dshCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('DSH_HOME', '~/env-dsh')
    try {
      expect(dshCachePath({ dshHome: '~/explicit-dsh' })).toBe(join(homedir(), 'explicit-dsh', 'cache'))
      expect(dshCachePath({ dshHome: './explicit-dsh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-dsh/cache/attachments/request-images'))
      expect(dshCachePath({}, 'attachments')).toBe(join(homedir(), 'env-dsh', 'cache', 'attachments'))
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
