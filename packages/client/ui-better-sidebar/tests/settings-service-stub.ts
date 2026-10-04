/**
 * File-backed settings service for Loader compositions that predate the
 * profile-patch seam: it serves the same describe/update/mutate/configure
 * surface over a YAML document the fixture owns, so preference persistence and
 * process restarts stay observable in these tests.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import yaml from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'

/** One path edit the settings surface accepts. */
export interface SettingsPathOp {
  readonly op: 'set' | 'unset'
  readonly path: readonly (string | number)[]
  readonly value?: unknown
}

/**
 * Build the stub plugin for one settings document.
 * @param path - YAML document the served namespaces persist into.
 * @returns A plugin whose `settings` service reads and writes that document.
 */
export function settingsServiceStub(path: string) {
  let revision = 1
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of [...listeners]) listener() }
  const read = (): Record<string, unknown> =>
    (existsSync(path) ? yaml.load(readFileSync(path, 'utf8')) ?? {} : {}) as Record<string, unknown>
  const write = (document: Record<string, unknown>): void => { writeFileSync(path, yaml.dump(document)) }
  const applyOps = (document: Record<string, unknown>, ns: string, ops: readonly SettingsPathOp[]): void => {
    const section = { ...(document[ns] as Record<string, unknown> | undefined) }
    for (const op of ops) {
      const [head, ...rest] = op.path
      if (typeof head !== 'string' || rest.length > 0) continue
      if (op.op === 'set') section[head] = op.value
      else delete section[head]
    }
    document[ns] = section
  }
  const checkRevision = (expected: number | undefined): void => {
    if (expected !== undefined && expected !== revision) {
      throw Object.assign(new Error('settings document changed'), { code: 'SETTINGS_CONFLICT' })
    }
  }
  return {
    name: '@deepseek-ai/dsh-settings',
    apply(c: Context) {
      c.provide('settings', {
        describe: () => Object.entries(read()).map(([ns, value]) => ({
          ns, value, schema: {}, autoGenerate: false, applies: 'live', revision,
        })),
        configure: () => () => {},
        prepareDocument: async () => path,
        register: (ns: string) => ({
          get: () => read()[ns] ?? {},
          watch: (callback: () => void) => {
            listeners.add(callback)
            return () => { listeners.delete(callback) }
          },
        }),
        update: async (ns: string, patch: object, expected?: number) => {
          checkRevision(expected)
          const document = read()
          document[ns] = { ...(document[ns] as object | undefined), ...patch }
          write(document)
          revision += 1
          notify()
        },
        mutate: async (ns: string, ops: readonly SettingsPathOp[], expected?: number) => {
          checkRevision(expected)
          const document = read()
          applyOps(document, ns, ops)
          write(document)
          revision += 1
          notify()
        },
        replace: async (ns: string, section: object) => {
          const document = read()
          document[ns] = section
          write(document)
          revision += 1
        },
      } as never)
    },
  }
}
