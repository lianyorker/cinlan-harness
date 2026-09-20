/** Sign unsigned Windows payload binaries through the existing token signer before executing them. */
import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { lstat, open, readdir, readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { smokePrimaryRuntime } from './prepare-primary-runtime.ts'
import { createWindowsTokenSigner, scrubWindowsSigningEnvironment } from './windows-sign.mjs'

interface RuntimeSignature {
  readonly status: string
  readonly timestamped: boolean
  readonly thumbprint: string | null
}

async function inspectSignature(path: string): Promise<RuntimeSignature> {
  // Explicit module paths avoid inheriting PowerShell 7 modules into Windows PowerShell 5.
  const { stdout, stderr } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); '
    + 'Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop; '
    + 'Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop; '
    + '$s=Get-AuthenticodeSignature -LiteralPath $env:DSH_RUNTIME_VERIFY_FILE; '
    + '[pscustomobject]@{status=[string]$s.Status;timestamped=($null -ne $s.TimeStamperCertificate);thumbprint=$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress'], {
    env: { ...scrubWindowsSigningEnvironment(process.env), DSH_RUNTIME_VERIFY_FILE: path },
    encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024,
  })
  const value: unknown = JSON.parse(stdout)
  if (stderr || typeof value !== 'object' || value === null
    || !('status' in value) || typeof value.status !== 'string'
    || !('timestamped' in value) || typeof value.timestamped !== 'boolean'
    || !('thumbprint' in value) || !(value.thumbprint === null
      || typeof value.thumbprint === 'string' && /^[A-F0-9]{40}$/iu.test(value.thumbprint))) {
    throw new Error(`primary runtime: invalid signature inspection: ${path}`)
  }
  return { status: value.status, timestamped: value.timestamped, thumbprint: value.thumbprint }
}

/**
 * Enumerate Windows code without following links or selecting foreign native addons.
 * @param root - Owned, materialized runtime directory.
 * @returns Sorted PE paths; rejects links and malformed Windows executable files.
 */
export async function windowsRuntimeCode(root: string): Promise<string[]> {
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('primary runtime: expected a real directory')
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`primary runtime: directory links are not signable: ${path}`)
    if (entry.isDirectory()) { files.push(...await windowsRuntimeCode(path)); continue }
    const extension = extname(path).toLowerCase()
    if (!entry.isFile() || !['.exe', '.dll', '.pyd', '.node'].includes(extension)) continue
    const file = await open(path, 'r')
    let portableExecutable = false
    let windowsCandidate = false
    try {
      const header = Buffer.alloc(64)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      windowsCandidate = bytesRead >= 2 && header.readUInt16LE(0) === 0x5a4d
      if (bytesRead === 64 && windowsCandidate) {
        const signature = Buffer.alloc(4)
        const offset = header.readUInt32LE(0x3c)
        const read = await file.read(signature, 0, 4, offset)
        portableExecutable = offset >= 64 && read.bytesRead === 4 && signature.readUInt32LE(0) === 0x4550
      }
    } finally { await file.close() }
    if (portableExecutable) files.push(path)
    else if (windowsCandidate || extension !== '.node') throw new Error(`primary runtime: invalid PE file: ${path}`)
  }
  return files.sort()
}

interface RuntimeSigningOptions {
  readonly thumbprint: string
  readonly sign: ReturnType<typeof createWindowsTokenSigner>
  readonly inspect?: (path: string) => Promise<RuntimeSignature>
  readonly smoke?: (root: string) => void
}

/**
 * Preserve trusted vendor signatures and sign unsigned binaries sequentially before smoke checks.
 * @param root - Final primary payload directory.
 * @param options - Token signer, public certificate fingerprint, and executable verification operations.
 * @returns Resolves after every signature verifies and smoke checks pass; failures stop without retries.
 */
export async function signWindowsPrimaryRuntime(root: string, options: RuntimeSigningOptions): Promise<void> {
  const inspect = options.inspect ?? inspectSignature
  const files = await windowsRuntimeCode(root)
  if (files.length === 0) throw new Error('primary runtime: no Windows code found')
  const unsigned: string[] = []
  for (const path of files) {
    const signature = await inspect(path)
    if (signature.status === 'NotSigned') unsigned.push(path)
    else if (signature.status !== 'Valid') throw new Error(`primary runtime: refusing ${signature.status} signature: ${path}`)
  }
  for (const path of unsigned) {
    await options.sign({ path, hash: 'sha256', isNest: false })
    const signature = await inspect(path)
    if (signature.status !== 'Valid' || !signature.timestamped
      || signature.thumbprint?.toUpperCase() !== options.thumbprint.toUpperCase()) {
      throw new Error(`primary runtime: signing verification failed: ${path}`)
    }
  }
  const smoke = options.smoke ?? smokePrimaryRuntime
  smoke(root)
}

async function main(): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64' || resolveDesktopBuildTarget() !== 'win-x64') {
    throw new Error('primary runtime signing requires Windows x64')
  }
  const certificateFile = process.env.DSH_DESKTOP_WINDOWS_CER_FILE
  if (!certificateFile) throw new Error('primary runtime signing requires the configured certificate')
  const thumbprint = new X509Certificate(await readFile(certificateFile)).fingerprint.replaceAll(':', '')
  await signWindowsPrimaryRuntime(join(resolveDesktopTargetBuildPaths().runtime, 'primary-runtime'), {
    thumbprint,
    sign: createWindowsTokenSigner({ certificateFile, signTool: process.env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
      keyContainer: process.env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER, tokenPin: process.env.DSH_DESKTOP_WINDOWS_TOKEN_PIN }),
  })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
