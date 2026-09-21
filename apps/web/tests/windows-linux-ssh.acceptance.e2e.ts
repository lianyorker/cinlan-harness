/**
 * Opt-in Windows controller acceptance against a real Debian SSH endpoint.
 *
 * The scenario file is intentionally external: credentials and deployment paths
 * never enter the repository or release activation defaults.
 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, posix } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RuntimeInspection, RuntimeStartRequest, RuntimeTask, RuntimeTaskValue } from '@deepseek-ai/dsh-execution-runtime'
import type {
  CreateTargetRequest, ListTargetsValue, TargetRevisionRequest, TargetValue,
} from '@deepseek-ai/dsh-execution-host-targets'
import type { WorkspaceCreateValue } from '@deepseek-ai/dsh-api-workspace-controller'
import type { SessionCreateValue } from '@deepseek-ai/dsh-api-session-controller'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { RUN_CODE_NAME, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ssh2, { type ClientChannel } from 'ssh2'
import { expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

// These imports install the host-side Context merges used below.
import type {} from '@deepseek-ai/dsh-api-execution-host-controller'
import type {} from '@deepseek-ai/dsh-execution-host-targets'
import type {} from '@deepseek-ai/dsh-execution-runtime'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-default-model'

const SCENARIO_ENV = 'DSH_WINDOWS_LINUX_SSH_SCENARIO'
const scenarioPath = process.env[SCENARIO_ENV]
const COMMAND_OUTPUT_LIMIT = 64 * 1024
const REMOTE_RPC_TIMEOUT_MS = 30_000
const MODEL_WAIT_TIMEOUT_MS = 120_000

type Scenario = {
  readonly artifactDirectory: string
  readonly manifestSHA256: string
  readonly ssh: {
    readonly host: string
    readonly port: number
    readonly username: string
    readonly privateKeyFile: string
    readonly hostKeySHA256: string
  }
  readonly node: string
  readonly remoteRoot: string
}

type RemoteResult<T> = {
  readonly result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
}

type RuntimeTaskReceipt = RuntimeTaskValue & { readonly task: RuntimeTask }

const ownKeys = (value: object, expected: readonly string[], label: string): void => {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(label + ' has unexpected keys: ' + JSON.stringify(actual))
  }
}

const stringField = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(label + ' must be a non-empty string without control characters')
  }
  return value
}

const sshIdentityField = (value: unknown, label: string): string => {
  const result = stringField(value, label)
  if (/\s/u.test(result)) throw new Error(label + ' must not contain whitespace')
  return result
}

const digestField = (value: unknown, label: string): string => {
  const result = stringField(value, label)
  if (!/^[0-9a-f]{64}$/u.test(result)) throw new Error(label + ' must be a lowercase SHA-256 hex digest')
  return result
}

const absoluteLocalPath = (value: unknown, label: string): string => {
  const result = stringField(value, label)
  if (!isAbsolute(result)) throw new Error(label + ' must be absolute')
  return result
}

const absoluteRemotePath = (value: unknown, label: string): string => {
  const result = stringField(value, label)
  if (!result.startsWith('/') || posix.normalize(result) !== result || result === '/') {
    throw new Error(label + ' must be a canonical absolute POSIX path below /')
  }
  return result
}

async function loadScenario(filePath: string | undefined): Promise<Scenario | undefined> {
  if (filePath === undefined) return undefined
  if (process.platform !== 'win32') throw new Error(SCENARIO_ENV + ' is supported only on Windows')
  const scenarioFile = absoluteLocalPath(filePath, SCENARIO_ENV)
  if (extname(scenarioFile).toLowerCase() !== '.json') throw new Error(SCENARIO_ENV + ' must name a .json file')
  const scenarioStat = await lstat(scenarioFile)
  if (!scenarioStat.isFile()) throw new Error(SCENARIO_ENV + ' must name a regular JSON file')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(scenarioFile, 'utf8')) as unknown
  } catch (error) {
    throw new Error('Unable to parse ' + SCENARIO_ENV + ' JSON: ' + (error instanceof Error ? error.message : String(error)), { cause: error })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('SSH acceptance scenario must be a JSON object')
  ownKeys(parsed, ['artifactDirectory', 'manifestSHA256', 'ssh', 'node', 'remoteRoot'], 'SSH acceptance scenario')
  const input = parsed as Record<string, unknown>
  if (typeof input.ssh !== 'object' || input.ssh === null || Array.isArray(input.ssh)) throw new Error('SSH acceptance scenario.ssh must be an object')
  ownKeys(input.ssh, ['host', 'port', 'username', 'privateKeyFile', 'hostKeySHA256'], 'SSH acceptance scenario.ssh')
  const ssh = input.ssh as Record<string, unknown>
  if (typeof ssh.port !== 'number' || !Number.isInteger(ssh.port) || ssh.port < 1 || ssh.port > 65535) throw new Error('SSH acceptance scenario.ssh.port must be a TCP port')
  const artifactDirectory = await realpath(absoluteLocalPath(input.artifactDirectory, 'artifactDirectory'))
  const privateKeyFile = await realpath(absoluteLocalPath(ssh.privateKeyFile, 'ssh.privateKeyFile'))
  const [artifactStat, keyStat] = await Promise.all([stat(artifactDirectory), stat(privateKeyFile)])
  if (!artifactStat.isDirectory()) throw new Error('artifactDirectory must name a directory')
  if (!keyStat.isFile()) throw new Error('ssh.privateKeyFile must name a regular file')
  const privateKey = await readFile(privateKeyFile)
  try {
    if (ssh2.utils.parseKey(privateKey) instanceof Error) throw new Error('ssh.privateKeyFile is not a supported private key')
  } finally { privateKey.fill(0) }
  const manifestBytes = await readFile(join(artifactDirectory, 'runtime-manifest.json'))
  const manifestSHA256 = digestField(input.manifestSHA256, 'manifestSHA256')
  const actualManifestSHA256 = createHash('sha256').update(manifestBytes).digest('hex')
  if (actualManifestSHA256 !== manifestSHA256) throw new Error('manifestSHA256 does not match artifactDirectory/runtime-manifest.json')
  let manifest: unknown
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) as unknown }
  catch (error) { throw new Error('runtime-manifest.json is not valid JSON', { cause: error }) }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) throw new Error('runtime-manifest.json must be an object')
  if ((manifest as { platform?: unknown }).platform !== 'linux') throw new Error('runtime artifact must target Linux for Debian acceptance')
  return {
    artifactDirectory,
    manifestSHA256,
    ssh: {
      host: sshIdentityField(ssh.host, 'ssh.host'),
      port: ssh.port,
      username: sshIdentityField(ssh.username, 'ssh.username'),
      privateKeyFile,
      hostKeySHA256: digestField(ssh.hostKeySHA256, 'ssh.hostKeySHA256'),
    },
    node: absoluteRemotePath(input.node, 'node'),
    remoteRoot: absoluteRemotePath(input.remoteRoot, 'remoteRoot'),
  }
}

// Top-level validation completes before launchWebScaffold can boot the Loader.
const scenario = await loadScenario(scenarioPath)

function yamlScalar(value: string): string {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error('YAML scalar contains a control character')
  return "'" + value.replaceAll("'", "''") + "'"
}

async function writeRuntimeOverlay(root: string, value: Scenario): Promise<string> {
  const overlay = join(root, 'windows-linux-ssh-runtime.patch.yml')
  // Keep this overlay deliberately literal and limited to the two release pins.
  await writeFile(overlay, [
    '- id: execution-runtime',
    '  config:',
    '    artifactDirectory: ' + yamlScalar(value.artifactDirectory),
    '    manifestSHA256: ' + yamlScalar(value.manifestSHA256),
    '',
  ].join('\n'), { encoding: 'utf8', flag: 'wx' })
  return overlay
}

async function remoteRpc<T>(
  scaffold: WebScaffold, endpoint: string, args: object, timeoutMs = REMOTE_RPC_TIMEOUT_MS,
): Promise<T> {
  const response = await scaffold.hostFetch('/api/' + endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'windows-linux-ssh-' + randomUUID(), method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(endpoint + ' failed over HTTP ' + String(response.status) + ': ' + text)
  let body: RemoteResult<T>
  try { body = JSON.parse(text) as RemoteResult<T> }
  catch (error) { throw new Error(endpoint + ' returned invalid JSON', { cause: error }) }
  if (!body.result.ok) throw new Error(endpoint + ' failed: ' + body.result.error.code + ': ' + body.result.error.message)
  return body.result.value
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(label + ' timed out after ' + String(timeoutMs) + 'ms')) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await read()
    if (done(last)) return last
    await new Promise<void>(resolve => setTimeout(resolve, 250))
  }
  throw new Error(label + ' did not settle' + (last === undefined ? '' : ': ' + JSON.stringify(last)))
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function appendBounded(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString()
  if (Buffer.byteLength(next) > COMMAND_OUTPUT_LIMIT) throw new Error('SSH setup command output exceeded its bound')
  return next
}

async function explicitSshCommand(value: Scenario, command: string): Promise<{ stdout: string; stderr: string }> {
  const key = await readFile(value.ssh.privateKeyFile)
  const client = new ssh2.Client()
  const closed = Promise.withResolvers<undefined>()
  let closedValue = false
  let connectionFailure: Error | undefined
  client.once('close', () => { closedValue = true; closed.resolve(undefined) })
  client.on('error', (error) => { connectionFailure ??= error })
  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      const ready = (): void => { cleanup(); resolve() }
      const failed = (error: Error): void => { cleanup(); reject(error) }
      const earlyClose = (): void => { cleanup(); reject(connectionFailure ?? new Error('SSH closed before authentication')) }
      const cleanup = (): void => {
        client.off('ready', ready)
        client.off('error', failed)
        client.off('close', earlyClose)
      }
      client.once('ready', ready)
      client.once('error', failed)
      client.once('close', earlyClose)
      client.connect({
        host: value.ssh.host,
        port: value.ssh.port,
        username: value.ssh.username,
        privateKey: key,
        hostHash: 'sha256',
        hostVerifier: (hash: string) => hash === value.ssh.hostKeySHA256,
        authHandler: ['publickey'],
        agentForward: false,
        readyTimeout: 30_000,
      })
    }), 45_000, 'SSH authentication')
    type CommandResult = { code: number | null; signal: string | null; stdout: string; stderr: string }
    const result = await withTimeout(new Promise<CommandResult>((resolve, reject) => {
      client.exec(command, (error, channel: ClientChannel) => {
        if (error) { reject(error); return }
        let stdout = ''
        let stderr = ''
        let outputFailure: Error | undefined
        const timeout = setTimeout(() => {
          outputFailure = new Error('SSH setup command timed out')
          channel.close()
        }, 30_000)
        channel.on('data', (chunk: Buffer) => {
          try { stdout = appendBounded(stdout, chunk) } catch (cause) { outputFailure = cause as Error; channel.close() }
        })
        channel.stderr.on('data', (chunk: Buffer) => {
          try { stderr = appendBounded(stderr, chunk) } catch (cause) { outputFailure = cause as Error; channel.close() }
        })
        channel.once('error', (error: Error) => { clearTimeout(timeout); reject(error) })
        channel.once('close', (code: number | undefined, signal: string | undefined) => {
          clearTimeout(timeout)
          if (outputFailure !== undefined) reject(outputFailure)
          else resolve({ code: code ?? null, signal: signal ?? null, stdout, stderr })
        })
      })
    }), 45_000, 'SSH setup command completion')
    if (connectionFailure !== undefined) throw connectionFailure
    if (result.code !== 0 || result.signal !== null) {
      throw new Error('SSH setup command failed with code ' + String(result.code) + ', signal ' + String(result.signal) + ': ' + result.stderr)
    }
    return { stdout: result.stdout, stderr: result.stderr }
  } finally {
    key.fill(0)
    client.end()
    const shutdownTimeout = Promise.withResolvers<false>()
    const shutdownTimer = setTimeout(() => { shutdownTimeout.resolve(false) }, 5_000)
    const ended = await Promise.race([closed.promise.then(() => true), shutdownTimeout.promise])
    clearTimeout(shutdownTimer)
    if (!ended && !closedValue) {
      client.destroy()
      await withTimeout(closed.promise, 5_000, 'SSH client shutdown')
    }
  }
}

function toolText(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function requireToolSuccess(result: ToolExecutionResult, label: string): Extract<ToolExecutionResult, { readonly isError: false }> {
  if (result.isError) throw new Error(label + ' failed: ' + JSON.stringify(result.error))
  return result
}

async function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('model call aborted')
  const aborted = Promise.withResolvers<undefined>()
  const onAbort = (): void => { aborted.resolve(undefined) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await withTimeout(aborted.promise, MODEL_WAIT_TIMEOUT_MS, 'model call cancellation')
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  throw signal.reason instanceof Error ? signal.reason : new Error('model call aborted')
}

class AcceptanceAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly firstStarted = Promise.withResolvers<undefined>()
  readonly firstCancelled = Promise.withResolvers<undefined>()

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      this.firstStarted.resolve(undefined)
      try { await waitForAbort(options.signal ?? AbortSignal.timeout(MODEL_WAIT_TIMEOUT_MS)) }
      finally { this.firstCancelled.resolve(undefined) }
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'remote cold resume completed' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const runAcceptance = scenario === undefined ? it.skip : it

runAcceptance('boots the product and exercises a real Windows-to-Debian SSH Agent world', async () => {
  if (scenario === undefined) throw new Error('scenario validation did not produce a scenario')
  const localRoot = await mkdtemp(join(tmpdir(), 'dsh-windows-linux-ssh-'))
  const ownedRemoteRoot = posix.join(scenario.remoteRoot, 'dsh-windows-linux-ssh-' + randomUUID())
  const installRoot = posix.join(ownedRemoteRoot, 'runtime')
  const workspacePath = posix.join(ownedRemoteRoot, 'workspace')
  const gitHome = posix.join(ownedRemoteRoot, 'git-home')
  let remoteAllocationAttempted = false
  let scaffold: WebScaffold | undefined
  let target: TargetValue['target'] | undefined
  let workspace: WorkspaceCreateValue['workspace'] | undefined
  let sessionId: string | undefined
  let currentAgent: Agent | undefined
  let terminalId: TerminalSessionId | undefined
  let sessionControllerDisabled = false
  let testFailed = false
  let testFailure: unknown
  const cleanupFailures: unknown[] = []
  const adapter = new AcceptanceAdapter()
  const remoteEndpoint = {
    host: scenario.ssh.host,
    port: scenario.ssh.port,
    username: scenario.ssh.username,
    privateKeyFile: scenario.ssh.privateKeyFile,
    hostKeySHA256: scenario.ssh.hostKeySHA256,
  }
  const durableEndpoint = {
    host: scenario.ssh.host,
    port: scenario.ssh.port,
    username: scenario.ssh.username,
    hostKeySHA256: scenario.ssh.hostKeySHA256,
  }
  const targetRequest: CreateTargetRequest = {
    label: 'Windows Debian SSH acceptance ' + randomUUID(),
    // Runtime and Agent connections use the explicit endpoint. This sentinel
    // makes accidental OpenSSH alias or user configuration use fail closed.
    sshAlias: 'acceptance-explicit-endpoint-only.invalid',
  }
  try {
    if (process.env.DSH_SNAPSHOT !== undefined && process.env.DSH_SNAPSHOT !== '' && process.env.DSH_SNAPSHOT !== 'replay') {
      throw new Error('Windows Debian SSH acceptance requires DSH_SNAPSHOT=replay or an unset value')
    }
    remoteAllocationAttempted = true
    await explicitSshCommand(scenario, [
      'set -eu',
      'test "$(realpath -- ' + shellQuote(scenario.remoteRoot) + ')" = ' + shellQuote(scenario.remoteRoot),
      'test -d ' + shellQuote(scenario.remoteRoot) + ' && test -O ' + shellQuote(scenario.remoteRoot),
      'umask 077',
      'mkdir -- ' + shellQuote(ownedRemoteRoot),
      'mkdir -- ' + shellQuote(installRoot) + ' ' + shellQuote(workspacePath) + ' ' + shellQuote(gitHome),
    ].join('; '))
    const overlay = await writeRuntimeOverlay(localRoot, scenario)
    scaffold = await launchWebScaffold({
      extraOverlayPath: overlay,
      toolsMode: 'both',
      harnessHome: join(localRoot, 'home'),
      storageRoot: join(localRoot, 'storage'),
    })
    const host = scaffold
    host.ctx.effect(() => host.ctx.llm.registerAdapter(['windows-linux-ssh-acceptance'], adapter), 'Windows Debian acceptance model adapter')
    await host.ctx.agentDefaultModel.saveSelection({ provider: 'windows-linux-ssh-acceptance', model: 'hold-then-reply' })

    const created = await remoteRpc<TargetValue>(host, 'executionHosts/create', targetRequest)
    target = created.target
    expect(target.state.phase).toBe('disconnected')
    const installRequest: RuntimeStartRequest = {
      operation: 'install',
      target: { id: target.id, revision: target.revision },
      endpoint: remoteEndpoint,
      node: scenario.node,
      installRoot,
      workspace: workspacePath,
    }
    const started = await remoteRpc<RuntimeTaskReceipt>(host, 'executionHosts/startRuntime', installRequest)
    const runtimeTaskId = started.task.id
    const installed = await waitFor(
      () => remoteRpc<RuntimeTaskReceipt>(host, 'executionHosts/getRuntimeTask', { id: runtimeTaskId }),
      value => value.task.state !== 'running',
      'runtime installation',
      360_000,
    )
    if (installed.task.state !== 'succeeded') {
      throw new Error('Runtime installation ' + installed.task.state + ': ' + (installed.task.error ?? 'no error detail'))
    }
    expect(installed.task.result?.runtime.generation).toBe(scenario.manifestSHA256)
    expect(installed.task.result?.runtime.platform).toBe('linux')
    const detected = await remoteRpc<RuntimeInspection>(host, 'executionHosts/detectRuntime', {
      endpoint: remoteEndpoint, node: scenario.node, installRoot, workspace: workspacePath,
    })
    expect(detected.state).toBe('installed')
    expect(detected.generation).toBe(scenario.manifestSHA256)
    expect(detected.platform).toBe('linux')
    const retained = await remoteRpc<{ tasks: readonly RuntimeTask[] }>(host, 'executionHosts/listRuntimeTasks', {})
    expect(retained.tasks.some(task => task.id === runtimeTaskId && task.state === 'succeeded')).toBe(true)
    const targets = await remoteRpc<ListTargetsValue>(host, 'executionHosts/list', {})
    target = targets.targets.find(candidate => candidate.id === target?.id)
    if (target === undefined || target.execution === undefined) throw new Error('Runtime installation did not activate its saved target')
    expect(target.execution.endpoint).toEqual(remoteEndpoint)
    expect(target.execution.workspace).toBe(workspacePath)

    const createdWorkspace = await remoteRpc<WorkspaceCreateValue>(host, 'workspace/create', {
      path: workspacePath,
      targetRevision: { id: target.id, revision: target.revision } satisfies TargetRevisionRequest,
    })
    workspace = createdWorkspace.workspace
    expect(workspace.path).toBe(workspacePath)
    if (workspace.execution?.kind !== 'ssh') throw new Error('Workspace did not publish an SSH execution binding')
    expect(workspace.execution.endpoint).toEqual(durableEndpoint)
    const firstConnection = await host.ctx.executionBindings.acquire(workspace.execution, workspacePath)
    const firstIncarnation = firstConnection.incarnation
    await firstConnection.release()
    const reconnected = await host.ctx.executionBindings.acquire(workspace.execution, workspacePath)
    try {
      expect(reconnected.incarnation).not.toBe(firstIncarnation)
    } finally {
      await reconnected.release()
    }

    const createdSession = await remoteRpc<SessionCreateValue>(host, 'session/create', {
      workspaceId: workspace.workspaceId,
      agentPreset: 'standard',
    })
    sessionId = createdSession.sessionId
    currentAgent = host.ctx.agents.get(SessionId(sessionId))
    if (currentAgent === undefined) throw new Error('Remote Session did not publish an Agent')
    const execution = host.ctx.executionBindings.executionForAgent(currentAgent)
    expect(execution.platform).toBe('linux')
    if (execution.binding.kind !== 'ssh') throw new Error('Remote Agent did not retain the SSH binding')
    expect(execution.binding.endpoint).toEqual(durableEndpoint)
    const remote = execution.ctx
    const file = posix.join(workspacePath, 'proof.txt')
    const write = await remote.fs.writeText(await remote.fs.resolve(file), 'one\ntwo\n', { kind: 'createIfAbsent' })
    const edit = await remote.fs.editText(await remote.fs.resolve(file), { oldString: 'two', newString: 'changed', replaceAll: false }, { version: write.version })
    expect(edit.after).toContain('changed')
    const streamed = await remote.fs.streamText(await remote.fs.resolve(file))
    let streamedText = ''
    for await (const chunk of streamed) streamedText += chunk
    expect(streamedText).toBe('one\nchanged\n')
    expect(await remote.fs.readText(await remote.fs.resolve(file))).toBe(streamedText)

    const subprocess = remote.subprocess.spawn({
      argv: [scenario.node, '-e', "process.stdout.write('subprocess-ok')"],
      cwd: workspacePath,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4096, spill: { maxBytes: 4096 } }, stderr: { maxBytes: 4096 } },
      graceMs: 3_000,
      signal: AbortSignal.timeout(30_000),
    })
    const subprocessOutcome = await withTimeout(subprocess.done, 45_000, 'remote subprocess settlement')
    expect(subprocessOutcome.signal).toBeNull()
    expect(subprocessOutcome.exitCode).toBe(0)
    expect(await subprocess.waitForExit(AbortSignal.timeout(30_000))).toBe(true)
    expect(subprocess.collected.stdout?.readFrom(0).text).toBe('subprocess-ok')

    const bash = requireToolSuccess(await host.ctx.tools.execute({
      callId: ToolCallId('windows-linux-ssh-bash'),
      name: 'bash',
      arguments: { command: '. /etc/os-release; test "$ID" = debian; printf "bash-ok:%s" "$ID"', workdir: workspacePath },
      agent: currentAgent,
      signal: AbortSignal.timeout(30_000),
    }), 'remote Bash tool')
    expect(toolText(bash)).toContain('bash-ok:debian')
    const deniedPath = posix.join(workspacePath, 'sandbox-denied.txt')
    const confined = await remote.shell.run(remote.shell.resolve({
      command: 'printf sandbox-probe > ' + shellQuote(deniedPath),
      workdir: workspacePath,
      timeoutMs: 30_000,
    }))
    expect(confined.exitCode).not.toBe(0)
    expect(confined.sandbox?.mode).toBe('read-only')
    expect(confined.sandbox?.enforcement).toBeDefined()
    expect(confined.sandbox?.denied).toBe(true)
    expect(await remote.fs.lstat(deniedPath)).toBeUndefined()

    const gitInit = await remote.shell.run(remote.shell.resolve({
      command: 'git init -q && git config user.email acceptance@example.invalid && git config user.name acceptance && git add proof.txt && git commit -q -m acceptance',
      workdir: workspacePath,
      timeoutMs: 60_000,
      env: {
        HOME: gitHome,
        XDG_CONFIG_HOME: posix.join(gitHome, 'xdg'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
    }))
    expect(gitInit.exitCode).toBe(0)
    const repository = await remote.git.resolveRepository({ path: workspacePath })
    expect(repository.root).toBe(workspacePath)
    const gitStatus = await remote.git.status(repository)
    expect(gitStatus.clean).toBe(true)
    const gitLog = await remote.git.log({ repository, limit: 1 })
    expect(gitLog[0]?.subject).toBe('acceptance')

    const terminal = await remote.terminals.spawn(currentAgent, { type: 'bash', name: 'windows-linux-ssh-acceptance', cwd: workspacePath })
    terminalId = terminal.sessionId
    const terminalSend = remote.terminals.startSend(currentAgent, terminal.sessionId, { text: 'printf terminal-ok', submit: true })
    const terminalResult = await withTimeout(terminalSend.done, 45_000, 'remote terminal send')
    expect(terminalResult.viewport).toContain('terminal-ok')
    expect(await remote.terminals.kill(currentAgent, terminal.sessionId, 'acceptance teardown')).toBe(true)
    terminalId = undefined

    const ptc = requireToolSuccess(await host.ctx.tools.execute({
      callId: ToolCallId('windows-linux-ssh-ptc'),
      name: RUN_CODE_NAME,
      arguments: {
        code: 'const value = await tools.read({ file_path: ' + JSON.stringify(file) + ' }); return value',
        description: 'Read the remote proof file through PTC',
      },
      agent: currentAgent,
      signal: AbortSignal.timeout(60_000),
    }), 'remote PTC tool')
    expect(toolText(ptc)).toContain('one')
    expect(toolText(ptc)).toContain('changed')

    const cancelledShellController = new AbortController()
    const cancellationMarker = posix.join(workspacePath, 'cancelled.txt')
    const cancelledShell = remote.shell.run(remote.shell.resolve({
      command: 'printf cancellation-ready > ' + shellQuote(cancellationMarker) + '; sleep 120',
      workdir: workspacePath,
      timeoutMs: 180_000,
      signal: cancelledShellController.signal,
    }))
    const cancelledShellDone = withTimeout(cancelledShell, 60_000, 'remote cancelled shell settlement')
    try {
      await waitFor(async () => remote.fs.lstat(cancellationMarker), value => value?.type === 'file', 'remote cancellation marker', 30_000)
      cancelledShellController.abort(new Error('acceptance cancellation'))
      const cancelled = await cancelledShellDone
      expect(cancelled.aborted).toBe(true)
      expect(cancelled.timedOut).toBe(false)
    } finally {
      if (!cancelledShellController.signal.aborted) cancelledShellController.abort(new Error('acceptance cleanup'))
      await cancelledShellDone.catch(() => undefined)
    }

    const settleAfterCancel = host.whenTurnSettled(120_000)
    await remoteRpc(host, 'session/prompt', {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Hold this remote Agent turn until cancelled.' }],
    })
    await withTimeout(adapter.firstStarted.promise, MODEL_WAIT_TIMEOUT_MS, 'remote model start')
    const cancelReceipt = await remoteRpc<{ accepted: true }>(host, 'session/cancel', { sessionId })
    expect(cancelReceipt.accepted).toBe(true)
    await withTimeout(adapter.firstCancelled.promise, MODEL_WAIT_TIMEOUT_MS, 'remote model cancellation')
    expect(await settleAfterCancel).toBe(sessionId)
    expect(adapter.requests[0]?.tools?.some(tool => tool.name === RUN_CODE_NAME)).toBe(true)

    const preColdLease = await host.ctx.executionBindings.forSession(SessionId(sessionId))
    const preColdIncarnation = preColdLease.incarnation
    await preColdLease.release()
    const controllerEntry = [...host.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-api-session-controller')
    if (controllerEntry === undefined) throw new Error('session-controller Loader entry is missing')
    await controllerEntry.update({ disabled: true })
    sessionControllerDisabled = true
    await host.ctx.loader.await()
    expect(host.ctx.agents.get(SessionId(sessionId))).toBeUndefined()
    await controllerEntry.update({ disabled: false })
    sessionControllerDisabled = false
    await host.ctx.loader.await()
    const resumed = await remoteRpc<SessionCreateValue>(host, 'session/create', { workspaceId: workspace.workspaceId, sessionId })
    expect(resumed.sessionId).toBe(sessionId)
    const resumedAgent = host.ctx.agents.get(SessionId(sessionId))
    if (resumedAgent === undefined || resumedAgent === currentAgent) throw new Error('Session did not cold-resume a new Agent')
    currentAgent = resumedAgent
    const resumedExecution = host.ctx.executionBindings.executionForAgent(currentAgent)
    expect(resumedExecution.platform).toBe('linux')
    expect(resumedExecution.binding.kind).toBe('ssh')
    const postColdLease = await host.ctx.executionBindings.forSession(SessionId(sessionId))
    try {
      expect(postColdLease.incarnation).not.toBe(preColdIncarnation)
    } finally {
      await postColdLease.release()
    }
    expect(await resumedExecution.ctx.fs.readText(await resumedExecution.ctx.fs.resolve(file))).toBe('one\nchanged\n')
    const settleAfterResume = host.whenTurnSettled(120_000)
    await remoteRpc(host, 'session/prompt', {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Confirm the resumed remote Agent.' }],
    })
    expect(await settleAfterResume).toBe(sessionId)
    expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
  } catch (error) {
    testFailed = true
    testFailure = error
  } finally {
    if (scaffold !== undefined) {
      if (terminalId !== undefined && currentAgent !== undefined) {
        try {
          const execution = scaffold.ctx.executionBindings.executionForAgent(currentAgent)
          await execution.ctx.terminals.kill(currentAgent, terminalId, 'acceptance finalizer')
        } catch (error) { cleanupFailures.push(error) }
      }
      if (sessionId !== undefined) {
        try { await remoteRpc(scaffold, 'workspace/archiveSession', { sessionId }) } catch (error) { cleanupFailures.push(error) }
      }
      if (workspace !== undefined) {
        try { await remoteRpc(scaffold, 'workspace/delete', { workspaceId: workspace.workspaceId }) } catch (error) { cleanupFailures.push(error) }
      }
      try {
        const entry = [...scaffold.ctx.loader.entries()].find(candidate => candidate.options.name === '@deepseek-ai/dsh-api-session-controller')
        if (entry !== undefined && !sessionControllerDisabled) {
          await entry.update({ disabled: true })
          sessionControllerDisabled = true
          await scaffold.ctx.loader.await()
        }
      } catch (error) { cleanupFailures.push(error) }
      if (target !== undefined) {
        try {
          const listed = await remoteRpc<ListTargetsValue>(scaffold, 'executionHosts/list', {})
          const current = listed.targets.find(candidate => candidate.id === target?.id)
          if (current !== undefined) await remoteRpc(scaffold, 'executionHosts/removeTarget', { id: current.id, revision: current.revision })
        } catch (error) { cleanupFailures.push(error) }
      }
      try { await scaffold.close() } catch (error) { cleanupFailures.push(error) }
    }
    if (remoteAllocationAttempted) {
      try { await explicitSshCommand(scenario, 'rm -rf -- ' + shellQuote(ownedRemoteRoot)) } catch (error) { cleanupFailures.push(error) }
    }
    try { await rm(localRoot, { recursive: true, force: true }) } catch (error) { cleanupFailures.push(error) }
  }
  const failures = testFailed ? [testFailure, ...cleanupFailures] : cleanupFailures
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Windows Debian SSH acceptance and teardown failed')
}, 900_000)
