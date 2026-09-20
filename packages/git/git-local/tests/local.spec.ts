import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  statSync, utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GitRepositoryId } from '@deepseek-ai/dsh-git'
import type { GitRepository } from '@deepseek-ai/dsh-git'
import LocalGitRuntime from '../src/index.ts'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

const gitAvailable = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0
const roots: string[] = []

interface ScriptedCommand {
  readonly operation?: string
  readonly stdout?: string
  readonly stderr?: string
  readonly stdoutTruncated?: boolean
  readonly stderrTruncated?: boolean
  readonly omitStdout?: boolean
  readonly omitStderr?: boolean
  readonly exitCode?: number | null
  readonly onDone?: () => void
  readonly onWaitForExit?: () => void
  readonly rejectDone?: boolean
  readonly doneError?: unknown
  readonly rejectWaitForExit?: boolean
  readonly waitForExitError?: unknown
  readonly waitForExitResult?: boolean
  readonly throwSpawn?: boolean
  readonly spawnError?: unknown
}

class ScriptedSubprocessRuntime extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []

  constructor(ctx: Context, private readonly commands: ScriptedCommand[]) {
    super(ctx)
  }

  async resolveExecutable(command: string, _env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return command
  }

  async terminalEnvironment(): Promise<never> {
    throw new Error('fixture does not provide terminal subprocesses')
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    let operationIndex = 1
    while (spec.argv[operationIndex] === '-c') operationIndex += 2
    const operation = spec.argv[operationIndex]
    const queued = this.commands[0]
    const command = operation === 'config' && queued?.operation !== 'config'
      ? { exitCode: 1 }
      : this.commands.shift()
    if (command === undefined) throw new Error('scripted subprocess command queue is empty')
    if (command.operation !== undefined && command.operation !== operation) {
      throw new Error(`expected scripted ${command.operation} command, received ${operation ?? '<missing>'}`)
    }
    if (command.throwSpawn === true) throw command.spawnError
    const reader = (text: string, lossy: boolean) => ({
      readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy }),
    })
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {
        ...(command.omitStdout === true ? {} : { stdout: reader(command.stdout ?? '', command.stdoutTruncated ?? false) }),
        ...(command.omitStderr === true ? {} : { stderr: reader(command.stderr ?? '', command.stderrTruncated ?? false) }),
      },
      done: Promise.resolve().then(() => {
        command.onDone?.()
        if (command.rejectDone === true) throw command.doneError
        return { exitCode: command.exitCode === undefined ? 0 : command.exitCode, signal: null }
      }),
      terminate: () => {},
      waitForExit: async () => {
        command.onWaitForExit?.()
        if (command.rejectWaitForExit === true) throw command.waitForExitError
        return command.waitForExitResult ?? true
      },
    }
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('scripted terminal is unavailable')
  }
}

const scriptedRepository: GitRepository = {
  id: GitRepositoryId('/repo'),
  root: '/repo',
  head: 'a'.repeat(40),
}

async function scriptedHarness(
  commands: ScriptedCommand[],
  config: Partial<{ executable: string; maxOutputBytes: number; maxLogEntries: number; graceMs: number }> = {},
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ScriptedSubprocessRuntime, commands)
  await ctx.plugin(LocalGitRuntime, {
    executable: 'git',
    maxOutputBytes: 128,
    maxLogEntries: 2,
    graceMs: 1000,
    ...config,
  })
  return ctx
}

function samePath(actual: string, expected: string): boolean {
  const normalize = (value: string): string => process.platform === 'win32'
    ? realpathSync.native(value).toLowerCase()
    : realpathSync.native(value)
  return normalize(actual) === normalize(expected)
}

function initializeRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-git-test-'))
  roots.push(root)
  execFileSync('git', ['init', '--quiet', root])
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid'])
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Harness Test'])
  return root
}

function repository(): string {
  const root = initializeRepository()
  writeFileSync(join(root, 'tracked.txt'), 'first\n')
  execFileSync('git', ['-C', root, 'add', 'tracked.txt'])
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'initial'])
  return root
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name)
  else process.env[name] = value
}

function nodeHook(root: string, name: string, body: string): string {
  const path = join(root, name)
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`)
  chmodSync(path, 0o755)
  return process.platform === 'win32' ? path.replaceAll('\\', '/') : path
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('LocalGitRuntime', () => {
  it.skipIf(!gitAvailable)('returns structured observations without mutating the repository', async () => {
    const root = repository()
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
    const repo = await ctx.git.resolveRepository({ path: root })
    expect(samePath(repo.root, root)).toBe(true)
    expect(repo.head).toMatch(/^[0-9a-f]{40}$/)
    expect(await ctx.git.status(repo)).toMatchObject({ clean: true, staged: 0, unstaged: 0, untracked: 0 })
    expect((await ctx.git.status(repo)).branch).toMatch(/^(master|main)$/)
    writeFileSync(join(root, 'tracked.txt'), 'changed\n')
    writeFileSync(join(root, 'untracked.txt'), 'new\n')
    const status = await ctx.git.status(repo)
    expect(status.unstaged).toBe(1)
    expect(status.untracked).toBe(1)
    expect((await ctx.git.diff({ repository: repo })).text).toContain('changed')
    expect((await ctx.git.log({ repository: repo, limit: 1 }))[0]?.subject).toBe('initial')
    expect(() => GitRepositoryId('repo')).not.toThrow()
  }, 15_000)

  it.skipIf(!gitAvailable)('returns the unborn branch and omits detached HEAD labels', async () => {
    const root = initializeRepository()
    const branch = execFileSync('git', ['-C', root, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
    const repo = await ctx.git.resolveRepository({ path: root })

    expect(repo.head).toBeUndefined()
    expect((await ctx.git.status(repo)).branch).toBe(branch)

    execFileSync('git', ['-C', root, 'commit', '--allow-empty', '--quiet', '-m', 'initial'])
    execFileSync('git', ['-C', root, 'checkout', '--detach', '--quiet'])
    expect((await ctx.git.status(repo)).branch).toBeUndefined()
  }, 15_000)

  it.skipIf(!gitAvailable)('preserves record-separator characters in commit subjects', async () => {
    const root = repository()
    const subject = `before${String.fromCharCode(0x1f)}middle${String.fromCharCode(0x1e)}after`
    execFileSync('git', ['-C', root, 'commit', '--allow-empty', '--quiet', '-m', subject])
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
    const repo = await ctx.git.resolveRepository({ path: root })

    expect((await ctx.git.log({ repository: repo, limit: 1 }))[0]?.subject).toBe(subject)
  }, 15_000)

  it.skipIf(!gitAvailable)('ignores ambient repository-selection variables', async () => {
    const target = repository()
    const redirected = repository()
    const previousDir = process.env.GIT_DIR
    const previousWorkTree = process.env.GIT_WORK_TREE
    process.env.GIT_DIR = join(redirected, '.git')
    process.env.GIT_WORK_TREE = redirected
    try {
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })

      const resolved = await ctx.git.resolveRepository({ path: target })
      expect(samePath(resolved.root, target)).toBe(true)
    } finally {
      restoreEnvironment('GIT_DIR', previousDir)
      restoreEnvironment('GIT_WORK_TREE', previousWorkTree)
    }
  }, 15_000)

  it.skipIf(!gitAvailable)('disables repository fsmonitor hooks', async () => {
    const root = repository()
    const marker = join(root, 'fsmonitor.marker')
    const hook = nodeHook(root, 'fsmonitor-hook.cjs', [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(marker)}, 'invoked')`,
      "process.stdout.write('token\\0')",
    ].join('\n'))
    execFileSync('git', ['-C', root, 'config', 'core.fsmonitor', hook])
    spawnSync('git', ['-C', root, 'status', '--short'], { stdio: 'ignore' })
    expect(existsSync(marker)).toBe(true)
    rmSync(marker, { force: true })

    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
    const repo = await ctx.git.resolveRepository({ path: root })
    await ctx.git.status(repo)

    expect(existsSync(marker)).toBe(false)
  }, 15_000)

  it.skipIf(!gitAvailable)('disables diff textconv commands', async () => {
    const root = repository()
    const marker = join(root, 'textconv.marker')
    const hook = nodeHook(root, 'textconv-hook.cjs', [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(marker)}, 'invoked')`,
      "process.stdout.write('converted\\n')",
    ].join('\n'))
    writeFileSync(join(root, '.gitattributes'), '*.bin diff=probe\n')
    writeFileSync(join(root, 'sample.bin'), Buffer.from([0, 1, 2]))
    execFileSync('git', ['-C', root, 'config', 'diff.probe.textconv', hook])
    execFileSync('git', ['-C', root, 'add', '.gitattributes', 'sample.bin'])
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'add binary'])
    writeFileSync(join(root, 'sample.bin'), Buffer.from([0, 1, 3]))
    spawnSync('git', ['-C', root, 'diff', '--no-ext-diff', '--no-color'], { stdio: 'ignore' })
    expect(existsSync(marker)).toBe(true)
    rmSync(marker, { force: true })

    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
    const repo = await ctx.git.resolveRepository({ path: root })
    await ctx.git.diff({ repository: repo })

    expect(existsSync(marker)).toBe(false)
  }, 15_000)

  it.skipIf(!gitAvailable)('disables work-tree clean filters before status and diff', async () => {
    const root = repository()
    const marker = join(root, 'clean-filter.marker')
    const hook = nodeHook(root, 'clean-filter.cjs', [
      "const fs = require('node:fs')",
      `fs.writeFileSync(${JSON.stringify(marker)}, 'invoked')`,
      'process.stdin.pipe(process.stdout)',
    ].join('\n'))
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=probe-driver\n')
    execFileSync('git', ['-C', root, 'add', '.gitattributes'])
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'add attributes'])
    execFileSync('git', ['-C', root, 'config', 'filter.probe-driver.clean', `node ${JSON.stringify(hook)}`])
    execFileSync('git', ['-C', root, 'config', 'filter.probe-driver.required', 'true'])
    writeFileSync(join(root, 'tracked.txt'), 'other\n')
    spawnSync('git', ['-C', root, 'status', '--short'], { stdio: 'ignore' })
    expect(existsSync(marker)).toBe(true)
    rmSync(marker, { force: true })

    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
    const repo = await ctx.git.resolveRepository({ path: root })
    await ctx.git.status(repo)
    await ctx.git.diff({ repository: repo })

    expect(existsSync(marker)).toBe(false)
  }, 15_000)

  it.skipIf(!gitAvailable)('rejects a gitdir indirection whose configured work tree excludes the requested path', async () => {
    const external = repository()
    const requested = mkdtempSync(join(tmpdir(), 'dsh-git-scope-'))
    roots.push(requested)
    const gitDir = join(external, '.git').replaceAll('\\', '/')
    const workTree = external.replaceAll('\\', '/')
    writeFileSync(join(requested, '.git'), `gitdir: ${gitDir}\n`)
    execFileSync('git', ['-C', external, 'config', 'core.worktree', workTree])

    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })

    await expect(ctx.git.resolveRepository({ path: requested })).rejects.toMatchObject({
      code: 'NOT_REPOSITORY',
      message: `path is not inside its Git work tree: ${requested}`,
    })
  }, 15_000)

  it.skipIf(!gitAvailable)('does not refresh the repository index when ambient optional locks are enabled', async () => {
    const root = repository()
    const index = join(root, '.git', 'index')
    const tracked = join(root, 'tracked.txt')
    const previous = process.env.GIT_OPTIONAL_LOCKS
    process.env.GIT_OPTIONAL_LOCKS = '1'
    try {
      const ctx = new Context()
      await ctx.plugin(LocalSubprocessRuntime)
      await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 4096, maxLogEntries: 5, graceMs: 1000 })
      const repo = await ctx.git.resolveRepository({ path: root })
      const before = readFileSync(index)
      const future = new Date(statSync(tracked).mtimeMs + 5000)
      utimesSync(tracked, future, future)

      await ctx.git.status(repo)

      expect(readFileSync(index)).toEqual(before)
    } finally {
      restoreEnvironment('GIT_OPTIONAL_LOCKS', previous)
    }
  }, 15_000)

  it.skipIf(!gitAvailable)('rejects non-repositories and caller limits beyond provider bounds', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-git-empty-'))
    roots.push(root)
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalGitRuntime, { executable: 'git', maxOutputBytes: 128, maxLogEntries: 2, graceMs: 1000 })
    await expect(ctx.git.resolveRepository({ path: root })).rejects.toMatchObject({ code: 'NOT_REPOSITORY' })
    const repoRoot = repository()
    const repo = await ctx.git.resolveRepository({ path: repoRoot })
    await expect(ctx.git.diff({ repository: repo, maxBytes: 129 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    await expect(ctx.git.log({ repository: repo, limit: 3 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  }, 15_000)

  it('validates provider configuration and empty repository paths', async () => {
    for (const config of [
      { executable: ' ' },
      { maxOutputBytes: 0 },
      { maxOutputBytes: 1.5 },
      { maxLogEntries: 0 },
      { maxLogEntries: 1.5 },
      { graceMs: 0 },
      { graceMs: 1.5 },
    ]) {
      const ctx = new Context()
      await ctx.plugin(ScriptedSubprocessRuntime, [])
      await expect(ctx.plugin(LocalGitRuntime, {
        executable: 'git', maxOutputBytes: 128, maxLogEntries: 2, graceMs: 1000, ...config,
      })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    const ctx = await scriptedHarness([])
    await expect(ctx.git.resolveRepository({ path: '' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('resolves repositories without guessing after incomplete or invalid command output', async () => {
    const ctx = await scriptedHarness([
      { exitCode: 1, stderr: 'outside repository' },
      { exitCode: 1, omitStderr: true },
      { stdout: '\ntrue\n' },
      { stdout: '/repo\ntrue\n', stdoutTruncated: true },
      { stdout: '/repo\ntrue\n' }, { exitCode: 1 },
      { stdout: '/repo\ntrue\n' }, { stdout: 'b'.repeat(40) },
      { stdout: '/repo\nfalse\n' },
      { stdout: '/repo' },
      { stdout: 'true\n' },
      { stdout: 'C:\\repo\r\ntrue\r\n' }, { exitCode: 1 },
    ])
    await expect(ctx.git.resolveRepository({ path: '/one' })).rejects.toMatchObject({ code: 'NOT_REPOSITORY', message: 'outside repository' })
    await expect(ctx.git.resolveRepository({ path: '/two' })).rejects.toMatchObject({ code: 'NOT_REPOSITORY', message: 'not a Git repository: /two' })
    await expect(ctx.git.resolveRepository({ path: '/three' })).rejects.toMatchObject({ code: 'NOT_REPOSITORY', message: "git returned an empty repository root for '/three'" })
    await expect(ctx.git.resolveRepository({ path: '/four' })).rejects.toMatchObject({ code: 'OUTPUT_TOO_LARGE' })
    await expect(ctx.git.resolveRepository({ path: '/five' })).resolves.toMatchObject({ root: '/repo', head: undefined })
    await expect(ctx.git.resolveRepository({ path: '/six' })).resolves.toMatchObject({ root: '/repo', head: 'b'.repeat(40) })
    await expect(ctx.git.resolveRepository({ path: '/seven' })).rejects.toMatchObject({ code: 'NOT_REPOSITORY' })
    await expect(ctx.git.resolveRepository({ path: '/eight' })).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
    await expect(ctx.git.resolveRepository({ path: '/nine' })).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
    await expect(ctx.git.resolveRepository({ path: '/ten' })).resolves.toMatchObject({ root: 'C:\\repo', head: undefined })
  })

  it('parses strict NUL status records, raw paths, renames, copies, branches, and conflicts', async () => {
    const ctx = await scriptedHarness([
      {
        stdout: '## main...origin/main [ahead 2, behind 3]\0?? untracked\0M  staged\0 M "quoted\n -> name"\0U  conflict-one\0 U conflict-two\0DD conflict-three\0AA conflict-four\0R  renamed\0old name\0C  copied\0source name\0',
      },
      { stdout: '## No commits yet on topic\0' },
      { stdout: '## Initial commit on legacy\0' },
      { stdout: '## HEAD (no branch)\0' },
    ])
    await expect(ctx.git.status(scriptedRepository)).resolves.toEqual({
      branch: 'main',
      ahead: 2,
      behind: 3,
      staged: 6,
      unstaged: 4,
      untracked: 1,
      conflicted: 4,
      clean: false,
    })
    await expect(ctx.git.status(scriptedRepository)).resolves.toMatchObject({ branch: 'topic', clean: true })
    await expect(ctx.git.status(scriptedRepository)).resolves.toMatchObject({ branch: 'legacy', clean: true })
    await expect(ctx.git.status(scriptedRepository)).resolves.toMatchObject({ branch: undefined, clean: true })
  })

  it('rejects empty, malformed, unterminated, and truncated status records', async () => {
    const ctx = await scriptedHarness([
      { stdout: '' },
      { stdout: '## main' },
      { stdout: 'not a header\0' },
      { stdout: '## \0' },
      { stdout: '## main\0M\0' },
      { stdout: '## main\0?M path\0' },
      { stdout: '## main\0   path\0' },
      { stdout: '## main\0R  renamed\0' },
      { stdout: '## main\0C  copied\0\0' },
      { stdout: '## main\0', stdoutTruncated: true },
    ])
    for (let index = 0; index < 9; index++) {
      await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({
        code: 'COMMAND_FAILED',
        message: 'git status returned an invalid record',
      })
    }
    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({ code: 'OUTPUT_TOO_LARGE' })
  })

  it('returns bounded diff truncation and rejects invalid limits or incomplete diagnostics', async () => {
    const ctx = await scriptedHarness([
      { stdout: 'tail', stdoutTruncated: true },
      { stderr: 'warning', stderrTruncated: true },
      { exitCode: 1, stderr: 'diff failed' },
      { exitCode: 1 },
    ])
    for (const maxBytes of [0, 1.5, 129]) {
      await expect(ctx.git.diff({ repository: scriptedRepository, maxBytes })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    await expect(ctx.git.diff({ repository: scriptedRepository, maxBytes: 4 })).resolves.toEqual({ text: 'tail', truncated: true })
    await expect(ctx.git.diff({ repository: scriptedRepository })).rejects.toMatchObject({ code: 'OUTPUT_TOO_LARGE' })
    await expect(ctx.git.diff({ repository: scriptedRepository })).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'diff failed' })
    await expect(ctx.git.diff({ repository: scriptedRepository })).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'git diff failed' })
  })

  it('parses bounded log records and rejects invalid records, limits, and truncation', async () => {
    const record = ['a'.repeat(40), 'Alice', '2026-08-15T00:00:00Z', 'subject  ', ''].join('\0')
    const ctx = await scriptedHarness([
      { stdout: record },
      { stdout: '' },
      { stdout: 'invalid\0' },
      { stdout: record.slice(0, -1) },
      { stdout: record, stdoutTruncated: true },
    ])
    for (const limit of [0, 1.5, 3]) {
      await expect(ctx.git.log({ repository: scriptedRepository, limit })).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    await expect(ctx.git.log({ repository: scriptedRepository, limit: 1 })).resolves.toEqual([{
      hash: 'a'.repeat(40), authorName: 'Alice', committedAt: '2026-08-15T00:00:00Z', subject: 'subject',
    }])
    await expect(ctx.git.log({ repository: scriptedRepository })).resolves.toEqual([])
    await expect(ctx.git.log({ repository: scriptedRepository })).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'git log returned an invalid record' })
    await expect(ctx.git.log({ repository: scriptedRepository })).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'git log returned an invalid record' })
    await expect(ctx.git.log({ repository: scriptedRepository })).rejects.toMatchObject({ code: 'OUTPUT_TOO_LARGE' })
  })

  it('preserves caller cancellation before lookup and after process settlement', async () => {
    const before = new AbortController()
    const beforeReason = new Error('cancel before lookup')
    before.abort(beforeReason)
    const beforeCtx = await scriptedHarness([])
    await expect(beforeCtx.git.status(scriptedRepository, before.signal)).rejects.toBe(beforeReason)

    const after = new AbortController()
    const afterReason = new Error('cancel after spawn')
    const afterCtx = await scriptedHarness([{ onDone: () => { after.abort(afterReason) } }])
    await expect(afterCtx.git.status(scriptedRepository, after.signal)).rejects.toBe(afterReason)
  })

  it('waits for whole-tree exit and maps spawn, outcome, and tree-observation failures', async () => {
    let waited = 0
    const ctx = await scriptedHarness([
      { operation: 'log', stdout: '', onWaitForExit: () => { waited++ } },
      { operation: 'log', throwSpawn: true, spawnError: new Error('spawn failed') },
      { operation: 'log', rejectDone: true, doneError: new Error('outcome failed') },
      { operation: 'log', rejectWaitForExit: true, waitForExitError: 'tree probe failed' },
      { operation: 'log', waitForExitResult: false },
      {
        operation: 'log',
        rejectDone: true,
        doneError: new Error('outcome failed'),
        rejectWaitForExit: true,
        waitForExitError: new Error('tree probe failed'),
      },
      {
        operation: 'log',
        rejectWaitForExit: true,
        waitForExitError: { [Symbol.toPrimitive]: () => { throw new Error('cannot stringify') } },
      },
    ])

    await expect(ctx.git.log({ repository: scriptedRepository })).resolves.toEqual([])
    expect(waited).toBe(1)
    for (const message of [
      'git log failed: spawn failed',
      'git log failed: outcome failed',
      'git log failed: tree probe failed',
      'git log failed: subprocess tree exit was not observed',
      'git log failed: git log process cleanup failed',
      'git log failed: <unprintable failure>',
    ]) {
      await expect(ctx.git.log({ repository: scriptedRepository })).rejects.toMatchObject({
        name: 'GitError', code: 'COMMAND_FAILED', message,
      })
    }
  })

  it('neutralizes every configured clean/process filter through Git 2.25 command-scope arguments', async () => {
    const ctx = await scriptedHarness([
      {
        operation: 'config',
        stdout: 'filter.alpha.clean\0filter.alpha.process\0filter.beta.clean\0',
      },
      { operation: 'status', stdout: '## main\0' },
    ])

    await ctx.git.status(scriptedRepository)
    const runtime = ctx.subprocess as ScriptedSubprocessRuntime
    expect(runtime.specs).toHaveLength(2)
    expect(runtime.specs[1]?.argv).toEqual([
      'git',
      '-c', 'core.fsmonitor=false',
      '-c', 'filter.alpha.clean=',
      '-c', 'filter.alpha.process=',
      '-c', 'filter.alpha.required=false',
      '-c', 'filter.beta.clean=',
      '-c', 'filter.beta.process=',
      '-c', 'filter.beta.required=false',
      'status', '--porcelain=v1', '--branch', '-z',
    ])
    expect(runtime.specs[1]?.env?.GIT_CONFIG_COUNT).toBeUndefined()
    expect(runtime.specs[1]?.env?.GIT_CONFIG_KEY_0).toBeUndefined()
    expect(runtime.specs[1]?.env?.GIT_CONFIG_VALUE_0).toBeUndefined()
  })

  it('rejects incomplete, malformed, and failed filter configuration observations', async () => {
    const ctx = await scriptedHarness([
      { operation: 'config', stdout: 'filter.probe.clean', stdoutTruncated: true },
      { operation: 'config', exitCode: 2, stderr: 'config failed' },
      { operation: 'config', exitCode: 2 },
      { operation: 'config', stdout: 'filter.probe.clean' },
      { operation: 'config', stdout: 'filter..clean\0' },
      { operation: 'config', stdout: 'filter.x=y.clean\0' },
      { operation: 'config', stdout: '' }, { operation: 'status', stdout: '## main\0' },
    ])

    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({ code: 'OUTPUT_TOO_LARGE' })
    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'config failed' })
    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'git config failed while inspecting filters' })
    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'git config returned an invalid filter record' })
    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({ code: 'COMMAND_FAILED', message: 'git config returned an invalid filter record' })
    await expect(ctx.git.status(scriptedRepository)).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
      message: 'git config returned a filter name unsupported by command-scope configuration',
    })
    await expect(ctx.git.status(scriptedRepository)).resolves.toMatchObject({ clean: true })
  })

  it('pins command options, locale, optional locks, and Git environment tombstones', async () => {
    const ambientKey = 'gIt_observation_probe'
    const previous = process.env[ambientKey]
    process.env[ambientKey] = 'redirect-me'
    try {
      const ctx = await scriptedHarness([
        { stdout: '## main\0' },
        { stdout: '' },
        { stdout: '' },
      ])
      await ctx.git.status(scriptedRepository)
      await ctx.git.diff({ repository: scriptedRepository })
      await ctx.git.log({ repository: scriptedRepository })
      const runtime = ctx.subprocess as ScriptedSubprocessRuntime

      expect(runtime.specs).toHaveLength(5)
      for (const spec of runtime.specs) {
        expect(spec.argv[0]).toBe('git')
        expect(spec.env?.GIT_ATTR_NOSYSTEM).toBe('1')
        expect(spec.env?.GIT_CONFIG_GLOBAL).toBe('/dev/null')
        expect(spec.env?.GIT_CONFIG_NOSYSTEM).toBe('1')
        expect(spec.env?.GIT_CONFIG_COUNT).toBeUndefined()
        expect(spec.env?.GIT_CONFIG_KEY_0).toBeUndefined()
        expect(spec.env?.GIT_CONFIG_VALUE_0).toBeUndefined()
        expect(spec.env?.GIT_OPTIONAL_LOCKS).toBe('0')
        expect(spec.env?.LANG).toBe('C')
        expect(spec.env?.LC_ALL).toBe('C')
        expect(spec.env?.GIT_DIR).toBeUndefined()
        expect(spec.env?.[ambientKey]).toBeUndefined()
      }
      expect(runtime.specs[3]?.argv).toEqual([
        'git', '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-color',
      ])
    } finally {
      restoreEnvironment(ambientKey, previous)
    }
  })
})
