import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** Command name used by the profile override in the Loader fixture. */
export const FIXTURE_CINLAN_COMMAND = 'cinlan-fixture'
/** Canonical executable returned inside the deterministic subprocess world. */
export const FIXTURE_CINLAN_EXECUTABLE = 'fixture://cinlan'

function success(result: unknown): string {
  return JSON.stringify({
    id: 'fixture-request',
    ok: true,
    result,
    _meta: { runtimeId: 'fixture-runtime' },
  })
}

const CAPABILITIES = {
  platform: 'win32',
  provider: 'fixture-computer-use',
  providerVersion: '1',
  protocolVersion: 1,
  supports: {
    apps: { list: true, bundleIds: true, pids: true },
    windows: { list: true, targetById: true, targetByIndex: true, focus: true, moveResize: false },
    observation: { screenshot: true, annotatedScreenshot: false, elementFrames: true, ocr: false },
    actions: {
      click: true,
      typeText: true,
      pressKey: true,
      hotkey: true,
      pasteText: true,
      scroll: true,
      drag: true,
      setValue: true,
      performAction: true,
    },
    surfaces: { menus: true, dialogs: true, dock: false, menubar: false },
  },
}

function response(argv: readonly string[]): string {
  const args = argv.slice(1)
  if (JSON.stringify(args) === JSON.stringify(['computer', 'capabilities', '--json'])) {
    return success(CAPABILITIES)
  }
  if (JSON.stringify(args) === JSON.stringify(['computer', 'list-apps', '--json'])) {
    return success({
      apps: [{
        name: 'Fixture App',
        bundleId: 'fixture.app',
        pid: 7,
        isRunning: true,
        lastUsedAt: null,
        useCount: 1,
      }],
    })
  }
  throw new Error(`unexpected fixture argv: ${JSON.stringify(argv)}`)
}

/** Deterministic local substitute for the external Cinlan executable. */
export class FixtureCinlanSubprocess extends SubprocessRuntime {
  readonly resolvedCommands: string[] = []
  readonly specs: SubprocessSpawnSpec[] = []

  resolveExecutable(
    command: string,
    _env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted()
    this.resolvedCommands.push(command)
    if (command !== FIXTURE_CINLAN_COMMAND) {
      return Promise.reject(new Error(`unexpected executable lookup: ${command}`))
    }
    return Promise.resolve(FIXTURE_CINLAN_EXECUTABLE)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    if (spec.argv[0] !== FIXTURE_CINLAN_EXECUTABLE) {
      throw new Error(`unexpected fixture executable: ${JSON.stringify(spec.argv[0])}`)
    }
    const stdout = response(spec.argv)
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: {
          readFrom: () => ({
            text: stdout,
            nextOffset: Buffer.byteLength(stdout),
            lossy: false,
          }),
        },
        stderr: {
          readFrom: () => ({ text: '', nextOffset: 0, lossy: false }),
        },
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('fixture does not provide terminal subprocesses'))
  }
}
