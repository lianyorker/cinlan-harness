/** Mobile settings plugin: Android resources, device probes, and mirror actions. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { MobileResourceRequest, MobileResourceTaskId, MobileMirrorId } from '@deepseek-ai/dsh-mobile-device-runtime/types'
import type { Config } from '../config.ts'
import { MOBILE_CAPABILITY, type MobileSectionInjected } from './CapabilitySection.tsx'
import { createMobileResourceObserver } from './mobile-resources.ts'
import { registerCapabilitySection } from './capability-registration.ts'
import { createCapabilityShared, createDeviceProbe, createMobileDeviceList, createSdkProbe, mutateCapabilityPreferences } from './capability-shared.ts'

/** Dependencies owned by the Mobile registration. */
export const inject = [
  'settingsMetadata', 'slots', 'locale', 'remote',
  'remote.deviceCapabilities', 'remote.settings', 'settingsScope',
]

/** Register the Mobile feature inside its own Cordis fiber. */
export function apply(ctx: ClientContext, config: Config): void {
  const shared = createCapabilityShared(ctx)
  const { t } = shared
  const mobileSettings = ctx.settingsScope.bind<MobileDeviceSettings>({ namespace: 'mobile-device' })
  const mobileResources = createMobileResourceObserver(async (signal) => {
    const result = await ctx.remote.deviceCapabilities.mobileRuntimeStatus(signal)
    if (!result.ok) throw new Error(t('mobileResourcesReadFailed'))
    return result.value
  }, config.runtimePollIntervalMs)
  ctx.effect(() => mobileResources.dispose, 'ui-settings-security: mobile runtime observations')
  ctx.on('connection/reset', () => { mobileResources.refresh() })
  const checkDevice = createDeviceProbe(ctx, t)
  const checkSdk = createSdkProbe(ctx, t)
  const listMobileDevices = createMobileDeviceList(ctx, t)
  const saveMobileSettings = async (value: MobileDeviceSettings, revision: number): Promise<number> => mutateCapabilityPreferences(
    ctx, t, 'mobile-device', mobileSettings, [
      { op: 'set', path: ['enabled'], value: value.enabled },
      { op: 'set', path: ['androidSdkPath'], value: value.androidSdkPath },
      { op: 'set', path: ['defaultDeviceId'], value: value.defaultDeviceId },
    ], revision, 'preferencesFailed',
  )
  const resetMobileSettings = async (revision: number): Promise<void> => { await mutateCapabilityPreferences(
    ctx, t, 'mobile-device', mobileSettings,
    ['enabled', 'androidSdkPath', 'defaultDeviceId'].map(path => ({ op: 'unset' as const, path: [path] })),
    revision, 'preferencesFailed',
  ) }
  const injectSection = (): MobileSectionInjected => ({
    ...shared.providerActivation, definition: MOBILE_CAPABILITY,
    checkDevice, checkSdk, listMobileDevices,
    pickSdkDirectory: async (signal) => {
      const picker = ctx.get('remote.directoryPicker') as ClientContext['remote']['directoryPicker'] | undefined
      if (picker === undefined) throw new Error(t('mobileSdkPickFailed'))
      const result = await picker.pick(signal)
      if (!result.ok) throw new Error(t('mobileSdkPickFailed'))
      return result.value
    },
    openSdkDirectory: async (path, signal) => {
      signal.throwIfAborted()
      const session = ctx.get('remote.session') as ClientContext['remote']['session'] | undefined
      if (session === undefined) throw new Error(t('mobileSdkOpenFailed'))
      const available = await session.canOpenWorkspacePath()
      signal.throwIfAborted()
      if (!available.ok || !available.value) throw new Error(t('mobileSdkOpenFailed'))
      const result = await session.openWorkspacePath({ path,
        ...(/(?:^|[/\\])adb(?:\.exe)?$/i.test(path) ? { action: 'reveal' as const } : {}),
      }, signal)
      if (!result.ok) throw new Error(t('mobileSdkOpenFailed'))
    },
    hooks: { mobileSettings, mobileResources: mobileResources.store },
    watchMobileResources: mobileResources.watch, refreshMobileResources: mobileResources.refresh,
    runMobileResource: async (request: MobileResourceRequest) => {
      const result = await ctx.remote.deviceCapabilities.startMobileResource(request)
      if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
      mobileResources.refresh()
    },
    cancelMobileResource: async (taskId: MobileResourceTaskId) => {
      const result = await ctx.remote.deviceCapabilities.cancelMobileResource({ taskId })
      if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
      mobileResources.refresh()
    },
    startMobileMirror: async (deviceId: string) => {
      const result = await ctx.remote.deviceCapabilities.startMobileMirror({ deviceId })
      if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
      mobileResources.refresh()
    },
    closeMobileMirror: async (mirrorId: MobileMirrorId) => {
      const result = await ctx.remote.deviceCapabilities.closeMobileMirror({ mirrorId })
      if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
      mobileResources.refresh()
    },
    saveMobileSettings, resetMobileSettings,
  })
  registerCapabilitySection(ctx, shared, MOBILE_CAPABILITY, IconPanelLeftOutline16, injectSection)
}
