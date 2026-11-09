import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import * as sessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import WorkspaceRegistry, { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import GitWorktreeTask from '../../../workspace/worktree-task-git/src/index.ts'
import WorktreeTaskWorkspaces from '../src/index.ts'

const execFileAsync = promisify(execFile)
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

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}, 90_000)

// Real composition: the Loader boots every row from one cordis.yml, with the
// real Git provider, the real Workspace registry, the real JSONL session
// persistence, and the bridge; only the storage backend is a test memory pool.
describe('WorktreeTaskWorkspaces composition', { timeout: 90_000 }, () => {
  it('registers a created checkout as a titled Workspace and attaches a bound session', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-task-workspace-composition-')))
    roots.push(root)
    const repository = join(root, 'repository')
    const managed = join(root, 'managed')
    await mkdir(repository)
    await git(repository, 'init', '--template=')
    await git(repository, 'config', 'user.name', 'Worktree Task Composition Test')
    await git(repository, 'config', 'user.email', 'worktree-task-composition-test@localhost')
    await writeFile(join(repository, 'tracked.txt'), 'base\n')
    await git(repository, 'add', '--all')
    await git(repository, 'commit', '-m', 'base')

    const ctx = new Context()
    contexts.push(ctx)
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-domain', storageDomain],
      ['test-storage', {
        inject: ['storage'],
        apply(testCtx: Context) {
          testCtx.effect(() => testCtx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool())))
          const facility = new DomainFacility(testCtx, { backend: 'memory', routes: {} })
          testCtx.storage.mount('domain', facility)
          testCtx.provide('storageDomain', facility)
        },
      }],
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@deepseek-ai/dsh-session-persistence-jsonl', sessionPersistenceJsonl],
      ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
      ['@cinlan/worktree-task-git', GitWorktreeTask],
      ['@cinlan/worktree-task-workspace', WorktreeTaskWorkspaces],
    ])
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { id: 'storage', name: '@deepseek-ai/dsh-storage' },
      { id: 'test-storage', name: 'test-storage' },
      { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
      { id: 'sessions', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(root, 'sessions') } },
      { id: 'workspace-registry', name: '@deepseek-ai/dsh-workspace' },
      { id: 'tasks', name: '@cinlan/worktree-task-git', config: {
        root: managed, maxActiveCheckouts: 4, commandTimeoutMs: 30_000,
      } },
      { id: 'worktree-task-workspace', name: '@cinlan/worktree-task-workspace' },
    ]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
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

    const sourceWorkspace = await ctx.workspaceRegistry.create(repository)
    const changed = vi.fn()
    ctx.on('worktree-task-workspaces/changed', changed)
    const task = await ctx.worktreeTask.create({ name: 'fix-login', workspaceId: WorkspaceId('ws-source'), sourcePath: repository })
    await ctx.worktreeTaskWorkspaces.settled()

    const checkoutWorkspace = await ctx.workspaceRegistry.resolveByPath(task.checkoutPath)
    expect(checkoutWorkspace?.title).toBe('fix-login')
    expect(ctx.worktreeTaskWorkspaces.links()).toEqual([{
      workspaceId: checkoutWorkspace?.id, taskId: task.id, parentWorkspaceId: sourceWorkspace.id, createdAt: expect.any(String),
    }])
    expect(changed).toHaveBeenCalledTimes(1)

    const sessionId = SessionId('worktree-session')
    await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: Date.now(), isSeeded: false, cwd: task.checkoutPath,
    })
    await ctx.worktreeTask.bindSession({ taskId: task.id, sessionId })
    await ctx.worktreeTaskWorkspaces.settled()
    expect(ctx.workspaceRegistry.get(checkoutWorkspace!.id)?.sessionIds).toContain(sessionId)
  })
})
