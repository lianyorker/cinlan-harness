import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHarnessConfig, resolveConfigPaths } from '../src/harness/config/loader.ts'
import { mergeConfigs } from '../src/harness/config/merger.ts'
import { DEFAULT_CONFIG } from '../src/harness/config/types.ts'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

describe('Harness configuration', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing config'), { code: 'ENOENT' }))
  })

  afterEach(() => { vi.unstubAllEnvs() })

  it('uses complete defaults when all configuration files are missing', async () => {
    expect(await loadHarnessConfig('project')).toEqual(DEFAULT_CONFIG)
    expect(readFile).toHaveBeenCalledTimes(3)
  })

  it('applies project, user, and global overrides while preserving omitted nested defaults', async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce(JSON.stringify({ llm: { model: 'global', temperature: 0 }, ui: { fontSize: 16 } }))
      .mockResolvedValueOnce(JSON.stringify({ llm: { model: 'user' }, features: { streaming: false } }))
      .mockResolvedValueOnce(JSON.stringify({ llm: { model: 'project' } }))

    const config = await loadHarnessConfig('project')
    expect(config.llm).toEqual({ ...DEFAULT_CONFIG.llm, model: 'project', temperature: 0 })
    expect(config.features).toEqual({ ...DEFAULT_CONFIG.features, streaming: false })
    expect(config.ui).toEqual({ ...DEFAULT_CONFIG.ui, fontSize: 16 })
    expect(config.storage).toEqual(DEFAULT_CONFIG.storage)
  })

  it('expands environment references in nested strings and arrays without changing numbers or booleans', async () => {
    vi.stubEnv('CINLAN_HARNESS_TEST_MODEL', 'configured-model')
    vi.stubEnv('CINLAN_HARNESS_TEST_TOOL', 'read_file')
    vi.stubEnv('CINLAN_HARNESS_TEST_MISSING', undefined)
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({
      llm: { model: '${CINLAN_HARNESS_TEST_MODEL}', temperature: 0, streamOutput: false },
      features: { tools: ['${CINLAN_HARNESS_TEST_TOOL}'], experimental: [] },
      storage: { path: 'prefix/${CINLAN_HARNESS_TEST_MISSING}/suffix' },
    }))

    const config = await loadHarnessConfig()
    expect(config.llm.model).toBe('configured-model')
    expect(config.llm.temperature).toBe(0)
    expect(config.llm.streamOutput).toBe(false)
    expect(config.features.tools).toEqual(['read_file'])
    expect(config.features.experimental).toEqual([])
    expect(config.storage.path).toBe('prefix//suffix')
  })

  it('skips the project file when no project directory is supplied', async () => {
    expect(resolveConfigPaths().project).toBeUndefined()
    await loadHarnessConfig()
    expect(readFile).toHaveBeenCalledTimes(2)
    const paths = resolveConfigPaths()
    expect(readFile).toHaveBeenNthCalledWith(1, paths.global, 'utf-8')
    expect(readFile).toHaveBeenNthCalledWith(2, paths.user, 'utf-8')
  })

  it('reports the file path when configuration JSON is malformed', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('{invalid json')
    await expect(loadHarnessConfig()).rejects.toThrow(`Failed to load config from ${resolveConfigPaths().global}:`)
  })

  it('propagates read failures other than missing files', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }))
    await expect(loadHarnessConfig()).rejects.toThrow('access denied')
  })

  it('replaces arrays and preserves source configurations during nested merging', () => {
    const override = { features: { tools: ['custom_tool'] }, llm: { maxTokens: 1024 } }
    const defaultsBefore = structuredClone(DEFAULT_CONFIG)
    const overrideBefore = structuredClone(override)
    const config = mergeConfigs(DEFAULT_CONFIG, override)

    expect(config.features.tools).toEqual(['custom_tool'])
    expect(config.features.experimental).toEqual(DEFAULT_CONFIG.features.experimental)
    expect(config.llm).toEqual({ ...DEFAULT_CONFIG.llm, maxTokens: 1024 })
    expect(DEFAULT_CONFIG).toEqual(defaultsBefore)
    expect(override).toEqual(overrideBefore)
  })
})
