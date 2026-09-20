/** Build-time native payload selection; the native-system repository owns its binary verifier. */
import { execFileSync } from 'node:child_process'
import { globSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** POSIX runtime platforms supported by the release producer. */
export type NativeTarget = 'linux-x64' | 'linux-arm64' | 'darwin-x64' | 'darwin-arm64'

/** Explicit package-relative native files and executable permissions. */
export interface NativePayload {
  files: string[]
  executablePaths: ReadonlySet<string>
}

interface Prebuilds {
  platform: string
  binaries: { path: string; kind: string; tool: string }[]
}

/**
 * Run the canonical repository verifier and derive executable paths from verified metadata.
 * @param source - Installed target platform package directory.
 * @param target - Intended release platform and architecture.
 * @returns Exact native package files and target executable paths, independent of host mode bits.
 */
export async function systemPayload(source: string, target: NativeTarget): Promise<NativePayload> {
  const verifier = new URL('../../../../native/system/scripts/repo.mjs', import.meta.url).href
  execFileSync(process.execPath, ['--input-type=module', '--eval',
    'const { verifyPlatformBinaries } = await import(process.argv[1]); verifyPlatformBinaries(process.argv[2]);',
    verifier, source], { stdio: 'inherit' })
  // The repository verifier validates binary records before this metadata is consumed.
  const metadata = JSON.parse(await readFile(join(source, 'prebuilds.json'), 'utf8')) as Prebuilds
  if (metadata.platform !== target) throw new Error('Native system prebuild target mismatch: ' + target)
  const paths = metadata.binaries.map(binary => binary.path)
  const required = target.startsWith('linux-')
    ? ['bin/landlock-run', 'bin/glibc/system.node', 'bin/musl/system.node'] : ['bin/system.node']
  if (required.some(path => !paths.includes(path))) throw new Error('Incomplete native system prebuild inventory: ' + target)
  const executablePaths = new Set<string>()
  for (const binary of metadata.binaries) {
    if (binary.kind === 'static-musl' && binary.tool === 'landlock-run' && target.startsWith('linux-')) {
      if (binary.path !== 'bin/landlock-run') throw new Error('Unexpected Landlock executable path: ' + binary.path)
      executablePaths.add(binary.path)
    }
  }
  return { files: ['prebuilds.json', ...paths], executablePaths }
}

async function verifyPtyBinary(source: string, path: string, target: NativeTarget, executable: boolean): Promise<void> {
  const filename = join(source, path)
  if (!(await lstat(filename)).isFile()) throw new Error('node-pty native input is not a regular file: ' + path)
  const bytes = await readFile(filename)
  const x64 = target.endsWith('-x64')
  if (target.startsWith('linux-')) {
    if (bytes.length < 64 || bytes.readUInt32LE(0) !== 0x464c457f || bytes[4] !== 2 || bytes[5] !== 1) {
      throw new Error('node-pty prebuild is not little-endian ELF64: ' + path)
    }
    if (bytes.readUInt16LE(18) !== (x64 ? 62 : 183) || bytes.readUInt16LE(16) !== 3) {
      throw new Error('node-pty prebuild has wrong ELF architecture or file type: ' + path)
    }
  } else {
    if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf) {
      throw new Error('node-pty prebuild is not Mach-O 64-bit: ' + path)
    }
    if (bytes.readUInt32LE(4) !== (x64 ? 0x01000007 : 0x0100000c) || bytes.readUInt32LE(12) !== (executable ? 2 : 8)) {
      throw new Error('node-pty prebuild has wrong Mach-O architecture or file type: ' + path)
    }
  }
}

/**
 * Select the reviewed node-pty release's JavaScript and target prebuilds; ABI execution is verified on the target host.
 * @param source - Installed node-pty package directory.
 * @param target - Intended release platform and architecture.
 * @returns Published runtime patterns with only the target addon and Darwin spawn helper.
 */
export async function ptyPayload(source: string, target: NativeTarget): Promise<NativePayload> {
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { version: string }
  if (manifest.version !== '1.2.0-beta.15') throw new Error('Unreviewed node-pty prebuild layout: ' + manifest.version)
  const addon = 'prebuilds/' + target + '/pty.node'
  await verifyPtyBinary(source, addon, target, false)
  const files = ['lib/**/*.js', '!lib/**/*.test.js', addon]
  const executablePaths = new Set<string>()
  if (target.startsWith('darwin-')) {
    const helper = 'prebuilds/' + target + '/spawn-helper'
    await verifyPtyBinary(source, helper, target, true)
    files.push(helper)
    executablePaths.add(helper)
  }
  return { files, executablePaths }
}

/**
 * Copy explicitly selected package files without dependency directories or symbolic links.
 * @param source - Installed package directory.
 * @param destination - Empty staged package directory.
 * @param files - Published file patterns or a reviewed target-specific selection.
 * @returns Resolves once all selected files and package metadata have been copied.
 */
export async function copyPackage(source: string, destination: string, files: readonly string[] = ['*']): Promise<void> {
  const selected = new Set<string>()
  async function add(path: string): Promise<void> {
    if (path.split('/').some(part => part === 'node_modules' || part === '.git') || path.endsWith('.tsbuildinfo')) return
    const entry = await lstat(join(source, path))
    if (entry.isSymbolicLink()) throw new Error('Materialized package input contains a symlink: ' + path)
    if (entry.isDirectory()) {
      for (const child of await readdir(join(source, path))) await add(path + '/' + child)
    } else if (entry.isFile()) selected.add(path)
  }
  const patterns = [...files, 'package.json', 'README*', 'LICENSE*', 'LICENCE*', 'NOTICE*']
  for (const pattern of patterns.filter(value => !value.startsWith('!'))) {
    for (const path of globSync(pattern, { cwd: source })) await add(path.replaceAll('\\', '/'))
  }
  for (const pattern of patterns.filter(value => value.startsWith('!'))) {
    for (const path of globSync(pattern.slice(1), { cwd: source })) selected.delete(path.replaceAll('\\', '/'))
  }
  for (const path of selected) {
    const target = join(destination, path)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(source, path), target, { dereference: false })
  }
}
