/** Built browser bundle registration smoke. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-voice-dictation'

interface ClientBundleRegistration {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => unknown
}

function readBundle(): string | undefined {
  try {
    return readFileSync(resolve('packages/client/ui-voice-dictation/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

describe('voice dictation client bundle', () => {
  const code = readBundle()

  it.skipIf(code === undefined)('parses and registers exactly one matching module factory', () => {
    const registrations: ClientBundleRegistration[] = []
    const window = {
      __ModuleLoader__: {
        load(registration: ClientBundleRegistration): void {
          registrations.push(registration)
        },
      },
    }

    if (code === undefined) throw new Error('client bundle is unavailable')
    new Script(code, { filename: 'ui-voice-dictation/client.js' })
      .runInNewContext({ window }, { timeout: 5_000 })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe(PLUGIN_ID)
    expect(registrations[0]?.factory).toBeTypeOf('function')
  })
})
