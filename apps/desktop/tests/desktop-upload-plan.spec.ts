import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopUploadPlan } from '../scripts/desktop-upload-plan.ts'
import { desktopUpdateMetadataFilename } from '../scripts/desktop-auto-update-environment.mjs'
import type { DesktopPackageTargetName } from '../scripts/package-target.ts'

const temporaryDirectories: string[] = []
const TEST_ORIGIN = 'https://desktop-updates.example.com'
const TEST_BUCKET = 'test-download-bucket'
const PRODUCTION_BUCKET = 'production-download-bucket'

interface Fixture {
  readonly repositoryRoot: string
  readonly appRoot: string
  readonly artifactsRoot: string
  readonly environment: NodeJS.ProcessEnv
}

function digest(contents: string): string {
  return createHash('sha512').update(contents).digest('base64')
}

async function fixture(
  target: DesktopPackageTargetName,
  version = '1.2.3',
  environment: 'test' | 'production' = 'test',
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-upload-'))
  temporaryDirectories.push(root)
  const repositoryRoot = join(root, 'repository')
  const appRoot = join(repositoryRoot, 'apps', 'desktop')
  const artifactsRoot = join(appRoot, '.desktop-build', 'artifacts')
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(join(repositoryRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  await writeFile(join(appRoot, 'package.json'), `${JSON.stringify({ version })}\n`)

  const [os, arch] = target.split('-') as ['mac' | 'win', 'arm64' | 'x64']
  const base = `deepseek-harness-${version}-${os}-${arch}`
  const origin = environment === 'test'
    ? TEST_ORIGIN
    : 'https://download.deepseek.com'
  await writeFile(join(artifactsRoot, `${target}-release.json`), `${JSON.stringify({
    schemaVersion: 1,
    target,
    version,
    environment,
    publicUrl: `${origin}/_/harness/desktop/stable/${target}/`,
  })}\n`)

  if (os === 'mac') {
    const zip = 'signed macOS ZIP fixture'
    await writeFile(join(artifactsRoot, `${base}.zip`), zip)
    await writeFile(join(artifactsRoot, `${base}.zip.blockmap`), 'blockmap')
    await writeFile(join(artifactsRoot, `${base}.dmg`), 'notarized DMG fixture')
    await writeFile(join(artifactsRoot, desktopUpdateMetadataFilename(version, 'darwin')), `${JSON.stringify({
      version,
      files: [{ url: `${base}.zip`, size: Buffer.byteLength(zip), sha512: digest(zip) }],
    })}\n`)
  }
  else {
    const executable = 'signed NSIS executable fixture'
    await writeFile(join(artifactsRoot, `${base}.exe`), executable)
    await writeFile(join(artifactsRoot, `${base}.exe.blockmap`), 'blockmap')
    await writeFile(join(artifactsRoot, desktopUpdateMetadataFilename(version, 'win32')), `${JSON.stringify({
      version,
      files: [{
        url: `${base}.exe`,
        size: Buffer.byteLength(executable),
        sha512: digest(executable),
      }],
      path: `${base}.exe`,
      sha512: digest(executable),
    })}\n`)
  }
  return {
    repositoryRoot,
    appRoot,
    artifactsRoot,
    environment: environment === 'test'
      ? {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
        DOWNLOAD_TEST_ORIGIN: TEST_ORIGIN,
        DOWNLOAD_TEST_COS_BUCKET: TEST_BUCKET,
      }
      : {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
        DOWNLOAD_PROD_COS_BUCKET: PRODUCTION_BUCKET,
      },
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => rm(path, {
    recursive: true,
    force: true,
  })))
})

describe('desktop upload plan', () => {
  it('validates macOS artifacts and puts channel metadata last', async () => {
    const paths = await fixture('mac-arm64')
    const plan = await createDesktopUploadPlan('mac-arm64', paths)
    expect(plan).toMatchObject({
      environment: 'test',
      version: '1.2.3',
      publicUrl: 'https://desktop-updates.example.com/_/harness/desktop/stable/mac-arm64/',
      bucket: TEST_BUCKET,
    })
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-1.2.3-mac-arm64.dmg',
      'deepseek-harness-1.2.3-mac-arm64.zip',
      'deepseek-harness-1.2.3-mac-arm64.zip.blockmap',
      'nightly-mac.yml',
    ])
    expect(plan.artifacts.at(-1)).toMatchObject({
      channelMetadata: true,
      cacheControl: 'no-cache',
    })
  })

  it('uploads the prerelease channel metadata emitted by electron-builder', async () => {
    const paths = await fixture('mac-arm64', '1.2.3-alpha.4')
    const plan = await createDesktopUploadPlan('mac-arm64', paths)
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-1.2.3-alpha.4-mac-arm64.dmg',
      'deepseek-harness-1.2.3-alpha.4-mac-arm64.zip',
      'deepseek-harness-1.2.3-alpha.4-mac-arm64.zip.blockmap',
      'nightly-mac.yml',
    ])
  })

  it('uploads the Windows installer and external blockmap before production channel metadata', async () => {
    const paths = await fixture('win-x64', '2.0.0', 'production')
    const plan = await createDesktopUploadPlan('win-x64', paths)
    expect(plan.artifacts.map(artifact => artifact.filename)).toEqual([
      'deepseek-harness-2.0.0-win-x64.exe',
      'deepseek-harness-2.0.0-win-x64.exe.blockmap',
      'nightly.yml',
    ])
    expect(plan.artifacts[1]).toMatchObject({
      key: '_/harness/desktop/stable/win-x64/deepseek-harness-2.0.0-win-x64.exe.blockmap',
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      channelMetadata: false,
    })
    expect(plan.artifacts.at(-1)).toMatchObject({
      channelMetadata: true,
      cacheControl: 'no-cache',
    })
    expect(plan).toMatchObject({
      publicUrl: 'https://download.deepseek.com/_/harness/desktop/stable/win-x64/',
      bucket: PRODUCTION_BUCKET,
    })
  })

  it.each(['missing', 'empty'] as const)('rejects Windows artifacts with a %s blockmap companion', async (state) => {
    const paths = await fixture('win-x64')
    const blockmapPath = join(paths.artifactsRoot, 'deepseek-harness-1.2.3-win-x64.exe.blockmap')
    if (state === 'missing') await rm(blockmapPath)
    else await writeFile(blockmapPath, '')
    await expect(createDesktopUploadPlan('win-x64', paths)).rejects.toThrow(/missing or empty artifact.*\.exe\.blockmap/u)
  })

  it('rejects Windows installer bytes with the same size and a different digest', async () => {
    const paths = await fixture('win-x64')
    await writeFile(join(paths.artifactsRoot, 'deepseek-harness-1.2.3-win-x64.exe'), 'signed NSIS executable FIXTURE')
    await expect(createDesktopUploadPlan('win-x64', paths)).rejects.toThrow(/SHA-512.*metadata/u)
  })

  it('rejects a completed build from another dsh version or deployment', async () => {
    const paths = await fixture('mac-x64')
    await writeFile(join(paths.repositoryRoot, 'package.json'), '{"version":"1.2.4"}\n')
    await writeFile(join(paths.appRoot, 'package.json'), '{"version":"1.2.4"}\n')
    await expect(createDesktopUploadPlan('mac-x64', paths)).rejects.toThrow(/completion record.*1\.2\.4/u)

    const productionPaths = await fixture('mac-x64', '1.2.3', 'production')
    await expect(createDesktopUploadPlan('mac-x64', {
      ...productionPaths,
      environment: {
        DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
        DOWNLOAD_TEST_ORIGIN: TEST_ORIGIN,
        DOWNLOAD_TEST_COS_BUCKET: TEST_BUCKET,
      },
    })).rejects.toThrow(/completion record.*test/u)
  })

  it('rejects stale architecture metadata and modified updater bytes', async () => {
    const paths = await fixture('mac-arm64')
    const metadataPath = join(paths.artifactsRoot, 'nightly-mac.yml')
    const zipPath = join(paths.artifactsRoot, 'deepseek-harness-1.2.3-mac-arm64.zip')
    await writeFile(zipPath, 'modified')
    await expect(createDesktopUploadPlan('mac-arm64', paths)).rejects.toThrow(/size.*metadata/u)

    const x64 = 'wrong architecture'
    await writeFile(metadataPath, `${JSON.stringify({
      version: '1.2.3',
      files: [{
        url: 'deepseek-harness-1.2.3-mac-x64.zip',
        size: Buffer.byteLength(x64),
        sha512: digest(x64),
      }],
    })}\n`)
    await expect(createDesktopUploadPlan('mac-arm64', paths)).rejects.toThrow(/mac-arm64\.zip/u)
  })
})
