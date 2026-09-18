import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'

const temporaryRoots: string[] = []
const fixturePackageRoot = ['packages', 'ui'].join('/')
const clientDeclarationExport = {
  types: './lib/types/client/index.d.ts',
  default: './lib/client.js',
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('package export source resolution', () => {
  it.each([
    ['declaration and bundled runtime', clientDeclarationExport],
    ['types-only declaration', { types: './lib/types/client/index.d.ts' }],
    ['runtime-only entry', './lib/client/index.js'],
    ['explicit TSX source', './src/client/index.tsx'],
  ])('discovers and analyzes a JSX client entry from a %s export', (_name, target) => {
    const root = createWorkspace(target)
    const analyzer = new WorkspaceAnalyzer({ root })

    expect(analyzer.discoverPackages()).toEqual([{
      package: '@fixture/tsx',
      root: fixturePackageRoot,
      faces: ['client', 'host'],
    }])
    const model = analyzer.analyze()
    const client = model.faces.find(face => face.face === 'client')
    expect(client?.packages[0]?.schemas.map(schema => schema.export)).toEqual([
      expect.objectContaining({ subpath: './client', name: 'ClientState' }),
    ])
    expect(client?.graph.declarations.find(declaration => declaration.name === 'ClientState')?.location.file)
      .toBe(`${fixturePackageRoot}/src/client/index.tsx`)
    expect(model.faces.find(face => face.face === 'host')?.packages[0]?.schemas.map(schema => schema.export.name))
      .toEqual(['HostState'])
  })

  it('prefers a TS source when TS and TSX entries both exist', () => {
    const root = createWorkspace(clientDeclarationExport)
    writeFileSync(join(root, fixturePackageRoot, 'src/client/index.ts'), [
      '/** @typert schema */',
      'export interface PlainState { readonly value: number }',
      '',
    ].join('\n'))

    const client = new WorkspaceAnalyzer({ root }).analyze().faces.find(face => face.face === 'client')
    expect(client?.packages[0]?.schemas.map(schema => schema.export.name)).toEqual(['PlainState'])
    expect(client?.graph.declarations[0]?.location.file).toBe(`${fixturePackageRoot}/src/client/index.ts`)
  })

  it('keeps an explicit types-only source declaration', () => {
    const root = createWorkspace({ types: './src/client/types.d.ts' })
    writeFileSync(join(root, fixturePackageRoot, 'src/client/types.d.ts'), [
      '/** @typert schema */',
      'export interface DeclaredState { readonly value: boolean }',
      '',
    ].join('\n'))

    const client = new WorkspaceAnalyzer({ root }).analyze().faces.find(face => face.face === 'client')
    expect(client?.packages[0]?.schemas.map(schema => schema.export.name)).toEqual(['DeclaredState'])
    expect(client?.graph.declarations[0]?.location.file).toBe(`${fixturePackageRoot}/src/client/types.d.ts`)
  })

  it.each([
    ['absent TS and TSX sources', './lib/types/client/missing.d.ts', 'src/client/missing.ts'],
    ['an absent explicit TS source beside TSX', './src/client/index.ts', 'src/client/index.ts'],
  ])('reports the missing source for %s', (_name, target, source) => {
    const root = createWorkspace(target)

    expect(() => new WorkspaceAnalyzer({ root }).analyze()).toThrow(
      `typert(client): @fixture/tsx export ./client resolves to missing source ${join(root, fixturePackageRoot, source)}`,
    )
  })
})

function createWorkspace(clientExport: unknown): string {
  const root = mkdtempSync(join(import.meta.dirname, '.typert-export-source-'))
  temporaryRoots.push(root)
  const packageRoot = join(root, fixturePackageRoot)
  mkdirSync(join(packageRoot, 'src/client'), { recursive: true })
  writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      jsx: 'preserve',
      types: [],
    },
  }))
  for (const face of ['host', 'client']) {
    writeFileSync(join(root, `tsconfig.${face}.json`), JSON.stringify({
      extends: './tsconfig.base.json',
      files: [],
      references: [{ path: `./${fixturePackageRoot}` }],
    }))
  }
  writeFileSync(join(packageRoot, 'tsconfig.json'), JSON.stringify({
    extends: '../../tsconfig.base.json',
    compilerOptions: { rootDir: 'src', outDir: 'lib/types' },
    include: ['src'],
  }))
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@fixture/tsx',
    type: 'module',
    dsh: { client: {} },
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './client': clientExport,
    },
  }))
  writeFileSync(join(packageRoot, 'src/index.ts'), [
    '/** @typert schema */',
    'export interface HostState { readonly value: string }',
    '',
  ].join('\n'))
  writeFileSync(join(packageRoot, 'src/client/index.tsx'), [
    'declare global {',
    '  namespace JSX { interface Element { readonly text: string } }',
    '}',
    '/** @typert schema */',
    'export interface ClientState { readonly title: string }',
    'const view: JSX.Element = <>client</>',
    'void view',
    '',
  ].join('\n'))
  return root
}
