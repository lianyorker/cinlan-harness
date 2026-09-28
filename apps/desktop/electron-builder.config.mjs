import { resolve } from 'node:path'
import {
  resolveMacOSNotarizationEnvironment,
  resolveMacOSSigningEnvironment,
} from './scripts/desktop-release-environment.mjs'
import { notarizeMacOSDiskImageArtifact } from './scripts/notarize-macos-disk-images.mjs'
import { verifyMacOSSignatureAfterSign } from './scripts/verify-macos-signature.mjs'
import {
  createWindowsTokenSigner,
  installWindowsNsisBootstrapSigner,
} from './scripts/windows-sign.mjs'
import { resolveDesktopAutoUpdateConfig } from './scripts/desktop-auto-update-environment.mjs'
import { desktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'
import { resolveDesktopPolicyEnvironment } from './scripts/desktop-policy-environment.mjs'

/**
 * Create electron-builder configuration from one release environment.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform used when no explicit target is present.
 * @param {string} hostArch - Build-host architecture used when no explicit target is present.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env = process.env,
  hostPlatform = process.platform,
  hostArch = process.arch,
) {
  const appId = env.DSH_DESKTOP_APP_ID?.trim() || 'com.cinlan.harness'
  const policyConfigured = env.DSH_DESKTOP_AUTO_UPDATE_ENV === 'production'
    || env.DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN !== undefined
    || env.DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN !== undefined
    || env.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG !== undefined
  const policy = policyConfigured ? resolveDesktopPolicyEnvironment(env) : undefined
  const targetPlatform = env.DSH_DESKTOP_TARGET_PLATFORM
  const resolvedPlatform = targetPlatform ?? hostPlatform
  const resolvedArch = env.DSH_DESKTOP_TARGET_ARCH ?? hostArch
  const packagesMacOS = targetPlatform === 'darwin' || (targetPlatform === undefined && hostPlatform === 'darwin')
  const packagesWindows = targetPlatform === 'win32' || (targetPlatform === undefined && hostPlatform === 'win32')
  const unsignedWindows = packagesWindows && env.DSH_DESKTOP_UNSIGNED === '1'
  const installerTarget = env.DSH_DESKTOP_INSTALLER_TARGET ?? 'nsis'
  if (packagesWindows && !['nsis', 'msi'].includes(installerTarget)) {
    throw new Error('desktop release environment: DSH_DESKTOP_INSTALLER_TARGET must be nsis or msi')
  }
  if (!packagesWindows && installerTarget !== 'nsis') {
    throw new Error('desktop release environment: MSI packaging is supported only for Windows')
  }
  if (packagesWindows && env.DSH_DESKTOP_UNSIGNED !== undefined
    && env.DSH_DESKTOP_UNSIGNED !== '' && env.DSH_DESKTOP_UNSIGNED !== '0' && env.DSH_DESKTOP_UNSIGNED !== '1') {
    throw new Error('desktop release environment: DSH_DESKTOP_UNSIGNED must be 1 for deliberate unsigned Windows packaging')
  }
  const macOSSigning = packagesMacOS ? resolveMacOSSigningEnvironment(env) : undefined
  if (packagesMacOS) resolveMacOSNotarizationEnvironment(env)
  const windowsSigner = packagesWindows && !unsignedWindows
    ? createWindowsTokenSigner({
        certificateFile: env.DSH_DESKTOP_WINDOWS_CER_FILE,
        signTool: env.DSH_DESKTOP_WINDOWS_SIGNTOOL,
        tokenPin: env.DSH_DESKTOP_WINDOWS_TOKEN_PIN,
        keyContainer: env.DSH_DESKTOP_WINDOWS_KEY_CONTAINER,
      })
    : undefined
  if (windowsSigner !== undefined) {
    installWindowsNsisBootstrapSigner({ sign: windowsSigner })
  }
  const update = resolveDesktopAutoUpdateConfig(
    { ...env, DOWNLOAD_TEST_ORIGIN: env.DOWNLOAD_TEST_ORIGIN || 'https://desktop-updates.example.com' },
    resolvedPlatform,
    resolvedArch,
  )
  const buildPaths = desktopTargetBuildPaths(update.target)
  const builderOutput = env.DSH_DESKTOP_BUILDER_OUTPUT?.trim()
  return {
    appId,
    extraMetadata: { dshDesktopAppId: appId, ...(policy === undefined ? {} : { dshMandatoryUpdatePolicy: policy }) },
    productName: 'DeepSeek Harness',
    artifactName: unsignedWindows
      ? 'deepseek-harness-${version}-${os}-${arch}-unsigned.${ext}'
      : 'deepseek-harness-${version}-${os}-${arch}.${ext}',
    directories: { output: builderOutput || buildPaths.artifacts },
    npmRebuild: false,
    asar: true,
    files: [
      'lib/*.js',
      'lib/*.cjs',
      'lib/renderer/**/*',
      'renderer/**/*',
      'package.json',
    ],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      { from: buildPaths.seed, to: 'seed' },
    ],
    mac: {
      category: 'public.app-category.developer-tools',
      identity: macOSSigning?.signingIdentity,
      forceCodeSigning: true,
      hardenedRuntime: true,
      notarize: true,
      target: ['dmg', 'zip'],
    },
    dmg: {
      sign: true,
      writeUpdateInfo: false,
    },
    afterSign: context => {
      if (context.electronPlatformName !== 'darwin') return
      verifyMacOSSignatureAfterSign(context, macOSSigning ?? resolveMacOSSigningEnvironment(env))
    },
    artifactBuildCompleted: artifact => {
      if (!artifact.file.endsWith('.dmg')) return
      return notarizeMacOSDiskImageArtifact(
        artifact,
        env,
        macOSSigning ?? resolveMacOSSigningEnvironment(env),
      )
    },
    win: {
      icon: 'icon.ico',
      forceCodeSigning: windowsSigner !== undefined,
      signtoolOptions: {
        sign: windowsSigner,
        signingHashAlgorithms: ['sha256'],
      },
      target: installerTarget === 'msi' ? ['msi'] : ['nsis'],
    },
    msi: {
      oneClick: false,
      warningsAsErrors: true,
    },
    linux: {
      category: 'Development',
      target: ['AppImage'],
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      differentialPackage: true,
      include: resolve(import.meta.dirname, 'scripts/installer.nsh'),
    },
    publish: [{ provider: 'generic', url: update.publicUrl, channel: 'nightly' }],
  }
}

export default createElectronBuilderConfig()
