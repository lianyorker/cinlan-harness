/** Exercise the private packaging dispatcher with isolated executable-entry consumers. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-python-bootstrap-'))
  directories.push(directory)
  const bootstrap = join(directory, 'runtime-bootstrap.mjs')
  copyFileSync(resolve(import.meta.dirname, '../python/sdk-runtime/runtime-bootstrap.mjs'), bootstrap)
  const install = (name: string, subpath: string, source: string) => {
    const packageRoot = join(directory, 'node_modules', '@deepseek-ai', name)
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, type: 'module', exports: { [subpath]: './entry.mjs' } }))
    const entry = join(packageRoot, 'entry.mjs')
    writeFileSync(entry, source)
    return entry
  }
  const acl = install('dsh-sandbox-windows-acl', './runner', "console.log(JSON.stringify({ kind: 'acl', argv: process.argv.slice(1) }))")
  install('dsh', './lib/bin.js', "export async function runCli() { console.log(JSON.stringify({ kind: 'cli', argv: process.argv.slice(2) })) }")
  install('dsh-subprocess-local', './runner', "export async function runSelectedSubprocessRunner(selection) { console.log(JSON.stringify({ kind: 'subprocess', selection, selectorPresent: 'DSH_SUBPROCESS_RUNNER' in process.env })) }")
  install('dsh-ptc-runtime-node', './process', "console.log(JSON.stringify({ kind: 'ptc', selectorPresent: 'DSH_PTC_RUNTIME_NODE' in process.env }))")
  return { directory, bootstrap, acl }
}

function dispatch(setup: ReturnType<typeof fixture>, args: string[], selection?: string, ptc = false) {
  const environment = { ...process.env }
  delete environment.DSH_SUBPROCESS_RUNNER
  delete environment.DSH_PTC_RUNTIME_NODE
  delete environment.NODE_OPTIONS
  if (selection !== undefined) environment.DSH_SUBPROCESS_RUNNER = selection
  if (ptc) environment.DSH_PTC_RUNTIME_NODE = '1'
  const result = spawnSync(process.execPath, [setup.bootstrap, ...args], {
    cwd: setup.directory, env: environment, encoding: 'utf8', timeout: 10_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim()) as { kind: string; argv?: string[]; selection?: string; selectorPresent?: boolean }
}

describe('Python packaged runtime dispatcher', () => {
  it.runIf(process.platform === 'win32')('routes the self-executable ACL entry to the runner and removes the packaging argv', () => {
    const setup = fixture()
    expect(dispatch(setup, [setup.acl, '--worker-input'])).toEqual({ kind: 'acl', argv: [setup.acl, '--worker-input'] })
  })

  it('dispatches the packaged PTC selector and removes it before worker startup', () => {
    expect(dispatch(fixture(), [], undefined, true)).toEqual({ kind: 'ptc', selectorPresent: false })
  })

  it.runIf(process.platform === 'win32')('prioritizes ACL confinement before the selected PTC worker', () => {
    const setup = fixture()
    expect(dispatch(setup, [setup.acl, '--worker-input'], undefined, true)).toEqual({ kind: 'acl', argv: [setup.acl, '--worker-input'] })
  })

  it('keeps normal profile startup on the CLI path', () => {
    expect(dispatch(fixture(), ['--profile', 'sdk'])).toEqual({ kind: 'cli', argv: ['--profile', 'sdk'] })
  })

  it('preserves subprocess runner selection and removes its private selector', () => {
    expect(dispatch(fixture(), [], 'shell')).toEqual({ kind: 'subprocess', selection: 'shell', selectorPresent: false })
  })
})
