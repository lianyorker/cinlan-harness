/** Verify actual Node module-cache replacement outside the Vitest transform cache. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'

it('hot replaces a module, persists its management change, and restarts from disk', async () => {
  const child = spawn(process.execPath, [
    '--expose-internals', '--import', 'tsx/esm',
    fileURLToPath(new URL('./hmr-module-child.ts', import.meta.url)),
  ], { cwd: fileURLToPath(new URL('../../../..', import.meta.url)), stdio: 'inherit' })
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await finished
  })
  expect(await finished).toBe(0)
}, 30_000)
