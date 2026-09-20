/** Compile the public terminal augmentation before any Cordis consumer. */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('keeps core and terminal Context members on one type when terminal types load first', () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url))).replaceAll('\\', '/')
  const configPath = root + '/packages/terminal/sidebar-terminals/tsconfig.json'
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
    },
  })
  if (config === undefined) throw new Error('Terminal compiler configuration could not be read')
  const fixture = root + '/context-augmentation-consumer.ts'
  const terminalTypes = root + '/packages/terminal/sidebar-terminals/src/types.ts'
  const source = [
    "import { Context } from '@deepseek-ai/cordis'",
    'const ctx = new Context()',
    'const marker: true = ctx.floatingTerminalConsumer',
    'ctx.provide("floatingTerminalConsumer", marker)',
    'void ctx.fiber.dispose()',
  ].join('\n')
  const options = { ...config.options, composite: false, incremental: false, noEmit: true, rootDir: root }
  const compile = (omitTargetImport: boolean, consumerFirst = false, declarations = false): readonly ts.Diagnostic[] => {
    const host = ts.createCompilerHost(options)
    const read = host.readFile.bind(host)
    host.readFile = (file) => {
      if (file.replaceAll('\\', '/') === fixture) return source
      const loaded = read(file)
      const text = declarations && file.replaceAll('\\', '/') === terminalTypes && loaded !== undefined
        ? ts.transpileDeclaration(loaded, { compilerOptions: options }).outputText : loaded
      return omitTargetImport && file.replaceAll('\\', '/') === terminalTypes
        ? text?.replace("export type {} from '@deepseek-ai/cordis'", '') : text
    }
    const program = ts.createProgram(consumerFirst ? [fixture, terminalTypes] : [terminalTypes, fixture], options, host)
    const consumer = program.getSourceFile(fixture)
    if (consumer === undefined) throw new Error('Consumer fixture was not loaded')
    return program.getSemanticDiagnostics(consumer)
  }
  for (const declarations of [false, true]) {
    expect(compile(false, false, declarations).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))).toEqual([])
    expect(compile(false, true, declarations).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))).toEqual([])
    expect(compile(true, false, declarations).some(diagnostic => diagnostic.code === 2339)).toBe(true)
  }
}, 20_000)
