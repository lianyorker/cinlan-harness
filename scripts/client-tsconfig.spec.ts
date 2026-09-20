/** Regression coverage for source declarations owned by the client test aggregate. */

import { existsSync, readdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function clientCssDeclarations(): string[] {
  const clientGroups = ['client', 'extensions']
  return clientGroups.flatMap((group) => {
    const clientRoot = resolve(root, 'packages', group)
    return readdirSync(clientRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => resolve(clientRoot, entry.name, 'src/css-modules.d.ts'))
  })
    .filter(existsSync)
    .map(file => file.replaceAll(sep, '/'))
    .sort()
}

describe('client TypeScript aggregate', () => {
  it('assigns terminal recovery and the external pairing fixture to the Client program', () => {
    const files = (name: string): Set<string> => {
      const config = ts.getParsedCommandLineOfConfigFile(resolve(root, name), {}, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
          throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
        },
      })
      if (config === undefined) throw new Error('Compiler aggregate could not be read')
      return new Set(config.fileNames.map(file => file.replaceAll(sep, '/')))
    }
    const client = files('tsconfig.client.json')
    const host = files('tsconfig.host.json')
    for (const relative of [
      'packages/client/ui-better-sidebar/tests/terminal-recovery.spec.tsx',
      'packages/client/ui-better-sidebar/tests/terminal-title-editor.spec.tsx',
      'packages/client/ui-settings-pairing/tests/external-rpc.client.ts',
    ]) {
      const absolute = resolve(root, relative).replaceAll(sep, '/')
      expect(client.has(absolute)).toBe(true)
      expect(host.has(absolute)).toBe(false)
    }
    expect(host.has(resolve(root, 'apps/web/tests/mobile-resources.e2e.ts').replaceAll(sep, '/'))).toBe(true)
  })

  it('loads package CSS declarations without relying on workspace-link realpaths', () => {
    const configPath = resolve(root, 'tsconfig.client.json')
    const read = ts.readConfigFile(configPath, file => ts.sys.readFile(file))
    if (read.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const loaded = parsed.fileNames
      .map(file => file.replaceAll(sep, '/'))
      .filter(file => file.endsWith('/src/css-modules.d.ts'))
      .sort()
    expect(loaded).toEqual(clientCssDeclarations())
  })
})
