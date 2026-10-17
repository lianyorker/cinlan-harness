/** Real-file, isolated-process integration of Desktop-local Harness modules. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'

const run = promisify(execFile)
const cwd = fileURLToPath(new URL('../../..', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/harness-integration.ts', import.meta.url))

it('loads configuration, writes a tool artifact, records lifecycle events, and logs outcomes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clh-m3-integration-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const project = join(root, 'project')
  const home = join(root, 'home')
  const programData = join(root, 'program-data')
  await mkdir(join(project, '.harness'), { recursive: true })
  await mkdir(join(home, '.cinlan'), { recursive: true })
  await mkdir(join(programData, 'cinlan-harness'), { recursive: true })
  await writeFile(join(programData, 'cinlan-harness', 'config.json'), JSON.stringify({ llm: { model: 'global-model' } }))
  await writeFile(join(home, '.cinlan', 'config.json'), JSON.stringify({ llm: { model: 'user-model', temperature: 0 }, ui: { fontSize: 18 } }))
  await writeFile(join(project, '.harness', 'config.json'), JSON.stringify({ llm: { model: '${CINLAN_M3_MODEL}' } }))
  const { stdout, stderr } = await run(process.execPath, [fixture, project], {
    cwd, timeout: 30_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PROGRAMDATA: programData, CINLAN_M3_MODEL: 'project-model' },
  })
  expect(stderr).toBe('')
  const result: unknown = JSON.parse(stdout)
  expect(result).toMatchObject({
    model: 'project-model', temperature: 0, fontSize: 18, state: 'completed', sessions: 0, tools: 0,
    result: { success: true, output: join(project, 'note.txt') },
    missing: { success: false, error: 'Tool not found: missing_tool' },
    invalid: { success: false, error: 'text must be a string' },
    context: { model: 'project-model', task: 'write_note', output: join(project, 'note.txt') },
    events: ['started', 'tool_executed', 'paused', 'resumed', 'error', 'idle', 'completed'],
  })
  expect(await readFile(join(project, 'note.txt'), 'utf8')).toBe('M3 local integration verified')
  const logs = (await readFile(join(project, 'logs', 'harness.log'), 'utf8')).trim().split('\n').map((line) => {
    const entry: unknown = JSON.parse(line)
    return entry
  })
  expect(logs).toHaveLength(3)
  expect(logs[0]).toMatchObject({ msg: 'Harness modules initialized', model: 'project-model', sessions: 1, tools: 1 })
  expect(logs[1]).toMatchObject({ msg: 'Tool completed', tool: 'write_note', success: true })
  expect(logs[2]).toMatchObject({ msg: 'Tool failed', tool: 'write_note', error: 'text must be a string' })
  for (const entry of logs) expect(entry).toHaveProperty('sessionId')
})
