/** Electron-builder fields asserted by the Desktop release tests. */
export interface DesktopElectronBuilderConfig {
  readonly appId: string
  readonly extraMetadata: {
    readonly dshDesktopAppId: string
    readonly dshMandatoryUpdatePolicy?: ReturnType<typeof import('./scripts/desktop-policy-environment.mjs').resolveDesktopPolicyEnvironment>
  }
  readonly artifactName: string
  readonly npmRebuild: false
  readonly directories: {
    readonly output: string
  }
  readonly extraResources: readonly [
    { readonly from: string, readonly to: 'runtime' },
    { readonly from: string, readonly to: 'seed' },
  ]
  readonly mac: {
    readonly identity: string | undefined
    readonly forceCodeSigning: boolean
    readonly notarize: boolean
  }
  readonly dmg: {
    readonly sign: boolean
    readonly writeUpdateInfo: boolean
  }
  readonly artifactBuildCompleted: (artifact: { readonly file: string }) => Promise<void> | undefined
  readonly win: {
    readonly forceCodeSigning: boolean
    readonly signtoolOptions: {
      readonly sign: unknown
      readonly signingHashAlgorithms: readonly ['sha256']
    }
    readonly target: readonly ['nsis'] | readonly ['msi']
  }
  readonly msi: {
    readonly oneClick: false
    readonly warningsAsErrors: true
  }
  readonly nsis: {
    readonly oneClick: false
    readonly allowToChangeInstallationDirectory: true
    readonly differentialPackage: true
    readonly include: string
  }
  readonly publish: readonly [{ readonly provider: 'generic', readonly url: string, readonly channel: 'nightly' }]
}

/**
 * Create electron-builder configuration from one release environment.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform used when no explicit target is present.
 * @param hostArch - Build-host architecture used when no explicit target is present.
 * @returns electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopElectronBuilderConfig

declare const electronBuilderConfig: DesktopElectronBuilderConfig

export default electronBuilderConfig
