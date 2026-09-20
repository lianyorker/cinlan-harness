/** Synthetic binary headers exercise producer validation; these fixtures are never runnable payloads. */
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { copyPackage, ptyPayload, systemPayload } from '../scripts/native-payload.ts'
import type { NativeTarget } from '../scripts/native-payload.ts'
import { writeRuntimeManifest } from '../src/artifact.ts'

const targets: NativeTarget[] = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-payload-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

function syntheticBinary(target: NativeTarget, executable = false): Buffer {
  const bytes = Buffer.alloc(192)
  const x64 = target.endsWith('-x64')
  if (target.startsWith('linux-')) {
    bytes.writeUInt32LE(0x464c457f)
    bytes[4] = 2
    bytes[5] = 1
    bytes.writeUInt16LE(executable ? 2 : 3, 16)
    bytes.writeUInt16LE(x64 ? 62 : 183, 18)
  } else {
    bytes.writeUInt32LE(0xfeedfacf)
    bytes.writeUInt32LE(x64 ? 0x01000007 : 0x0100000c, 4)
    bytes.writeUInt32LE(executable ? 2 : 8, 12)
  }
  if (!executable) bytes.write('napi_register_module_v1 node_api_module_get_api_version_v1', 64)
  return bytes
}

async function systemFixture(root: string, target: NativeTarget): Promise<string> {
  const source = join(root, 'system')
  const metadataFile = fileURLToPath(new URL('../../../../native/system/packages/' + target + '/prebuilds.json', import.meta.url))
  const metadata = await readFile(metadataFile, 'utf8')
  await put(source, 'prebuilds.json', metadata)
  const [platform, arch] = target.split('-')
  await put(source, 'package.json', JSON.stringify({ name: '@deepseek-ai/node-addon-system-' + target, os: [platform], cpu: [arch] }))
  const binaries = (JSON.parse(metadata) as { binaries: { path: string; kind: string }[] }).binaries
  for (const binary of binaries) {
    const executable = binary.kind === 'static-musl'
    await put(source, binary.path, syntheticBinary(target, executable))
    await chmod(join(source, binary.path), executable ? 0o755 : 0o644)
  }
  return source
}

async function ptyFixture(root: string, target: NativeTarget): Promise<string> {
  const source = join(root, 'pty')
  await put(source, 'package.json', JSON.stringify({ name: 'node-pty', version: '1.2.0-beta.15' }))
  await put(source, 'lib/index.js', 'module.exports = {}')
  await put(source, 'lib/index.test.js', 'not runtime')
  await put(source, 'LICENSE', 'synthetic fixture license')
  await put(source, 'build/Release/pty.node', 'MZ wrong host build')
  await put(source, 'prebuilds/win32-x64/conpty.node', 'MZ wrong platform')
  const other = target === 'linux-arm64' ? 'linux-x64' : 'linux-arm64'
  await put(source, 'prebuilds/' + other + '/pty.node', syntheticBinary(other))
  await put(source, 'prebuilds/' + target + '/pty.node', syntheticBinary(target))
  if (target.startsWith('darwin-')) {
    await put(source, 'prebuilds/' + target + '/spawn-helper', syntheticBinary(target, true))
    await chmod(join(source, 'prebuilds/' + target + '/spawn-helper'), 0o644)
  }
  return source
}

async function inventory(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) files.push(...await inventory(root, path + '/'))
    else files.push(path)
  }
  return files.sort()
}

it.each(targets)('stages only %s native files and records target executable metadata', async (target) => {
  const root = await fixtureRoot()
  const systemSource = await systemFixture(root, target)
  const ptySource = await ptyFixture(root, target)
  const system = await systemPayload(systemSource, target)
  const pty = await ptyPayload(ptySource, target)
  const stage = join(root, 'stage')
  const systemPrefix = 'node_modules/@deepseek-ai/node-addon-system-' + target + '/'
  const ptyPrefix = 'node_modules/node-pty/'
  await copyPackage(systemSource, join(stage, systemPrefix), system.files)
  await copyPackage(ptySource, join(stage, ptyPrefix), pty.files)
  expect(await inventory(join(stage, ptyPrefix))).toEqual([
    'LICENSE', 'lib/index.js', 'package.json', 'prebuilds/' + target + '/pty.node',
    ...(target.startsWith('darwin-') ? ['prebuilds/' + target + '/spawn-helper'] : []),
  ])
  const executablePaths = new Set([
    ...[...system.executablePaths].map(path => systemPrefix + path),
    ...[...pty.executablePaths].map(path => ptyPrefix + path),
  ])
  await put(stage, 'package.json', '{}')
  await put(stage, 'helper.js', 'fixture')
  await put(stage, 'bootstrap.js', 'fixture')
  await chmod(join(stage, 'helper.js'), 0o755)
  const [platform, arch] = target.split('-') as ['linux' | 'darwin', 'x64' | 'arm64']
  await writeRuntimeManifest(stage, { version: '1.0.0', sourceCommit: 'a'.repeat(40), protocol: 1, platform, arch,
    helper: 'helper.js', bootstrap: 'bootstrap.js' }, executablePaths)
  const manifest = JSON.parse(await readFile(join(stage, 'runtime-manifest.json'), 'utf8')) as {
    files: { path: string; executable: boolean }[]
  }
  expect(manifest.files.filter(file => file.executable).map(file => file.path)).toEqual([
    target.startsWith('linux-') ? systemPrefix + 'bin/landlock-run' : ptyPrefix + 'prebuilds/' + target + '/spawn-helper',
  ])
})

it.each(['architecture', 'format', 'file type', 'Node-API', 'inventory', 'metadata'] as const)(
  'rejects native system %s failures through the canonical verifier', async (failure) => {
    const root = await fixtureRoot()
    const source = await systemFixture(root, 'linux-x64')
    const addon = syntheticBinary('linux-x64')
    if (failure === 'architecture') addon.writeUInt16LE(183, 18)
    if (failure === 'format') addon[0] = 0
    if (failure === 'file type') addon.writeUInt16LE(2, 16)
    if (failure === 'Node-API') addon.fill(0, 64)
    await put(source, 'bin/glibc/system.node', addon)
    if (failure === 'inventory') await put(source, 'bin/undeclared.node', addon)
    if (failure === 'metadata') {
      const metadata = await readFile(join(source, 'prebuilds.json'), 'utf8')
      await put(source, 'prebuilds.json', metadata.replace('"napi": 8', '"napi": 9'))
    }
    await expect(systemPayload(source, 'linux-x64')).rejects.toThrow('Command failed')
  },
)

it('rejects a native system package for another requested target', async () => {
  const source = await systemFixture(await fixtureRoot(), 'darwin-arm64')
  await expect(systemPayload(source, 'darwin-x64')).rejects.toThrow('target mismatch')
})

it.each(targets)('rejects a node-pty addon with the wrong architecture for %s', async (target) => {
  const source = await ptyFixture(await fixtureRoot(), target)
  const other = target.replace(target.endsWith('-x64') ? '-x64' : '-arm64', target.endsWith('-x64') ? '-arm64' : '-x64') as NativeTarget
  await put(source, 'prebuilds/' + target + '/pty.node', syntheticBinary(other))
  await expect(ptyPayload(source, target)).rejects.toThrow('architecture')
})

it('requires the reviewed node-pty version and its target addon', async () => {
  const source = await ptyFixture(await fixtureRoot(), 'linux-x64')
  await put(source, 'package.json', JSON.stringify({ version: '1.2.0-beta.14' }))
  await expect(ptyPayload(source, 'linux-x64')).rejects.toThrow('Unreviewed node-pty')
  await put(source, 'package.json', JSON.stringify({ version: '1.2.0-beta.15' }))
  await rm(join(source, 'prebuilds/linux-x64/pty.node'))
  await expect(ptyPayload(source, 'linux-x64')).rejects.toThrow('ENOENT')
})

it('requires the Darwin spawn helper with its target executable file type', async () => {
  const source = await ptyFixture(await fixtureRoot(), 'darwin-x64')
  await put(source, 'prebuilds/darwin-x64/spawn-helper', syntheticBinary('darwin-x64'))
  await expect(ptyPayload(source, 'darwin-x64')).rejects.toThrow('file type')
  await rm(join(source, 'prebuilds/darwin-x64/spawn-helper'))
  await expect(ptyPayload(source, 'darwin-x64')).rejects.toThrow('ENOENT')
})

it.each(['linux-x64', 'darwin-arm64'] as const)('rejects a wrong-format node-pty addon for %s', async (target) => {
  const source = await ptyFixture(await fixtureRoot(), target)
  await put(source, 'prebuilds/' + target + '/pty.node', Buffer.from('MZ windows binary'))
  await expect(ptyPayload(source, target)).rejects.toThrow(target.startsWith('linux-') ? 'ELF64' : 'Mach-O')
})
