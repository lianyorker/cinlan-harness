/** Run isolated protocol and browser acceptance; this test entrypoint never connects to user targets. */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const workspace = fileURLToPath(new URL('../../../..', import.meta.url))
const evidence = join(workspace, '.artifacts', 'native-migration')
const commands = [
  ['node_modules/vitest/vitest.mjs', 'run',
    'packages/execution-host/execution-host-targets/tests', 'packages/api/execution-host-controller/tests'],
  ['node_modules/vitest/vitest.mjs', 'run', '--config',
    'packages/execution-host/execution-host-targets/tests/ssh-settings.vitest.config.ts'],
]
const results = []
for (const args of commands) {
  const startedAt = new Date().toISOString()
  const child = spawn(process.execPath, args, { cwd: workspace, env: process.env, stdio: 'inherit' })
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve(code ?? 1))
  })
  results.push({ command: 'node ' + args.join(' '), startedAt, finishedAt: new Date().toISOString(), exitCode })
  if (exitCode !== 0) break
}
await mkdir(evidence, { recursive: true })
await writeFile(join(evidence, 'stage4-ssh-integration-evidence.json'), JSON.stringify({
  scope: 'Authenticated SSH target management using isolated encrypted loopback and an actual CLI worker process',
  platform: process.platform, commands: results,
  passed: results.length === commands.length && results.every(result => result.exitCode === 0),
  externalRemoteHost: false, remotePosixEndpoint: false, remoteSessionAuthority: false,
  credentials: 'Generated temporary P-256 keys and isolated strict known-host files; removed by fixture teardown',
}, null, 2) + '\n')
process.exitCode = results.some(result => result.exitCode !== 0) ? 1 : 0
