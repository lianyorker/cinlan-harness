/** Run the complete repository build and bind its client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  CLIENT_BUILD_PROFILE_SELECTOR,
  clientBuildProcessEnvironment,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

/** Execute one leaf build step through the invoking package manager. */
function runStep(args: readonly string[], environment: NodeJS.ProcessEnv): void {
  const invocation = pnpmInvocation(args, environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}

/**
 * Build every artifact before recording its public Client environment.
 * @param environment - Invoking package-manager lifecycle environment.
 * @param profile - Optional explicit Client build profile.
 */
export function buildRepository(environment: NodeJS.ProcessEnv, profile?: string): void {
  const root = resolve(import.meta.dirname, '..')
  const repositoryEnvironment = repositoryClientBuildEnvironment(root, environment)
  const selectedProfile = profile ?? environment[CLIENT_BUILD_PROFILE_SELECTOR]
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, selectedProfile)
  const buildEnvironment = clientBuildProcessEnvironment(environment, clientEnvironment)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  runStep(['run', 'build:native-system'], buildEnvironment)
  runStep(['run', 'build:lib:host'], buildEnvironment)
  runStep(['run', 'build:lib:client'], buildEnvironment)
  runStep(['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'], buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

/** Parse the supported build flags and execute the repository build. */
function main(): void {
  const { values } = parseArgs({ options: { profile: { type: 'string' } }, allowPositionals: false })
  buildRepository(process.env, values.profile)
}

if (import.meta.main) main()
