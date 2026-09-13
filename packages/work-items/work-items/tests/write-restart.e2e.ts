/** Real SQLite and built-runtime process restart tests; no external API request is made. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../../../..', import.meta.url))
const worker = fileURLToPath(new URL('./fixtures/write-restart.mjs', import.meta.url))
const temporary: string[] = []
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'work-items-restart-'))
  temporary.push(path)
  return path
}
async function run(path: string, phase: string): Promise<{ status: string; effects: number }> {
  const result = await exec(process.execPath, [worker, root, path, phase], { timeout: 20_000, windowsHide: true })
  return JSON.parse(result.stdout.trim()) as { status: string; effects: number }
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Work Items write process recovery', () => {
  it('replays a durable success without a second external effect in the next process', async () => {
    const path = await directory()
    expect(await run(path, 'create')).toEqual({ status: 'succeeded', effects: 1 })
    expect(await run(path, 'resume')).toEqual({ status: 'succeeded', effects: 1 })
  })

  it('does not resend after process death between the external effect and the local receipt', async () => {
    const path = await directory()
    await expect(run(path, 'crash')).rejects.toMatchObject({ code: 17 })
    expect(await run(path, 'resume')).toEqual({ status: 'unknown', effects: 1 })
  })
})
