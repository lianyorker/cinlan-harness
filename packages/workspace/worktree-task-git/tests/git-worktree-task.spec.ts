import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as gitSettings from '@deepseek-ai/dsh-git-settings'
import { GIT_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-git-settings/settings-schema'
import type { GitSourceControlSettings } from '@deepseek-ai/dsh-git-settings/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { WorktreeTaskError } from '@deepseek-ai/dsh-worktree-task'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import GitWorktreeTask from '../src/index.ts'
import { gitWorktreeTaskSpec } from '../src/spec.ts'

const execFileAsync = promisify(execFile)
const setupFixture = fileURLToPath(new URL('./fixtures/setup-hook.mjs', import.meta.url))
const roots: string[] = []
const contexts: Context[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  const result = await execFileAsync('git', ['-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  })
  return result.stdout
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function createRepository(): Promise<{ root: string; repository: string; managed: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-task-git-')))
  roots.push(root)
  const repository = join(root, 'repository')
  const managed = join(root, 'managed')
  await mkdir(repository)
  await git(repository, 'init', '--template=')
  await git(repository, 'config', 'user.name', 'Worktree Task Test')
  await git(repository, 'config', 'user.email', 'worktree-task-test@localhost')
  await writeFile(join(repository, 'tracked.txt'), 'base\n')
  await git(repository, 'add', '--all')
  await git(repository, 'commit', '-m', 'base')
  return { root, repository, managed }
}

async function harness(options: {
  repository?: string
  managed?: string
  pool?: MemoryMediaPool
  maxActiveCheckouts?: number
  maxOutputBytes?: number
  preferences?: Partial<GitSourceControlSettings>
  registerPreferences?: boolean
  backend?: 'json' | 'sqlite'
} = {}) {
  const paths = options.repository === undefined || options.managed === undefined
    ? await createRepository()
    : { root: '', repository: options.repository, managed: options.managed }
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  contexts.push(ctx)
  const fixtureRoot = dirname(paths.repository)
  const settingsPath = join(fixtureRoot, 'settings.json')
  if (options.preferences !== undefined) {
    await writeFile(settingsPath, JSON.stringify({ [GIT_SETTINGS_NAMESPACE]: options.preferences }))
  }
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', storageJson],
    ['@deepseek-ai/dsh-storage-sqlite', storageSqlite],
    ['@deepseek-ai/dsh-storage-domain', storageDomain],
    ['test-storage', {
      inject: ['storage'],
      apply(ctx: Context) {
        ctx.effect(() => ctx.storage.backend.register('memory', new MemoryStorageBackend(pool)))
        const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
        ctx.storage.mount('domain', facility)
        ctx.provide('storageDomain', facility)
      },
    }],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-git-settings', gitSettings],
    ['@deepseek-ai/dsh-worktree-task-git', GitWorktreeTask],
  ])
  const configPath = join(fixtureRoot, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    ...options.backend === undefined ? [{ id: 'test-storage', name: 'test-storage' }] : [
      { id: 'backend', name: '@deepseek-ai/dsh-storage-' + options.backend,
        config: options.backend === 'json' ? { root: join(fixtureRoot, 'storage') } : { path: join(fixtureRoot, 'storage.db') } },
      { id: 'domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: options.backend } },
    ],
    { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
    ...options.preferences === undefined ? [] : [
      { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath, watch: false } },
      ...options.registerPreferences === false ? [] : [{ id: 'git-settings', name: '@deepseek-ai/dsh-git-settings' }],
    ],
    { id: 'tasks', name: '@deepseek-ai/dsh-worktree-task-git', config: {
      root: paths.managed, maxActiveCheckouts: options.maxActiveCheckouts ?? 4, commandTimeoutMs: 30_000,
      ...options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes },
    } },
  ]))
  ctx.baseUrl = pathToFileURL(fixtureRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ...paths, ctx, pool, service: ctx.worktreeTask }
}

function onWorktreeAddExit(ctx: Context, afterExit: (argv: readonly string[]) => Promise<void>) {
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  return vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    const handle = spawn(spec)
    if (!spec.argv.some((value, index) => value === 'worktree' && spec.argv[index + 1] === 'add')) return handle
    return { ...handle, waitForExit: async (signal?: AbortSignal) => {
      const exited = await handle.waitForExit(signal)
      await handle.done
      // The real Git mutation and its process tree have finished before the provider sees settlement.
      if (exited) await afterExit(spec.argv)
      return exited
    } }
  })
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}, 90_000)

// Real Git worktree operations use the Windows lane's process and teardown budget.
describe('GitWorktreeTask', { timeout: 90_000 }, () => {
  it('uses schema defaults when Settings exists without the Git namespace', async () => {
    const h = await harness({ preferences: { branchPrefix: 'custom', branchPrefixCustom: 'ignored/' }, registerPreferences: false })
    expect(h.ctx.settings.get(GIT_SETTINGS_NAMESPACE)).toBeUndefined()
    const task = await h.service.create({ name: 'default', workspaceId: WorkspaceId('ws-default'), sourcePath: h.repository })
    expect(task.branch).toBe('dsh/task/' + task.id)
  })

  it.each(['team', 'team/', 'team/feature'])('creates a branch with custom prefix %j after canonicalizing a nested source', async (prefix) => {
    const h = await harness({ preferences: { branchPrefix: 'custom', branchPrefixCustom: prefix } })
    const source = join(h.repository, 'nested')
    await mkdir(source)
    await writeFile(join(source, 'file.txt'), 'nested\n')
    await git(h.repository, 'add', '--all')
    await git(h.repository, 'commit', '-m', 'nested base')
    const baseHead = (await git(h.repository, 'rev-parse', 'HEAD')).trim()
    const task = await h.service.create({ name: 'custom', workspaceId: WorkspaceId('ws-custom'), sourcePath: source })
    expect(task.branch).toBe(prefix + (prefix.endsWith('/') ? '' : '/') + 'dsh/task/' + task.id)
    expect(task).toMatchObject({ sourcePath: source, repositoryPath: h.repository, baseRef: 'HEAD', baseHead })
    expect(task.checkoutPath).toBe(join(h.managed, String(task.id), 'nested'))
    expect((await git(h.repository, 'rev-parse', 'refs/heads/' + task.branch)).trim()).toBe(baseHead)
    expect((await git(task.checkoutPath, 'symbolic-ref', '--short', 'HEAD')).trim()).toBe(task.branch)
  })

  it.each(['missing', 'file'] as const)('rolls back a task whose working directory is %s at the selected base', async (kind) => {
    const h = await harness()
    const source = join(h.repository, 'nested')
    if (kind === 'file') {
      await writeFile(source, 'not a directory\n')
      await git(h.repository, 'add', '--all')
      await git(h.repository, 'commit', '-m', 'file base')
    }
    const baseRef = (await git(h.repository, 'rev-parse', 'HEAD')).trim()
    if (kind === 'file') await unlink(source)
    await mkdir(source)
    await writeFile(join(source, 'file.txt'), 'nested\n')
    await git(h.repository, 'add', '--all')
    await git(h.repository, 'commit', '-m', 'directory source')
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    await expect(h.service.create({ name: 'invalid cwd', workspaceId: WorkspaceId('ws-cwd'), sourcePath: source, baseRef }))
      .rejects.toMatchObject({ code: 'invalid-path', message: expect.stringContaining('Task working directory') })
    expect(h.service.list()).toEqual([])
    expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
    expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
    expect(await readdir(h.managed)).toEqual(['.disabled-hooks'])
  })

  // Git for Windows may check out symlinks as files; live junction containment is exercised separately.
  it.skipIf(process.platform === 'win32')('refuses setup through a working-directory symlink in the selected base', async () => {
    const h = await harness()
    const outside = join(h.root, 'outside')
    const source = join(h.repository, 'nested')
    const marker = join(h.root, 'setup.jsonl')
    await mkdir(outside)
    await writeFile(join(outside, 'sentinel.txt'), 'preserve outside\n')
    await symlink(outside, source, 'dir')
    try {
      await git(h.repository, 'add', '--all')
      await git(h.repository, 'commit', '-m', 'linked base')
    } finally { await unlink(source) }
    const baseRef = (await git(h.repository, 'rev-parse', 'HEAD')).trim()
    await mkdir(source)
    await writeFile(join(source, 'file.txt'), 'nested\n')
    await git(h.repository, 'add', '--all')
    await git(h.repository, 'commit', '-m', 'directory source')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      setup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    await expect(h.service.create({ name: 'linked cwd', workspaceId: WorkspaceId('ws-linked-cwd'), sourcePath: source, baseRef }))
      .rejects.toMatchObject({ code: 'invalid-path' })
    expect(h.service.list()).toEqual([])
    expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
    expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('preserve outside\n')
  })

  it.each(['bind', 'activate', 'cleanup'] as const)('refuses %s after the working directory is redirected outside the checkout', async (operation) => {
    const h = await harness()
    const source = join(h.repository, 'nested')
    const outside = join(h.root, 'outside')
    const marker = join(h.root, 'cleanup.jsonl')
    await mkdir(source)
    await writeFile(join(source, 'file.txt'), 'nested\n')
    await git(h.repository, 'add', '--all')
    await git(h.repository, 'commit', '-m', 'nested source')
    await mkdir(outside)
    await writeFile(join(outside, 'sentinel.txt'), 'preserve outside\n')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const task = await h.service.create({ name: 'redirected', workspaceId: WorkspaceId('ws-redirected'), sourcePath: source })
    const sessionId = SessionId('existing-binding')
    if (operation === 'bind') await h.service.bindSession({ taskId: task.id, sessionId })
    await rm(task.checkoutPath, { recursive: true })
    await symlink(outside, task.checkoutPath, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const result = operation === 'bind' ? h.service.bindSession({ taskId: task.id, sessionId })
        : operation === 'activate' ? h.service.activate({ taskId: task.id }) : h.service.archive({ taskId: task.id })
      await expect(result).rejects.toMatchObject({ code: 'invalid-path' })
      expect(h.service.get(task.id).status).toBe('active')
      if (operation === 'cleanup') expect(h.service.get(task.id).cleanupReceipt?.status).toBe('failed')
      await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('preserve outside\n')
    } finally { await unlink(task.checkoutPath) }
  })

  it('rolls back reactivation when the checkpoint removed its working directory', async () => {
    const h = await harness()
    const source = join(h.repository, 'nested')
    await mkdir(source)
    await writeFile(join(source, 'file.txt'), 'nested\n')
    await git(h.repository, 'add', '--all')
    await git(h.repository, 'commit', '-m', 'nested source')
    const task = await h.service.create({ name: 'removed cwd', workspaceId: WorkspaceId('ws-removed-cwd'), sourcePath: source })
    await rm(task.checkoutPath, { recursive: true })
    const hibernated = await h.service.hibernate({ taskId: task.id })
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    for (const result of [() => h.service.activate({ taskId: task.id }),
      () => h.service.bindSession({ taskId: task.id, sessionId: SessionId('missing-cwd') })]) {
      await expect(result()).rejects.toMatchObject({ code: 'invalid-path' })
      expect(h.service.get(task.id)).toEqual(hibernated)
      expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
      expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
      await expect(stat(dirname(task.checkoutPath))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('refuses reactivation through a redirected default directory after restart', async () => {
    const h = await harness()
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value, defaultDirectory: 'team/tasks' } })
    const task = await h.service.create({ name: 'linked parent', workspaceId: WorkspaceId('ws-parent'), sourcePath: h.repository })
    const hibernated = await h.service.hibernate({ taskId: task.id })
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const outside = join(h.root, 'outside')
    const parent = dirname(task.checkoutPath)
    await mkdir(outside)
    await rm(parent, { recursive: true })
    await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      const restarted = await harness({ repository: h.repository, managed: h.managed, pool: h.pool })
      const refs = await git(h.repository, 'show-ref', '--heads')
      const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
      await expect(restarted.service.activate({ taskId: task.id })).rejects.toMatchObject({ code: 'invalid-path' })
      expect(restarted.service.get(task.id)).toEqual(hibernated)
      expect(await readdir(outside)).toEqual([])
      expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
      expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
    } finally { await unlink(parent) }
  })

  it.each(['active', 'hibernated'] as const)('preserves an %s task when defaults place a new checkout inside its reserved root', async (status) => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const first = await h.service.create({ name: 'reserved', workspaceId: WorkspaceId('ws-reserved'), sourcePath: h.repository })
    await writeFile(join(first.checkoutPath, 'tracked.txt'), 'preserve task work\n')
    const expected = status === 'hibernated' ? await h.service.hibernate({ taskId: first.id }) : first
    const marker = join(h.root, 'setup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      defaultDirectory: first.id + '/nested',
      setup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    await expect(h.service.create({ name: 'overlapping', workspaceId: WorkspaceId('ws-overlapping'), sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('overlaps the reserved checkout') })
    expect(h.service.list()).toEqual([expected])
    expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
    expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    if (status === 'active') expect(await readFile(join(first.checkoutPath, 'tracked.txt'), 'utf8')).toBe('preserve task work\n')
    else await expect(stat(first.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['', 'bad prefix', 'bad..prefix', '-option', 'team//', 'team.lock/'])('rejects custom prefix %j without hibernating another task', async (prefix) => {
    const h = await harness({ maxActiveCheckouts: 1, preferences: {} })
    const first = await h.service.create({ name: 'existing', workspaceId: WorkspaceId('ws-prefix'), sourcePath: h.repository })
    await writeFile(join(first.checkoutPath, 'tracked.txt'), 'unsaved task work\n')
    await h.ctx.settings.update(GIT_SETTINGS_NAMESPACE, { branchPrefix: 'custom', branchPrefixCustom: prefix })
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    await expect(h.service.create({ name: 'invalid', workspaceId: WorkspaceId('ws-prefix'), sourcePath: h.repository }))
      .rejects.toThrow('valid custom branch prefix')
    expect(h.service.list()).toEqual([first])
    expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
    expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
    expect(await readFile(join(first.checkoutPath, 'tracked.txt'), 'utf8')).toBe('unsaved task work\n')
  })

  it.each([
    { github: 'octocat', username: 'fallback', expected: 'octocat' },
    { github: undefined, username: 'local-login', expected: 'local-login' },
  ])('resolves only local Git username keys in priority order: %j', async ({ github, username, expected }) => {
    const h = await harness({ preferences: { branchPrefix: 'git-username' } })
    if (github !== undefined) await git(h.repository, 'config', '--local', 'github.user', github)
    await git(h.repository, 'config', '--local', 'user.username', username)
    const task = await h.service.create({ name: 'username', workspaceId: WorkspaceId('ws-username'), sourcePath: h.repository })
    expect(task.branch).toBe(expected + '/dsh/task/' + task.id)
  })

  it.each([undefined, '', 'invalid user', 'trailing '])('rejects missing or invalid local username %j without falling back to user.name', async (username) => {
    const h = await harness({ preferences: { branchPrefix: 'git-username' } })
    if (username !== undefined) {
      await git(h.repository, 'config', '--local', 'github.user', username)
      await git(h.repository, 'config', '--local', 'user.username', 'valid-fallback')
    }
    const refs = await git(h.repository, 'show-ref', '--heads')
    await expect(h.service.create({ name: 'username', workspaceId: WorkspaceId('ws-username'), sourcePath: h.repository }))
      .rejects.toThrow('git config --local')
    expect(h.service.list()).toEqual([])
    expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
    expect((await git(h.repository, 'worktree', 'list', '--porcelain')).match(/^worktree /gm)).toHaveLength(1)
  })

  it('does not obtain a username from included config files', async () => {
    const h = await harness({ preferences: { branchPrefix: 'git-username' } })
    const includePath = join(h.root, 'included.gitconfig')
    await writeFile(includePath, '[github]\n  user = included-user\n')
    await git(h.repository, 'config', '--local', 'include.path', includePath)
    await expect(h.service.create({ name: 'included', workspaceId: WorkspaceId('ws-include'), sourcePath: h.repository }))
      .rejects.toThrow('requires repository-local')
  })

  it('keeps recorded branches across preference changes, checkpoints, and provider restart', async () => {
    const h = await harness({ preferences: {} })
    const baseHead = (await git(h.repository, 'rev-parse', 'HEAD')).trim()
    const original = await h.service.create({ name: 'original', workspaceId: WorkspaceId('ws-recorded'), sourcePath: h.repository })
    await h.ctx.settings.update(GIT_SETTINGS_NAMESPACE, {
      branchPrefix: 'custom', branchPrefixCustom: 'team/', enableGitHubAttribution: true, refreshLocalBaseRefOnWorktreeCreate: true,
    })
    const next = await h.service.create({ name: 'prefixed', workspaceId: WorkspaceId('ws-recorded'), sourcePath: h.repository })
    expect(original.branch).toBe('dsh/task/' + original.id)
    expect(next.branch).toBe('team/dsh/task/' + next.id)
    await git(h.repository, 'config', '--local', 'commit.gpgSign', 'true')
    await git(h.repository, 'config', '--local', 'gpg.program', join(h.root, 'missing-signer'))
    await writeFile(join(original.checkoutPath, 'tracked.txt'), 'checkpoint work\n')
    await h.service.hibernate({ taskId: original.id })
    expect(await git(h.repository, 'log', '-1', '--format=%B', original.branch)).not.toContain('Co-authored-by:')
    await h.ctx.settings.update(GIT_SETTINGS_NAMESPACE, { branchPrefix: 'git-username' })
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const restarted = await harness({ repository: h.repository, managed: h.managed, pool: h.pool, preferences: { branchPrefix: 'git-username' } })
    const active = await restarted.service.activate({ taskId: original.id })
    expect(active.branch).toBe(original.branch)
    expect(restarted.service.get(next.id).branch).toBe(next.branch)
    expect(await readFile(join(active.checkoutPath, 'tracked.txt'), 'utf8')).toBe('checkpoint work\n')
    expect((await git(h.repository, 'rev-parse', 'HEAD')).trim()).toBe(baseHead)
  })

  it('creates a task with a branch and worktree from a clean source', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-1')
    const task = await h.service.create({
      name: 'task-1',
      workspaceId,
      sourcePath: h.repository,
    })
    expect(task.status).toBe('active')
    expect(task.name).toBe('task-1')
    expect(task.workspaceId).toBe(workspaceId)
    expect(task.sourcePath).toBe(h.repository)
    expect(task.branch).toMatch(/^dsh\/task\//)
    expect(await readFile(join(task.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(await stat(task.checkoutPath)).toMatchObject({})
  })

  it('rolls back a completed worktree add when cancellation arrives before publication', async () => {
    const h = await harness()
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    const controller = new AbortController()
    const reason = new Error('cancel after worktree add')
    let materialized: string | undefined
    const spy = onWorktreeAddExit(h.ctx, async (argv) => {
      materialized = await readFile(join(argv.at(-2)!, 'tracked.txt'), 'utf8')
      controller.abort(reason)
    })
    try {
      await expect(h.service.create({ name: 'cancelled add', workspaceId: WorkspaceId('ws-add-cancel'), sourcePath: h.repository }, controller.signal))
        .rejects.toBe(reason)
      expect(materialized).toBe('base\n')
      expect(h.service.list()).toEqual([])
      expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
      expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
      expect(await readdir(h.managed)).toEqual(['.disabled-hooks'])
    } finally { spy.mockRestore() }
  })

  it('retains and identifies the allocated checkout when worktree add settlement is unknown', async () => {
    const h = await harness()
    let allocated: { checkoutRoot: string; branch: string } | undefined
    const spy = onWorktreeAddExit(h.ctx, async (argv) => {
      allocated = { checkoutRoot: argv.at(-2)!, branch: argv[argv.indexOf('-b') + 1]! }
      expect(await readFile(join(allocated.checkoutRoot, 'tracked.txt'), 'utf8')).toBe('base\n')
      throw new Error('worktree add observation failed')
    })
    try {
      const error: unknown = await h.service.create({ name: 'unknown add', workspaceId: WorkspaceId('ws-add-unknown'), sourcePath: h.repository })
        .then(() => undefined, (reason: unknown) => reason)
      expect(allocated).toBeDefined()
      expect(error).toBeInstanceOf(WorktreeTaskError)
      if (!(error instanceof WorktreeTaskError)) throw new Error('Expected an unsettled task error')
      expect(error.context).toMatchObject({ settlement: 'unknown', taskId: basename(allocated!.checkoutRoot), ...allocated! })
      expect(error.message).toContain(allocated!.branch)
      expect(error.message).toContain(allocated!.checkoutRoot)
      expect(error.message).toContain(basename(allocated!.checkoutRoot))
      expect(h.service.list()).toEqual([])
      expect(await readFile(join(allocated!.checkoutRoot, 'tracked.txt'), 'utf8')).toBe('base\n')
      expect(await git(h.repository, 'show-ref', '--verify', 'refs/heads/' + allocated!.branch)).toContain(allocated!.branch)
      expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toContain('branch refs/heads/' + allocated!.branch)
    } finally { spy.mockRestore() }
  })

  it('preserves unrelated occupancy when cancellation prevents publication after worktree add', async () => {
    const h = await harness()
    const controller = new AbortController()
    let allocated: { checkoutRoot: string; branch: string } | undefined
    const spy = onWorktreeAddExit(h.ctx, async (argv) => {
      allocated = { checkoutRoot: argv.at(-2)!, branch: argv[argv.indexOf('-b') + 1]! }
      await git(h.repository, 'worktree', 'remove', '--force', allocated.checkoutRoot)
      await mkdir(allocated.checkoutRoot)
      await writeFile(join(allocated.checkoutRoot, 'unrelated.txt'), 'preserve unrelated directory\n')
      controller.abort(new Error('cancel after checkout replacement'))
    })
    try {
      await expect(h.service.create({ name: 'replaced add', workspaceId: WorkspaceId('ws-add-replaced'), sourcePath: h.repository }, controller.signal))
        .rejects.toThrow('could not fully roll back worktree task')
      expect(allocated).toBeDefined()
      expect(h.service.list()).toEqual([])
      expect(await readFile(join(allocated!.checkoutRoot, 'unrelated.txt'), 'utf8')).toBe('preserve unrelated directory\n')
      expect(await git(h.repository, 'show-ref', '--verify', 'refs/heads/' + allocated!.branch)).toContain(allocated!.branch)
    } finally { spy.mockRestore() }
  })

  it('runs captured setup argv in the checkout before publishing the task', async () => {
    const h = await harness()
    const args = ['two words', 'literal;$value', '--task-option']
    const defaults = h.service.settings()
    await h.service.updateSettings({
      expectedRevision: defaults.revision,
      value: { ...defaults.value, setup: { executable: process.execPath, args: [setupFixture, 'record', ...args] } },
    })
    const task = await h.service.create({ name: 'setup', workspaceId: WorkspaceId('ws-setup'), sourcePath: h.repository })
    const outputPath = join(task.checkoutPath, 'setup-results.jsonl')
    const output = await readFile(outputPath, 'utf8')
    expect(JSON.parse(output.trim())).toEqual({ cwd: task.checkoutPath, args })
    expect(h.service.get(task.id)).toEqual(task)
    await expect(stat(join(h.repository, 'setup-results.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await h.service.review(task.id)).setup).toMatchObject({ args: [setupFixture, 'record', ...args] })

    const saved = h.service.settings()
    await h.service.updateSettings({ expectedRevision: saved.revision, value: { ...saved.value, setup: null } })
    await h.service.hibernate({ taskId: task.id })
    await h.service.activate({ taskId: task.id })
    expect(await readFile(outputPath, 'utf8')).toBe(output)
  })

  it.each(['fail', 'stdout-overflow', 'stderr-overflow'])('rolls back checkout and branch when setup reports %s', async (mode) => {
    const h = await harness({ maxOutputBytes: 4096 })
    const defaults = h.service.settings()
    await h.service.updateSettings({
      expectedRevision: defaults.revision,
      value: { ...defaults.value, setup: { executable: process.execPath, args: [setupFixture, mode] } },
    })
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    await expect(h.service.create({ name: 'failed setup', workspaceId: WorkspaceId('ws-setup-failure'), sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'operation-failed', message: expect.stringContaining('setup hook failed:') })
    expect(h.service.list()).toEqual([])
    expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
    expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
    expect(await readdir(h.managed)).toEqual(['.disabled-hooks'])
  })

  it.each(['cancel', 'timeout'] as const)('waits for setup and its descendant to exit on %s before rollback', async (stop) => {
    const h = await harness()
    const readyPath = join(h.root, 'setup-ready.json')
    const defaults = h.service.settings()
    await h.service.updateSettings({
      expectedRevision: defaults.revision,
      value: { ...defaults.value, setup: { executable: process.execPath, args: [setupFixture, 'wait', readyPath] } },
    })
    const refs = await git(h.repository, 'show-ref', '--heads')
    const worktrees = await git(h.repository, 'worktree', 'list', '--porcelain')
    const controller = new AbortController()
    const reason = new Error('cancel setup after readiness')
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
    let lastDeadline: AbortController | undefined
    const timeoutSpy = stop === 'timeout' ? vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      lastDeadline = new AbortController()
      return AbortSignal.any([originalTimeout(milliseconds), lastDeadline.signal])
    }) : undefined
    const outcome = h.service.create({ name: 'stopped setup', workspaceId: WorkspaceId('ws-setup-stop'), sourcePath: h.repository }, controller.signal)
      .then(task => ({ task }), (error: unknown) => ({ error }))
    try {
      await expect.poll(async () => {
        try { return await readFile(readyPath, 'utf8') } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
          throw error
        }
      }, { timeout: 30_000 }).not.toBe('')
      const ready = JSON.parse(await readFile(readyPath, 'utf8')) as { parentPid: number; childPid: number }
      expect(h.service.list()).toEqual([])
      if (stop === 'cancel') controller.abort(reason)
      else {
        // Readiness is emitted inside setup after its deadline is armed; no later provider command can run yet.
        expect(lastDeadline).toBeDefined()
        lastDeadline!.abort(new DOMException('fixture deadline', 'TimeoutError'))
      }
      const result = await outcome
      if (stop === 'cancel') expect(result).toEqual({ error: reason })
      else expect(result).toMatchObject({ error: { code: 'operation-failed', message: 'setup hook timed out after 30000ms' } })
      for (const pid of [ready.parentPid, ready.childPid]) {
        expect(processExists(pid)).toBe(false)
      }
      expect(h.service.list()).toEqual([])
      expect(await git(h.repository, 'show-ref', '--heads')).toBe(refs)
      expect(await git(h.repository, 'worktree', 'list', '--porcelain')).toBe(worktrees)
      expect(await readdir(h.managed)).toEqual(['.disabled-hooks'])
    } finally {
      controller.abort(reason)
      await outcome
      timeoutSpy?.mockRestore()
    }
  })

  it('saves defaults without execution, rejects stale edits, and reviews tracked and untracked work', async () => {
    const h = await harness()
    const marker = join(h.root, 'cleanup.jsonl')
    const original = h.service.settings()
    const value = { defaultDirectory: 'team/tasks', baseRef: 'HEAD', setup: null,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker, 'literal ; $', ''] } }
    await expect(h.service.updateSettings({ expectedRevision: original.revision, value })).resolves.toMatchObject({ revision: 1, value })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(h.service.updateSettings({ expectedRevision: original.revision, value })).rejects.toMatchObject({ code: 'conflict' })
    for (const defaultDirectory of ['../escape', '/absolute', 'C:\\escape', '.disabled-hooks', 'nested/../escape']) {
      await expect(h.service.updateSettings({ expectedRevision: 1, value: { ...value, defaultDirectory } })).rejects.toThrow('relative child')
    }
    const task = await h.service.create({ name: 'configured', workspaceId: WorkspaceId('ws-defaults'), sourcePath: h.repository })
    expect(task.checkoutPath).toBe(join(h.managed, 'team', 'tasks', task.id))
    await writeFile(join(task.checkoutPath, 'tracked.txt'), 'staged\n')
    await git(task.checkoutPath, 'add', 'tracked.txt')
    await writeFile(join(task.checkoutPath, 'tracked.txt'), 'unstaged\n')
    await writeFile(join(task.checkoutPath, 'private.txt'), 'untracked contents\n')
    const review = await h.service.review(task.id)
    expect(review.patch).toContain('+unstaged')
    expect(review.patch).not.toContain('untracked contents')
    expect(review.untracked).toEqual(['private.txt'])
    expect(review).toMatchObject({ dirty: true, cleanup: { args: value.cleanup.args } })
    await h.service.updateSettings({ expectedRevision: 1, value: { ...value, cleanup: null } })
    expect((await h.service.review(task.id)).cleanup).toEqual(review.cleanup)
    expect(await git(task.checkoutPath, 'diff', '--cached')).toContain('+staged')
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds the complete review rather than returning a truncated patch', async () => {
    const h = await harness({ maxOutputBytes: 4096 })
    const task = await h.service.create({ name: 'large', workspaceId: WorkspaceId('ws-review'), sourcePath: h.repository })
    await writeFile(join(task.checkoutPath, 'tracked.txt'), 'x'.repeat(8192))
    await expect(h.service.review(task.id)).rejects.toThrow('exceeded')
    expect(h.service.get(task.id).status).toBe('active')
  })

  it.each(['archive', 'delete'] as const)('runs cleanup only for explicit %s and retains a receipt after deletion', async (operation) => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const marker = join(h.root, 'cleanup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker, 'two words', ''] } } })
    const task = await h.service.create({ name: 'cleanup', workspaceId: WorkspaceId('ws-cleanup'), sourcePath: h.repository })
    await h.service.create({ name: 'capacity', workspaceId: WorkspaceId('ws-cleanup'), sourcePath: h.repository })
    expect(h.service.get(task.id).status).toBe('hibernated')
    await h.service.activate({ taskId: task.id })
    await h.service.hibernate({ taskId: task.id })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    const result = await h.service[operation]({ taskId: task.id })
    expect(result.cleanupReceipt).toMatchObject({ status: 'succeeded', operation })
    expect(JSON.parse((await readFile(marker, 'utf8')).trim())).toEqual({ cwd: task.checkoutPath, args: ['two words', ''] })
    if (operation === 'archive') {
      await h.service.archive({ taskId: task.id })
      await h.ctx.fiber.dispose()
      contexts.splice(contexts.indexOf(h.ctx), 1)
      const restarted = await harness({ repository: h.repository, managed: h.managed, pool: h.pool })
      expect(restarted.service.get(task.id).cleanupReceipt).toEqual(result.cleanupReceipt)
      await expect(restarted.service.delete({ taskId: task.id })).resolves.toMatchObject({ deleted: true })
    }
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(h.pool.media.get('worktree_tasks_git')?.tables.get('cleanup_receipts')?.get(task.id)).toEqual(result.cleanupReceipt)
    expect(h.pool.media.get('worktree_tasks_git')?.tables.get('tasks')?.has(task.id)).toBe(false)
    await expect(stat(task.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['fail', 'stdout-overflow', 'stderr-overflow'])('retains dirty checkout and a failed receipt when cleanup reports %s', async (mode) => {
    const h = await harness({ maxOutputBytes: 4096, maxActiveCheckouts: 1 })
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, mode] } } })
    const task = await h.service.create({ name: 'failure', workspaceId: WorkspaceId('ws-cleanup-failure'), sourcePath: h.repository })
    await writeFile(join(task.checkoutPath, 'tracked.txt'), 'preserve me\n')
    await expect(h.service.archive({ taskId: task.id })).rejects.toThrow('cleanup hook failed:')
    expect(h.service.get(task.id)).toMatchObject({ status: 'active', cleanupReceipt: { status: 'failed' } })
    expect(await readFile(join(task.checkoutPath, 'tracked.txt'), 'utf8')).toBe('preserve me\n')
    await expect(h.service.create({ name: 'capacity', workspaceId: WorkspaceId('ws-capacity'), sourcePath: h.repository })).rejects.toThrow('in use')
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const restarted = await harness({ repository: h.repository, managed: h.managed, pool: h.pool })
    expect(restarted.service.get(task.id)).toMatchObject({ status: 'active', cleanupReceipt: { status: 'failed' } })
    expect(await readFile(join(task.checkoutPath, 'tracked.txt'), 'utf8')).toBe('preserve me\n')
  })

  it('retries settled cleanup failure only after another explicit request', async () => {
    const h = await harness()
    const marker = join(h.root, 'cleanup-attempts')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'fail-once', marker] } } })
    const task = await h.service.create({ name: 'retry', workspaceId: WorkspaceId('ws-retry'), sourcePath: h.repository })
    await expect(h.service.delete({ taskId: task.id })).rejects.toThrow('cleanup refused')
    expect(h.service.get(task.id).cleanupReceipt?.status).toBe('failed')
    expect(await readFile(marker, 'utf8')).toBe('attempt\n')
    await expect(h.service.delete({ taskId: task.id })).resolves.toMatchObject({ deleted: true, cleanupReceipt: { status: 'succeeded' } })
    expect(await readFile(marker, 'utf8')).toBe('attempt\nattempt\n')
  })

  it('does not execute without a durable claim and refuses rerun after a lost success write', async () => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const marker = join(h.root, 'cleanup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const task = await h.service.create({ name: 'claim', workspaceId: WorkspaceId('ws-claim'), sourcePath: h.repository })
    h.pool.failNextWrites = 1
    await expect(h.service.archive({ taskId: task.id })).rejects.toThrow('injected write failure')
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(h.service.get(task.id).cleanupReceipt).toBeUndefined()
    const release = h.ctx.on('domain/changed', (change) => {
      if (change.domain === 'worktree_tasks_git' && change.table === 'cleanup_receipts') h.pool.failNextWrites = 1
    })
    try { await expect(h.service.archive({ taskId: task.id })).rejects.toThrow('injected write failure') } finally { release() }
    expect(h.service.get(task.id)).toMatchObject({ status: 'active', cleanupReceipt: { status: 'running' } })
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const restarted = await harness({ repository: h.repository, managed: h.managed, pool: h.pool, maxActiveCheckouts: 1 })
    for (const operation of ['archive', 'delete', 'hibernate', 'activate'] as const) {
      await expect(restarted.service[operation]({ taskId: task.id })).rejects.toThrow('unsettled receipt')
    }
    await expect(restarted.service.create({ name: 'capacity', workspaceId: WorkspaceId('ws-claim'), sourcePath: h.repository })).rejects.toThrow('in use')
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(await stat(task.checkoutPath)).toMatchObject({})
  })

  it.each(['cancel', 'timeout', 'dispose'] as const)('waits for cleanup descendants on %s and retains the checkout', async (stop) => {
    const h = await harness()
    const readyPath = join(h.root, 'cleanup-ready.json')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'wait', readyPath] } } })
    const task = await h.service.create({ name: 'stopped', workspaceId: WorkspaceId('ws-cleanup-stop'), sourcePath: h.repository })
    const controller = new AbortController()
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal)
    let deadline: AbortController | undefined
    const timeoutSpy = stop === 'timeout' ? vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      deadline = new AbortController()
      return AbortSignal.any([originalTimeout(milliseconds), deadline.signal])
    }) : undefined
    const outcome = h.service.archive({ taskId: task.id }, controller.signal).then(value => ({ value }), (error: unknown) => ({ error }))
    let disposal: Promise<unknown> | undefined
    try {
      await expect.poll(async () => {
        try { return await readFile(readyPath, 'utf8') } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
          throw error
        }
      }, { timeout: 30_000 }).not.toBe('')
      const ready = JSON.parse(await readFile(readyPath, 'utf8')) as { parentPid: number; childPid: number }
      expect(h.service.get(task.id).cleanupReceipt?.status).toBe('running')
      if (stop === 'cancel') controller.abort(new Error('cancel cleanup'))
      else if (stop === 'timeout') deadline!.abort(new DOMException('fixture deadline', 'TimeoutError'))
      else disposal = h.ctx.fiber.dispose()
      expect(await outcome).toHaveProperty('error')
      if (disposal !== undefined) { await disposal; contexts.splice(contexts.indexOf(h.ctx), 1) }
      for (const pid of [ready.parentPid, ready.childPid]) expect(processExists(pid)).toBe(false)
      expect(await readFile(join(task.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
      expect(h.pool.media.get('worktree_tasks_git')?.tables.get('cleanup_receipts')?.get(task.id)).toMatchObject({ status: 'failed' })
    } finally {
      controller.abort()
      await outcome
      await disposal
      timeoutSpy?.mockRestore()
    }
  })

  it.each(['json', 'sqlite'] as const)('opens existing v1 %s storage through Loader and keeps receipts after task deletion', async (backend) => {
    const h = await harness()
    const marker = join(h.root, 'cleanup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: defaults.revision, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const task = await h.service.create({ name: 'existing v1', workspaceId: WorkspaceId('ws-v1'), sourcePath: h.repository })
    await h.service.hibernate({ taskId: task.id })
    const medium = h.pool.media.get('worktree_tasks_git')!
    const openBackend = () => backend === 'json' ? new storageJson.JsonStorageBackend(join(h.root, 'storage'))
      : new storageSqlite.SqliteStorageBackend(new storageSqlite.Config({ path: join(h.root, 'storage.db') }))
    const seed = openBackend()
    try {
      const unit = await seed.kv.open({ name: 'worktree_tasks_git', version: 1, tables: ['tasks'], hasGlobal: true })
      await unit.setGlobal(medium.global)
      await unit.putRecord('tasks', task.id, medium.tables.get('tasks')!.get(task.id))
    } finally { await seed.close() }
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const loaded = await harness({ repository: h.repository, managed: h.managed, backend })
    expect(loaded.service.get(task.id).cleanupReceipt).toBeUndefined()
    expect(loaded.service.settings()).toMatchObject({ revision: 1 })
    await expect(loaded.service.delete({ taskId: task.id })).resolves.toMatchObject({ deleted: true, cleanupReceipt: { status: 'succeeded' } })
    await loaded.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(loaded.ctx), 1)
    const reopened = openBackend()
    try {
      const unit = await reopened.kv.open({ name: 'worktree_tasks_git', version: 1, tables: ['tasks', 'cleanup_receipts'], hasGlobal: true })
      const stored = await unit.loadAll()
      expect(stored.tables.tasks?.[task.id]).toBeUndefined()
      expect(stored.tables.cleanup_receipts?.[task.id]).toMatchObject({ status: 'succeeded', operation: 'delete' })
      expect(stored.global).toEqual(medium.global)
    } finally { await reopened.close() }
  })

  it('does not retry cleanup with an unobserved process-tree result', async () => {
    const h = await harness()
    const marker = join(h.root, 'cleanup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: 0, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const task = await h.service.create({ name: 'unknown', workspaceId: WorkspaceId('ws-unknown'), sourcePath: h.repository })
    const spawn = h.ctx.subprocess.spawn.bind(h.ctx.subprocess)
    const spy = vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      const handle = spawn(spec)
      if (!spec.argv.includes('external-record')) return handle
      return { ...handle, waitForExit: async () => { await handle.waitForExit(); throw new Error('tree observation failed') } }
    })
    try {
      await expect(h.service.archive({ taskId: task.id })).rejects.toThrow('did not settle')
      expect(h.service.get(task.id).cleanupReceipt?.status).toBe('running')
      await expect(h.service.delete({ taskId: task.id })).rejects.toThrow('unsettled receipt')
      expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1)
      expect(await readFile(join(task.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally { spy.mockRestore() }
  })

  it('finishes archiving after a saved cleanup success without allowing renewed session work', async () => {
    const h = await harness()
    const marker = join(h.root, 'cleanup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: 0, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const task = await h.service.create({ name: 'settled', workspaceId: WorkspaceId('ws-settled'), sourcePath: h.repository })
    const controller = new AbortController()
    const release = h.ctx.on('domain/changed', (change) => {
      if (change.table === 'cleanup_receipts' && change.operation === 'put'
        && gitWorktreeTaskSpec.tables.cleanup_receipts.valueSchema.parse(change.value).status === 'succeeded') controller.abort()
    })
    try { await expect(h.service.archive({ taskId: task.id }, controller.signal)).rejects.toThrow() } finally { release() }
    expect(h.service.get(task.id)).toMatchObject({ status: 'active', cleanupReceipt: { status: 'succeeded' } })
    await expect(h.service.bindSession({ taskId: task.id, sessionId: SessionId('no-resume') })).rejects.toThrow('already succeeded')
    await expect(h.service.activate({ taskId: task.id })).rejects.toThrow('already succeeded')
    await h.service.hibernate({ taskId: task.id })
    await expect(h.service.activate({ taskId: task.id })).rejects.toThrow('already succeeded')
    await expect(h.service.archive({ taskId: task.id })).resolves.toMatchObject({ status: 'archived' })
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('keeps legacy no-hook and archived records free from retroactive cleanup', async () => {
    const h = await harness()
    const marker = join(h.root, 'cleanup.jsonl')
    const defaults = h.service.settings()
    await h.service.updateSettings({ expectedRevision: 0, value: { ...defaults.value,
      cleanup: { executable: process.execPath, args: [setupFixture, 'external-record', marker] } } })
    const first = await h.service.create({ name: 'old no-hook', workspaceId: WorkspaceId('ws-legacy'), sourcePath: h.repository })
    const second = await h.service.create({ name: 'old archived', workspaceId: WorkspaceId('ws-legacy'), sourcePath: h.repository })
    await h.service.hibernate({ taskId: first.id })
    await h.service.hibernate({ taskId: second.id })
    await h.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(h.ctx), 1)
    const tasks = h.pool.media.get('worktree_tasks_git')!.tables.get('tasks')!
    const noHook = gitWorktreeTaskSpec.tables.tasks.valueSchema.parse(tasks.get(first.id))
    delete noHook.launch
    tasks.set(first.id, noHook)
    tasks.set(second.id, { ...gitWorktreeTaskSpec.tables.tasks.valueSchema.parse(tasks.get(second.id)), status: 'archived' })
    const loaded = await harness({ repository: h.repository, managed: h.managed, pool: h.pool })
    await loaded.service.delete({ taskId: first.id })
    await loaded.service.delete({ taskId: second.id })
    await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lists created tasks', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-list')
    await h.service.create({ name: 'task-a', workspaceId, sourcePath: h.repository })
    await h.service.create({ name: 'task-b', workspaceId, sourcePath: h.repository })
    const tasks = h.service.list()
    expect(tasks).toHaveLength(2)
    expect(tasks.map(t => t.name).sort()).toEqual(['task-a', 'task-b'])
  })

  it('gets a task by id', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-get')
    const created = await h.service.create({ name: 'task-get', workspaceId, sourcePath: h.repository })
    const found = h.service.get(created.id)
    expect(found).toBeDefined()
    expect(found.id).toBe(created.id)
    expect(() => h.service.get(WorktreeTaskIdLike('nonexistent'))).toThrow(WorktreeTaskError)
  })

  it.each(['staged', 'unstaged', 'untracked'])('refuses to create from a source with %s changes', async (kind) => {
    const h = await harness()
    await writeFile(join(h.repository, kind === 'untracked' ? 'untracked.txt' : 'tracked.txt'), 'local\n')
    if (kind === 'staged') await git(h.repository, 'add', '--all')
    await expect(h.service.create({
      name: 'dirty',
      workspaceId: WorkspaceId('ws-dirty'),
      sourcePath: h.repository,
    })).rejects.toMatchObject({ code: 'git-failed' } satisfies Partial<WorktreeTaskError>)
  })

  it('binds and unbinds sessions', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-bind')
    const task = await h.service.create({ name: 'task-bind', workspaceId, sourcePath: h.repository })
    const sessionId = SessionId('session-1')
    const result = await h.service.bindSession({ taskId: task.id, sessionId })
    expect(result.task.sessionIds).toContain(sessionId)
    expect(result.checkoutPath).toBe(task.checkoutPath)
    expect(h.service.findForSession(sessionId)?.id).toBe(task.id)

    const after = await h.service.unbindSession(task.id, sessionId)
    expect(after.sessionIds).not.toContain(sessionId)
    expect(h.service.findForSession(sessionId)).toBeUndefined()
  })

  it('hibernates and reactivates a task checkout', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-hibernate')
    const task = await h.service.create({ name: 'task-hib', workspaceId, sourcePath: h.repository })
    const hibernated = await h.service.hibernate({ taskId: task.id })
    expect(hibernated.status).toBe('hibernated')
    await expect(stat(task.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const reactivated = await h.service.activate({ taskId: task.id })
    expect(reactivated.status).toBe('active')
    expect(await readFile(join(reactivated.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
  })

  it('refuses to hibernate a task with bound sessions', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-busy')
    const task = await h.service.create({ name: 'task-busy', workspaceId, sourcePath: h.repository })
    await h.service.bindSession({ taskId: task.id, sessionId: SessionId('session-busy') })
    await expect(h.service.hibernate({ taskId: task.id }))
      .rejects.toMatchObject({ code: 'busy' } satisfies Partial<WorktreeTaskError>)
  })

  it('archives a task after hibernating', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-archive')
    const task = await h.service.create({ name: 'task-arch', workspaceId, sourcePath: h.repository })
    const archived = await h.service.archive({ taskId: task.id })
    expect(archived.status).toBe('archived')
    await expect(stat(task.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deletes a task whose branch is merged into the base branch', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-delete')
    const task = await h.service.create({ name: 'task-del', workspaceId, sourcePath: h.repository })
    await writeFile(join(task.checkoutPath, 'new.txt'), 'new\n')
    await git(task.checkoutPath, 'add', '--all')
    await git(task.checkoutPath, 'commit', '-m', 'task work')
    await git(h.repository, 'merge', '--no-ff', '-m', 'merge task', task.branch)
    const result = await h.service.delete({ taskId: task.id })
    expect(result.deleted).toBe(true)
    expect(() => h.service.get(task.id)).toThrow(WorktreeTaskError)
  })

  it('retains an unmerged branch on delete', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-retain')
    const task = await h.service.create({ name: 'task-retain', workspaceId, sourcePath: h.repository })
    await writeFile(join(task.checkoutPath, 'new.txt'), 'new\n')
    await git(task.checkoutPath, 'add', '--all')
    await git(task.checkoutPath, 'commit', '-m', 'unmerged work')
    const result = await h.service.delete({ taskId: task.id })
    expect(result.deleted).toBe(false)
    expect(result.retainedBranch).toBe(task.branch)
  })

  it('enforces max active checkouts', async () => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const workspaceId = WorkspaceId('ws-cap')
    const first = await h.service.create({ name: 'task-cap-1', workspaceId, sourcePath: h.repository })
    await h.service.bindSession({ taskId: first.id, sessionId: SessionId('session-cap') })
    await expect(h.service.create({ name: 'task-cap-2', workspaceId, sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'operation-failed' } satisfies Partial<WorktreeTaskError>)
    await h.service.unbindSession(first.id, SessionId('session-cap'))
    await h.service.hibernate({ taskId: first.id })
    const second = await h.service.create({ name: 'task-cap-2', workspaceId, sourcePath: h.repository })
    expect(second.status).toBe('active')
  })
})

function WorktreeTaskIdLike(value: string) {
  return value as unknown as ReturnType<typeof import('@deepseek-ai/dsh-worktree-task').WorktreeTaskId>
}
