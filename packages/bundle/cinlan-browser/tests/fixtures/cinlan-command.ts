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

const LIST_RESPONSE = JSON.stringify({
  id: 'fixture-request',
  ok: true,
  result: {
    tabs: [{
      browserPageId: 'fixture-page',
      index: 0,
      url: 'https://fixture.example/',
      title: 'Fixture page',
      active: true,
    }],
  },
  _meta: { runtimeId: 'fixture-runtime' },
})

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

  async terminalEnvironment(): Promise<never> {
    throw new Error('fixture does not provide terminal subprocesses')
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const expected = [
      FIXTURE_CINLAN_EXECUTABLE,
      'tab',
      'list',
      '--worktree',
      'active',
      '--json',
    ]
    if (JSON.stringify(spec.argv) !== JSON.stringify(expected)) {
      throw new Error(`unexpected fixture argv: ${JSON.stringify(spec.argv)}`)
    }
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {
        stdout: {
          readFrom: () => ({
            text: LIST_RESPONSE,
            nextOffset: Buffer.byteLength(LIST_RESPONSE),
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
