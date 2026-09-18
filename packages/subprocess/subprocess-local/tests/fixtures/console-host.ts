/** Runs the native Job path from a private host without an attached console. */
import koffi from 'koffi'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { targetEnvironment } from '../../src/runner-launch.ts'
import { bindManagedProcess } from '../../src/spawn.ts'
import { launchWindowsJob } from '../../src/windows-job.ts'

const kernel32 = koffi.load('kernel32.dll')
const freeConsole = kernel32.func('int __stdcall FreeConsole()')
const getConsoleWindow = kernel32.func('void * __stdcall GetConsoleWindow()')
freeConsole()
const window = getConsoleWindow() as bigint | null
if (window !== null && window !== 0n) throw new Error('fixture host still has an attached console')

const probe = process.argv[2]
if (probe === undefined) throw new Error('console probe path is required')
const script = `
  const { spawnSync } = require('node:child_process')
  const child = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' })
  if (child.error) throw child.error
  if (child.signal !== null) throw new Error('descendant ended with signal ' + child.signal)
  process.exitCode = child.status ?? 1
`
const request: SubprocessSpawnSpec = {
  argv: [process.execPath, '-e', script, ...process.execArgv, probe],
  cwd: process.cwd(),
  stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
  graceMs: 100,
}
const handle = bindManagedProcess(request, launchWindowsJob(request, targetEnvironment(request)))
try {
  const result = await handle.done
  process.stdout.write(handle.collected.stdout?.readFrom(0).text ?? '')
  process.stderr.write(handle.collected.stderr?.readFrom(0).text ?? '')
  process.exitCode = result.exitCode ?? 1
} finally {
  handle.terminate()
  await handle.waitForExit()
}
