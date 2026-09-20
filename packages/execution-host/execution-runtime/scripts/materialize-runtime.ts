/** Materialize installed release dependencies and native prebuilds without package-manager installation. */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { writeRuntimeManifest } from '../src/artifact.ts'
import { copyPackage, ptyPayload, systemPayload } from './native-payload.ts'
import type { NativePayload, NativeTarget } from './native-payload.ts'

interface Manifest {
  name: string
  version: string
  os?: string[]
  cpu?: string[]
  files?: string[]
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}
const root = resolve(import.meta.dirname, '../../../..')
const require = createRequire(join(root, 'packages/ssh/ssh/package.json'))
const { values } = parseArgs({ options: { target: { type: 'string', multiple: true }, out: { type: 'string' } } })
const targets = values.target ?? [process.platform + '-' + process.arch]
const output = resolve(values.out ?? join(import.meta.dirname, '../assets/releases'))
const version = (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Manifest).version
const sourceState = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim()
if (sourceState) throw new Error('Runtime release source tree must be clean and committed')
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const index: Record<string, { directory: string; manifestSHA256: string }> = {}

async function packageDirectory(name: string, from: string): Promise<string> {
  const resolver = createRequire(join(from, 'package.json'))
  try { return dirname(resolver.resolve(name + '/package.json')) }
  catch {
    for (const search of resolver.resolve.paths(name) ?? []) {
      const candidate = join(search, name, 'package.json')
      try {
        if ((await lstat(candidate)).isFile()) return await realpath(dirname(candidate))
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    throw new Error('Runtime dependency is not installed: ' + name + ' from ' + from)
  }
}
for (const target of targets) {
  if (!/^(linux|darwin)-(x64|arm64)$/u.test(target)) throw new Error('Runtime release target must be linux/darwin x64/arm64')
  const nativeTarget = target as NativeTarget
  const [platform, arch] = target.split('-') as ['linux' | 'darwin', 'x64' | 'arm64']
  const systemPackage = '@deepseek-ai/node-addon-system-' + target
  const stage = join(output, target)
  await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true })
  const installed = new Map<string, { source: string; manifest: Manifest }>()
  const pending = [await packageDirectory('@deepseek-ai/dsh-ssh', dirname(require.resolve('@deepseek-ai/dsh-ssh/package.json'))),
    await packageDirectory('@deepseek-ai/dsh-ptc-runtime-node', join(root, 'packages/ssh/ssh'))]
  while (pending.length) {
    const source = pending.shift()!
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as Manifest
    if ((manifest.os !== undefined && !manifest.os.includes(platform))
      || (manifest.cpu !== undefined && !manifest.cpu.includes(arch))) continue
    const previous = installed.get(manifest.name)
    if (previous !== undefined) {
      if (previous.manifest.version !== manifest.version) throw new Error('Runtime dependency version conflict: ' + manifest.name)
      continue
    }
    installed.set(manifest.name, { source, manifest })
    for (const [name] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })) {
      if (name.startsWith('@deepseek-ai/node-addon-system-') && name !== systemPackage) continue
      try { pending.push(await packageDirectory(name, source)) }
      catch (error) {
        if (name === systemPackage) throw new Error('Missing target native system prebuild package: ' + target, { cause: error })
        if (manifest.optionalDependencies?.[name] !== undefined || manifest.peerDependenciesMeta?.[name]?.optional === true) continue
        throw error
      }
    }
  }
  const native = installed.get(systemPackage)
  if (native === undefined) throw new Error('Missing target native system prebuild package: ' + target)
  const pty = installed.get('node-pty')
  if (pty === undefined) throw new Error('Missing runtime node-pty dependency')
  const payloads = new Map<string, NativePayload>([
    [systemPackage, await systemPayload(native.source, nativeTarget)],
    ['node-pty', await ptyPayload(pty.source, nativeTarget)],
  ])
  const executablePaths = new Set<string>()
  for (const [name, entry] of installed) {
    const destination = join(stage, 'node_modules', name)
    const payload = payloads.get(name)
    await copyPackage(entry.source, destination, payload?.files ?? entry.manifest.files)
    for (const path of payload?.executablePaths ?? []) executablePaths.add('node_modules/' + name + '/' + path)
    const manifest = structuredClone(entry.manifest)
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      if (manifest[section] === undefined) continue
      for (const dependency of Object.keys(manifest[section])) {
        const selected = installed.get(dependency)
        if (selected === undefined) {
          if (section === 'optionalDependencies' || manifest.peerDependenciesMeta?.[dependency]?.optional === true) delete manifest[section][dependency]
          else throw new Error('Unmaterialized runtime dependency: ' + dependency)
        } else manifest[section][dependency] = selected.manifest.version
      }
    }
    await writeFile(join(destination, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'dsh-execution-runtime-payload', version, private: true, type: 'module',
    dependencies: { '@deepseek-ai/dsh-ssh': version, '@deepseek-ai/dsh-ptc-runtime-node': version } }, undefined, 2) + '\n')
  const manifestSHA256 = await writeRuntimeManifest(stage, { version, sourceCommit, protocol: 1, platform, arch,
    helper: 'node_modules/@deepseek-ai/dsh-ssh/lib/helper.js', bootstrap: 'node_modules/@deepseek-ai/dsh-ptc-runtime-node/lib/process.js' }, executablePaths)
  index[target] = { directory: target, manifestSHA256 }
  console.log(target + ' ' + manifestSHA256)
}
await writeFile(join(output, 'index.json'), JSON.stringify({ schemaVersion: 1, releases: index }, undefined, 2) + '\n')
