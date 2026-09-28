/** Generate checked Host Remote projections before compiling their Client consumers. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WorkspaceTypertGenerator } from '../packages/typert/generator/src/workspace.ts'

/**
 * Bootstrap genuine Remote artifacts from source with TypeScript diagnostics enabled.
 * @param root - Repository root containing the Host compiler aggregate.
 */
export function buildRemoteContracts(root: string): void {
  const generator = new WorkspaceTypertGenerator(root)
  const packages = generator.discover(['host']).filter((candidate) => {
    const manifest = JSON.parse(readFileSync(resolve(root, candidate.root, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
    }
    return manifest.exports !== undefined && Object.hasOwn(manifest.exports, './remote')
  }).map(candidate => candidate.package)
  if (packages.length === 0) throw new Error('build: no Host Remote contributors found')
  for (const artifact of generator.generate(packages, ['host'])) {
    if (artifact.remote === undefined) throw new Error(
      'build: Remote contributor produced no Remote projection: ' + artifact.package,
    )
    const output = resolve(root, artifact.packageRoot, 'lib')
    mkdirSync(output, { recursive: true })
    writeFileSync(resolve(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}

if (import.meta.main) buildRemoteContracts(resolve(import.meta.dirname, '..'))
