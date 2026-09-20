/** Build the shared boot page and Desktop renderer with installed Node tool entrypoints. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const appRoot = resolve(import.meta.dirname, '..')
const webRoot = dirname(require.resolve('@deepseek-ai/dsh-client-web/package.json'))
const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js')

for (const [cwd, args] of [
  [webRoot, [require.resolve('tsdown/run')]],
  [appRoot, [vite, 'build']],
]) {
  const result = spawnSync(process.execPath, args, { cwd, env: process.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`desktop renderer build: ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}
