/** Experimental-package publication and dependency constraints. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkDshFamilyVersion,
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  checkWorkspaceManifest,
  checkWorkspaceProtocol,
  expectedDshPackageFiles,
  type PackageManifest,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'
import { PUBLIC_EXPERIMENTAL_PACKAGES } from './experimental-package-policy.ts'

const experimental = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
} satisfies WorkspaceManifest

const root = resolve(import.meta.dirname, '..')
const rootVersion = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
const publicExperimental: WorkspaceManifest[] = Object.entries(PUBLIC_EXPERIMENTAL_PACKAGES).map(([dir, name]) => ({
  dir,
  manifest: {
    name,
    version: rootVersion,
    publishConfig: { access: 'public' },
    repository: { type: 'git', url: 'git+https://github.com/deepseek-ai/deepseek-harness.git', directory: dir },
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
    files: ['lib/index.js', 'lib/types/**/*.d.ts'],
    peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
  },
}))

describe('experimental workspace constraints', () => {
  it.each(publicExperimental)('accepts the public release declarations for $dir', (entry) => {
    expect(checkWorkspaceManifest(entry)).toEqual([])
  })

  it.each([
    [{ private: true }, 'release member must not set "private": true'],
    [{ publishConfig: {} }, 'release member must set publishConfig.access to "public"'],
    [{ repository: {} }, 'release member repository must use'],
    [{ version: '0.0.0' }, 'package.json version must match root version'],
    [{ peerDependencies: {} }, '@deepseek-ai/cordis must be a peerDependency'],
    [{ files: ['src'] }, 'package.json files must not publish "src"'],
  ] satisfies [Partial<PackageManifest>, string][])('applies release constraints to an official experimental import: %j', (fields, error) => {
    const entry = publicExperimental[0]!
    expect(checkWorkspaceManifest({ ...entry, manifest: { ...entry.manifest, ...fields } }).join('\n'))
      .toContain(error)
  })

  it('requires the allowed package name in its exact directory', () => {
    const entry = publicExperimental[0]!
    expect(checkExperimentalManifest({
      ...entry, manifest: { ...entry.manifest, name: experimental.manifest.name },
    }).join('\n')).toContain('public experimental package name must be "@deepseek-ai/dsh-experimental-auto-review"')
    expect(checkWorkspaceManifest({ ...entry, dir: experimental.dir }).join('\n'))
      .toContain('experimental package must set "private": true')
  })

  it('rejects an unknown public experimental manifest through the workspace gate', () => {
    const entry = publicExperimental[0]!
    expect(checkWorkspaceManifest({
      dir: experimental.dir,
      manifest: { ...entry.manifest, name: experimental.manifest.name },
    }).join('\n')).toContain('experimental package must set "private": true')
  })

  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference a private or unpublished workspace package`,
      ])
    },
  )

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'allows public experimental %s but rejects private and unlisted targets',
    (section) => {
      const target = publicExperimental[0]!
      const publicConsumer = publicExperimental[1]!
      const ordinaryConsumer: WorkspaceManifest = { dir: 'packages/core/consumer', manifest: { name: '@deepseek-ai/dsh-consumer' } }
      for (const consumer of [ordinaryConsumer, publicConsumer]) {
        const importer = { ...consumer, manifest: { ...consumer.manifest, [section]: { [target.manifest.name!]: 'workspace:^' } } }
        expect(checkExperimentalDependencyIsolation([target, importer])).toEqual([])
        expect(checkExperimentalDependencyIsolation([
          { ...target, manifest: { ...target.manifest, private: true } }, importer,
        ])).toHaveLength(1)
        expect(checkExperimentalDependencyIsolation([{ ...target, dir: experimental.dir }, importer])).toHaveLength(1)
        expect(checkExperimentalDependencyIsolation([experimental, {
          ...consumer,
          manifest: { ...consumer.manifest, [section]: { [experimental.manifest.name!]: 'workspace:^' } },
        }])).toHaveLength(1)
      }
      expect(checkExperimentalDependencyIsolation([
        { dir: 'packages/core/internal', manifest: { name: '@deepseek-ai/dsh-internal', private: true } },
        { ...ordinaryConsumer, manifest: { ...ordinaryConsumer.manifest, [section]: { '@deepseek-ai/dsh-internal': 'workspace:^' } } },
      ])).toHaveLength(1)
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference a private or unpublished workspace package',
    ])
  })
})

describe('official experimental workspace imports', () => {
  it('validates all seven manifests and their workspace dependency ranges', () => {
    const manifests = globSync(['packages/*/*/package.json', 'apps/*/package.json', 'vendor/*/package.json'], { cwd: root })
      .map((path): WorkspaceManifest => ({
        dir: path.replaceAll('\\', '/').slice(0, -'/package.json'.length),
        manifest: JSON.parse(readFileSync(resolve(root, path), 'utf8')) as PackageManifest,
      }))
    for (const [dir, name] of Object.entries(PUBLIC_EXPERIMENTAL_PACKAGES)) {
      const entry = manifests.find(candidate => candidate.dir === dir)
      expect(entry?.manifest.name).toBe(name)
      expect(entry?.manifest.version).toBe(rootVersion)
      expect(checkWorkspaceManifest(entry!)).toEqual([])
    }
    expect(checkWorkspaceProtocol(manifests)).toEqual([])
    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([])
  })

  it('rejects a non-workspace range to an official experimental import', () => {
    const target = publicExperimental[0]!
    expect(checkWorkspaceProtocol([target, {
      dir: 'packages/core/consumer',
      manifest: { name: '@deepseek-ai/dsh-consumer', dependencies: { [target.manifest.name!]: '^0.1.6' } },
    }]).join('\n')).toContain('must use the workspace: protocol, got ^0.1.6')
  })
})

describe('dsh family version coherence', () => {
  it('rejects a package carrying a stale shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/dsh-http-proxy', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@deepseek-ai/dsh-http-proxy: package.json version must match root version 0.1.2-rc.1')
  })

  it('rejects the root-named CLI app on a stale shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/dsh', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@deepseek-ai/dsh: package.json version must match root version 0.1.2-rc.1')
  })

  it('accepts a manifest carrying the shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/dsh-http-proxy', version: '0.1.2-rc.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
  })

  it('leaves other sequences to their own version lines', () => {
    expect(checkDshFamilyVersion({ name: '@deepseek-ai/cordis', version: '4.0.1' }, '0.1.2-rc.1')).toBeUndefined()
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/node-addon-system', version: '0.1.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
    expect(checkDshFamilyVersion({ version: '0.1.2-alpha.5' }, '0.1.2-rc.1')).toBeUndefined()
  })
})

describe('package payload constraints', () => {
  it.each([
    ['bundle/headless', ['lib/json-stream-*.js']],
    ['client/ui-git-settings', ['lib/types.js']],
    ['client/web', ['lib/boot-page.js', 'lib/**/*.css']],
    ['computer-use/computer-use', ['lib/brand.js']],
    ['execution-host/execution-host-worker', ['lib/*.js', 'lib/chunks/**/*.js']],
    ['git/git-settings', ['lib/settings-schema.js', 'lib/types.js']],
    ['mcp/mcp-client', ['lib/registry.js', 'lib/*.js']],
    ['ptc-runtime/ptc-runtime-node', ['lib/code-runtime.js', 'lib/process.js']],
    ['ssh/ssh', ['lib/helper.js', 'lib/protocol.js', 'lib/schemas.js', 'lib/protocol-*.js', 'lib/schemas-*.js', 'lib/stream-security-*.js']],
    ['subprocess/subprocess', ['lib/control.js']],
    ['subprocess/subprocess-local', ['lib/output.js', 'lib/runner.js', 'lib/runner-*.js']],
  ] satisfies [string, string[]][])('retains required runtime artifacts for %s and rejects extra payloads', (directory, assets) => {
    const dir = 'packages/' + directory
    const manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8')) as PackageManifest
    expect(checkWorkspaceManifest({ dir, manifest })).toEqual([])
    for (const asset of assets) {
      expect(manifest.files).toContain(asset)
      expect(checkWorkspaceManifest({
        dir, manifest: { ...manifest, files: manifest.files!.filter(file => file !== asset) },
      }).join('\n')).toContain('package.json files must be')
    }
    expect(checkWorkspaceManifest({
      dir, manifest: { ...manifest, files: [...manifest.files!, 'lib/unreviewed.js'] },
    }).join('\n')).toContain('package.json files must be')
    expect(expectedDshPackageFiles({ name: '@deepseek-ai/dsh-unrelated' }))
      .toEqual(['lib/index.js', 'lib/types/**/*.d.ts'])
  })


  it('includes a declared profile patch without a package-name allowlist', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-profile',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })).toEqual([
      'lib/index.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ])
  })
})

describe('runtime-loaded security and sidebar payloads', () => {
  it.each([
    ['bundle/security-research', 'presets'],
    ['security/security-skills', 'assets'],
    ['client/ui-better-sidebar', 'lib/client-terminal.js'],
    ['client/ui-better-sidebar', 'lib/client-editor.js'],
    ['client/ui-better-sidebar', 'lib/client-mermaid.js'],
  ])('requires %s to publish %s', (directory, asset) => {
    const manifest = JSON.parse(readFileSync('packages/' + directory + '/package.json', 'utf8'))
    const expected = expectedDshPackageFiles(manifest)
    expect(expected).toContain(asset)
    expect(manifest.files).toEqual(expected)
    expect(manifest.files.filter((file: string) => file !== asset)).not.toEqual(expected)
  })
})
