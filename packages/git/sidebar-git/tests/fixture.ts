/** Real Loader and Git fixture; every repository, settings file, and process is test-owned. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ExecutionBindings from '@deepseek-ai/dsh-execution-binding'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as gitSettings from '@deepseek-ai/dsh-git-settings'
import { GIT_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-git-settings/settings-schema'
import type { GitSourceControlSettings } from '@deepseek-ai/dsh-git-settings/types'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import SidebarGit from '../src/index.ts'
import type { Config } from '../src/index.ts'

const exec = promisify(execFile)
/** Real local leases do not require SSH target management in this fixture. */
class LocalBindings extends ExecutionBindings { static override inject = ['sessionQuery', 'sessionProjections'] }

const contexts: Context[] = []
const roots: string[] = []
export const TEST_GIT_EXECUTABLE = 'sidebar-fixture-git'

class HermeticSubprocess extends LocalSubprocessRuntime {
  readonly resolutions: string[] = []
  readonly specs: SubprocessSpawnSpec[] = []

  constructor(ctx: Context, private readonly config: { globalConfig: string }) { super(ctx) }

  override resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    this.resolutions.push(command)
    return super.resolveExecutable(command === TEST_GIT_EXECUTABLE ? 'git' : command, env, signal)
  }

  override spawn(spec: SubprocessSpawnSpec) {
    const isolated = { ...spec, env: { ...spec.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: this.config.globalConfig } }
    this.specs.push(isolated)
    return super.spawn(isolated)
  }
}

/** Run fixture setup/assertion Git only inside a test-owned repository. */
export async function fixtureGit(repository: string, ...args: string[]): Promise<string> {
  if (!roots.some(root => repository.startsWith(root))) throw new Error('Git fixture path is not test-owned')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  const result = await exec('git', ['-C', repository, ...args], {
    env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  })
  return result.stdout
}

/** Boot the actual registered settings, Session, subprocess, and sidebar Git owners. */
export async function harness(
  preferences: Partial<GitSourceControlSettings> = {},
  options: {
    unborn?: boolean
    subdirectory?: boolean
    config?: Partial<Config>
    extra?: readonly { name: string; module: unknown }[]
  } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-sidebar-git-')))
  roots.push(root)
  const repository = join(root, 'repository')
  await mkdir(repository)
  await fixtureGit(repository, 'init', '--template=')
  await fixtureGit(repository, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  await fixtureGit(repository, 'config', 'user.name', 'Sidebar Test')
  await fixtureGit(repository, 'config', 'user.email', 'sidebar@example.invalid')
  await fixtureGit(repository, 'config', 'commit.gpgSign', 'false')
  await writeFile(join(repository, 'tracked.txt'), 'base\n')
  if (options.unborn !== true) {
    await fixtureGit(repository, 'add', '--all')
    await fixtureGit(repository, 'commit', '--quiet', '-m', 'base')
  }
  const globalConfig = join(root, 'gitconfig')
  const settingsPath = join(root, 'settings.json')
  await writeFile(globalConfig, '')
  await writeFile(settingsPath, JSON.stringify({ [GIT_SETTINGS_NAMESPACE]: preferences }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'sessions', name: '@deepseek-ai/dsh-session' },
    { id: 'query', name: 'session-query', config: { path: ':memory:', openAt: 'never' } },
    { id: 'projections', name: 'session-projections' },
    { id: 'bindings', name: 'execution-bindings' },
    { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath, watch: false } },
    { id: 'git-settings', name: '@deepseek-ai/dsh-git-settings' },
    { id: 'subprocess', name: 'test-subprocess', config: { globalConfig } },
    { id: 'sidebar-git', name: '@deepseek-ai/dsh-sidebar-git', config: options.config ?? {} },
    ...(options.extra ?? []).map(entry => ({ name: entry.name })),
  ]))
  const modules = new Map<string, unknown>([
    ['session-query', SessionQuery], ['session-projections', SessionProjectionRegistry],
    ['execution-bindings', LocalBindings],
    ['@deepseek-ai/dsh-session', SessionStore], ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-git-settings', gitSettings], ['test-subprocess', HermeticSubprocess], ['@deepseek-ai/dsh-sidebar-git', SidebarGit],
  ])
  for (const entry of options.extra ?? []) modules.set(entry.name, entry.module)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected fixture module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const cwd = options.subdirectory === true ? join(repository, 'nested') : repository
  if (options.subdirectory === true) await mkdir(cwd)
  const session = ctx.sessions.prepare(SessionId('sidebar-fixture'), { meta: { cwd } })
  const detach = ctx.sessions.enter(session)
  ctx.effect(() => detach)
  ctx.sessions.announce(session)
  const request = { sessionId: session.id }
  const service = ctx.sidebarGit
  const initial = await service.status(request)
  if (initial.repository === undefined) throw new Error('Fixture repository was not discovered')
  return { ctx, root, repository, session, detach, request, service, subprocess: ctx.subprocess as HermeticSubprocess,
    initial: initial.repository, mutation: { ...request, repositoryRoot: initial.repository.root } }
}

/** Drain owned processes before removing any test paths. */
export async function cleanup(): Promise<void> {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
