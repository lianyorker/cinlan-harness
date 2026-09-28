/** Remote bootstrap uses checked source generation and publishes no placeholder contracts. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/src/workspace.ts'
import { buildRemoteContracts } from './build-remote-contracts.ts'

const generation = vi.hoisted(() => ({ discover: vi.fn(), generate: vi.fn() }))
vi.mock('../packages/typert/generator/src/workspace.ts', () => ({
  WorkspaceTypertGenerator: vi.fn(function () { return generation }),
}))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  generation.discover.mockReturnValue([
    { package: 'remote-owner', root: 'packages/api/owner' },
    { package: 'ordinary-owner', root: 'packages/api/ordinary' },
  ])
  vi.mocked(readFileSync).mockImplementation(path => String(path).includes('ordinary')
    ? '{"exports":{"./typert":{}}}' : '{"exports":{"./remote":{}}}')
  generation.generate.mockReturnValue([{
    package: 'remote-owner', packageRoot: 'packages/api/owner',
    remote: { js: 'generated JS', dts: 'generated declarations', dtsMap: 'generated map' },
  }])
})

describe('Remote contract bootstrap', () => {
  it('requires successful bootstrap before Host tsc and tsdown in the package command', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const manifest = JSON.parse(fs.readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['build:lib:host']!.split(' && ')).toEqual([
      'tsx scripts/build-remote-contracts.ts',
      'node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json',
      'tsdown --env.DSH_BUILD_FACE host',
    ])
  })

  it('generates only Remote Host contributors with default diagnostics and writes their exact projections', () => {
    buildRemoteContracts('fixture')
    expect(WorkspaceTypertGenerator).toHaveBeenCalledWith('fixture')
    expect(generation.discover).toHaveBeenCalledWith(['host'])
    expect(generation.generate).toHaveBeenCalledWith(['remote-owner'], ['host'])
    const output = resolve('fixture', 'packages/api/owner/lib')
    expect(mkdirSync).toHaveBeenCalledWith(output, { recursive: true })
    expect(vi.mocked(writeFileSync).mock.calls).toEqual([
      [resolve(output, 'typert.remote-client.js'), 'generated JS'],
      [resolve(output, 'typert.remote-client.d.ts'), 'generated declarations'],
      [resolve(output, 'typert.remote-client.d.ts.map'), 'generated map'],
    ])
  })

  it('propagates source diagnostics without writing artifacts', () => {
    generation.generate.mockImplementationOnce(() => { throw new Error('source diagnostic') })
    expect(() => { buildRemoteContracts('fixture') }).toThrow('source diagnostic')
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects an empty contributor selection', () => {
    generation.discover.mockReturnValueOnce([])
    expect(() => { buildRemoteContracts('fixture') }).toThrow('no Host Remote contributors')
    expect(generation.generate).not.toHaveBeenCalled()
  })

  it('rejects an owner without a generated Remote projection', () => {
    generation.generate.mockReturnValueOnce([{ package: 'owner' }])
    expect(() => { buildRemoteContracts('fixture') }).toThrow('produced no Remote projection: owner')
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})
