import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../../..', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/harness-logging.ts', import.meta.url))
let directory: string

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'clh-harness-logging-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('Harness logging', () => {
  it('writes JSON child contexts and errors to the parent destination', async () => {
    const destination = join(directory, 'logs', 'harness.log')
    const { stdout } = await run(process.execPath, ['--import', 'tsx/esm', fixture, destination, 'json'], { cwd: root })
    expect(stdout).toBe('')

    const entries = (await readFile(destination, 'utf8')).trim().split('\n').map((line) => {
      const entry: unknown = JSON.parse(line)
      return entry
    })
    expect(entries).toHaveLength(4)
    expect(entries[0]).toMatchObject({ msg: 'Harness modules initialized', sessions: 0, tools: 0 })
    expect(entries[0]).not.toHaveProperty('project')
    expect(entries[1]).toMatchObject({ msg: 'Child log', project: 'smoke-project', task: 'smoke-task' })
    expect(entries[1]).not.toHaveProperty('component')
    expect(entries[2]).toMatchObject({ msg: 'Nested child log', project: 'smoke-project', component: 'tools' })
    expect(entries[3]).toMatchObject({ msg: 'Logged failure', err: { message: 'smoke-error' } })
  })

  it('writes pretty output to the configured file, including child contexts', async () => {
    const destination = join(directory, 'logs', 'harness.log')
    const { stdout } = await run(process.execPath, ['--import', 'tsx/esm', fixture, destination, 'pretty'], { cwd: root })
    expect(stdout).toBe('')

    const content = await readFile(destination, 'utf8')
    for (const text of ['Harness modules initialized', 'Child log', 'Nested child log', 'smoke-project', 'tools', 'smoke-error']) {
      expect(content).toContain(text)
    }
  })
})
