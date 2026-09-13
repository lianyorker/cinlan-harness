/** Isolated gate fixtures cover link setup and compiler failures independently. */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const hook = pathToFileURL(require.resolve('tsx/esm')).href
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(compiler: string, duplicate = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-node-next-gate-'))
  roots.push(root)
  await mkdir(join(root, 'scripts'))
  await copyFile(fileURLToPath(new URL('./verify-node-next-types.ts', import.meta.url)), join(root, 'scripts/verify-node-next-types.ts'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  for (const name of duplicate ? ['first', 'second'] : ['first']) {
    const dir = join(root, 'packages', 'fixture', name)
    await mkdir(join(dir, 'lib/types'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@fixture/consumer', type: 'module', types: 'lib/types/index.d.ts' }))
    await writeFile(join(dir, 'lib/types/index.d.ts'), 'export declare const value: string\n')
  }
  await mkdir(join(root, 'node_modules/typescript/bin'), { recursive: true })
  await writeFile(join(root, 'node_modules/typescript/bin/tsc'), compiler)
  return root
}
async function run(root: string) {
  try {
    const result = await exec(process.execPath, ['--import', hook, join(root, 'scripts/verify-node-next-types.ts')], { cwd: root, timeout: 30_000 })
    return { ...result, code: 0 }
  } catch (error) {
    const failure = error as Error & { code: number; stdout: string; stderr: string; killed?: boolean }
    if (failure.killed) throw failure
    return failure
  }
}

describe('NodeNext consumer gate', () => {
  it('creates real package links and removes its staging directory', async () => {
    const root = await fixture(
      "const fs = require('node:fs'), path = require('node:path'); const dir = path.dirname(process.argv[3]); "
      + "const linked = path.join(dir, 'node_modules/@fixture/consumer/lib/types/index.d.ts'); "
      + "if (!fs.existsSync(linked) || !fs.readFileSync(path.join(dir, 'index.ts'), 'utf8').includes('@fixture/consumer')) process.exit(2);",
    )
    const result = await run(root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('1 workspace package declaration API(s) compile under NodeNext')
    expect(await readFile(join(root, 'packages/fixture/first/lib/types/index.d.ts'), 'utf8')).toContain('export declare const value')
    expect((await readdir(root)).some(name => name.startsWith('.node-next-types-'))).toBe(false)
  })
  it('retains the compiler diagnostic and failing exit code', async () => {
    const root = await fixture("process.stdout.write('fixture compiler rejection'); process.exit(2)")
    const result = await run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('typecheck failed')
    expect(result.stderr).toContain('fixture compiler rejection')
  })
  it('reports setup failures even when no compiler stdout exists', async () => {
    const root = await fixture("throw new Error('compiler must not run')", true)
    const result = await run(root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('setup failed')
    expect(result.stderr).toContain('EEXIST')
    expect(result.stderr).not.toContain('compiler must not run')
    expect((await readdir(root)).some(name => name.startsWith('.node-next-types-'))).toBe(false)
  })
})
