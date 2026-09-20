/** Native SDK selection is explicit and does not probe host files or execute ADB. */
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { adbCommand, resolveConfig, type Config } from '../src/config.ts'

const executable = process.platform === 'win32' ? 'adb.exe' : 'adb'

describe('Native ADB configuration', () => {
  it('resolves all command bounds and the working directory explicitly', () => {
    const result = resolveConfig({ cwd: 'native-android-work' })
    expect(result).toEqual({ providerId: 'adb', command: '', cwd: resolve('native-android-work'),
      commandTimeoutMs: 30_000, graceMs: 3_000, cleanupTimeoutMs: 5_000,
      maxOutputBytes: 1024 * 1024, maxStderrBytes: 64 * 1024, maxImageBytes: 16 * 1024 * 1024,
      maxImagePixels: 16 * 1024 * 1024, maxTextBytes: 4096, swipeDurationMs: 400 })
  })

  it.each(['commandTimeoutMs', 'graceMs', 'cleanupTimeoutMs', 'maxOutputBytes', 'maxStderrBytes',
    'maxImageBytes', 'maxImagePixels', 'maxTextBytes', 'swipeDurationMs'] as const)('validates positive safe %s bounds', (key) => {
    for (const value of [0, -1, 0.5, NaN, Infinity, MAX_TIMER_DELAY_MS + 1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveConfig({ [key]: value })).toThrow()
    }
    expect(resolveConfig({ [key]: 1 })[key]).toBe(1)
    expect(resolveConfig({ [key]: MAX_TIMER_DELAY_MS })[key]).toBe(MAX_TIMER_DELAY_MS)
  })

  it.each([
    { providerId: '' }, { providerId: ' adb' }, { command: 'adb ' }, { command: 'adb\nprivate' },
    { command: 'adb\u0000private' }, { cwd: '' }, { cwd: ' /tmp/sdk' }, { cwd: '/tmp/sdk\rprivate' },
  ])('rejects invalid configuration strings %j', (config) => { expect(() => resolveConfig(config)).toThrow() })

  it('rejects unsupported deployment fields', () => {
    expect(() => resolveConfig({ unrelated: 'private value' } as Config)).toThrow('unsupported config field')
  })
})

describe('Existing SDK executable selection', () => {
  it('selects PATH, SDK root, platform-tools directory and exact executable without filesystem effects', () => {
    const sdk = resolve('not-acquired-sdk-root')
    expect(adbCommand('', '')).toBe('adb')
    expect(adbCommand('', sdk)).toBe(join(sdk, 'platform-tools', executable))
    expect(adbCommand('', join(sdk, 'platform-tools'))).toBe(join(sdk, 'platform-tools', executable))
    expect(adbCommand('', join(sdk, 'platform-tools', executable))).toBe(join(sdk, 'platform-tools', executable))
    expect(adbCommand('', join(sdk, 'PLATFORM-TOOLS'))).toBe(join(sdk, 'PLATFORM-TOOLS', executable))
  })

  it('gives an explicit executable precedence over saved SDK selection', () => {
    expect(adbCommand('configured-adb', 'invalid-relative-sdk')).toBe('configured-adb')
  })

  it.each(['relative-sdk', ' ../sdk', resolve('sdk') + ' ', resolve('sdk') + '\nprivate', resolve('sdk') + '\u0000private'])(
    'rejects unsafe or relative SDK selection %j', (sdk) => { expect(() => adbCommand('', sdk)).toThrow('Android SDK path must be absolute') },
  )
})
