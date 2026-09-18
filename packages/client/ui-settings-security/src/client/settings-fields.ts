/** Public field descriptions; runtime values never enter settings search metadata. */
import type { CapabilityId } from './CapabilitySection.tsx'
import type { CapabilitySettingsKey } from './locales.ts'

/** A fixed public title and explanation for an owned DOM target. */
interface Field {
  readonly anchorId: string
  readonly title: CapabilitySettingsKey
  readonly description: CapabilitySettingsKey
}

/** Current Browser launch preferences, with no prototype-only options. */
export const BROWSER_FIELDS = [
  { key: 'homePage', anchorId: 'browser-homepage', title: 'browserHomePage', description: 'browserHomePageHelp' },
  { key: 'searchEngine', anchorId: 'browser-search-engine', title: 'browserSearchEngine', description: 'browserSearchEngineHelp' },
  { key: 'browserChannel', anchorId: 'browser-channel', title: 'browserChannelLabel', description: 'browserChannelHelp' },
  { key: 'headless', anchorId: 'browser-headless', title: 'browserHeadlessLabel', description: 'browserHeadlessHelp' },
  { key: 'viewportWidth', anchorId: 'browser-viewport-width', title: 'browserViewportWidth', description: 'browserViewportHelp' },
  { key: 'viewportHeight', anchorId: 'browser-viewport-height', title: 'browserViewportHeight', description: 'browserViewportHelp' },
  { key: 'profileName', anchorId: 'browser-profile', title: 'browserProfileName', description: 'browserProfileHelp' },
] as const satisfies readonly (Field & { readonly key: string })[]

/** Existing sidebar-owned routing fields shared by GUI and terminal hyperlinks. */
export const BROWSER_ROUTING_FIELDS = [
  { key: 'browserInterceptLinks', anchorId: 'browser-link-routing', title: 'browserRouteLinks', description: 'browserRouteLinksHelp' },
  { key: 'browserInterceptHttp', anchorId: 'browser-link-http', title: 'browserRouteHttp', description: 'browserRouteHttpHelp' },
  { key: 'browserInterceptHttps', anchorId: 'browser-link-https', title: 'browserRouteHttps', description: 'browserRouteHttpsHelp' },
] as const satisfies readonly (Field & { readonly key: string })[]

/** Metadata for available settings, actions, and capability guidance. */
export const CAPABILITY_FIELDS: Readonly<Record<CapabilityId, readonly Field[]>> = {
  browser: [
    ...BROWSER_FIELDS,
    ...BROWSER_ROUTING_FIELDS,
    { anchorId: 'browser-readiness', title: 'browserHeroTitle', description: 'browserProviderLimit' },
    { anchorId: 'browser-actions', title: 'browserSessionTitle', description: 'browserCookieDescription' },
    { anchorId: 'browser-transfers', title: 'browserTransfers', description: 'browserSelectPageFirst' },
    { anchorId: 'browser-usage', title: 'browserSkillTitle', description: 'browserSkillDescription' },
  ],
  computer: [
    { anchorId: 'computer-readiness', title: 'computerHeroTitle', description: 'computerInstallDescription' },
    { anchorId: 'computer-observations', title: 'computerMachine', description: 'computerLocalLimit' },
    { anchorId: 'computer-permissions', title: 'computerPermissions', description: 'computerPermissionsHelp' },
    { anchorId: 'computer-usage', title: 'computerHowToUse', description: 'computerHowToUseDescription' },
  ],
  mobile: [
    { anchorId: 'mobile-readiness', title: 'mobileAvailabilityTitle', description: 'deviceAvailableDescription' },
    { anchorId: 'mobile-enabled', title: 'mobileEnable', description: 'mobileEnableDescription' },
    { anchorId: 'mobile-sdk-path', title: 'mobileSdkCustomPath', description: 'mobileSdkPathHelp' },
    { anchorId: 'mobile-device', title: 'mobileDefaultDevice', description: 'mobileDefaultDeviceDescription' },
    { anchorId: 'mobile-detection', title: 'mobileDetectTitle', description: 'mobileDetectDescription' },
    { anchorId: 'mobile-usage', title: 'mobileAgentControl', description: 'mobileHowToUseDescription' },
  ],
  security: [
    { anchorId: 'security-readiness', title: 'securityHeroTitle', description: 'securityHeroDescription' },
    { anchorId: 'security-scope', title: 'securityScopeTitle', description: 'securityScopeEditorDescription' },
    { anchorId: 'security-egress', title: 'securityEgress', description: 'securityEgressHelp' },
    { anchorId: 'security-credentials', title: 'securityCredentials', description: 'securityCredentialsHelp' },
    { anchorId: 'security-report', title: 'securityReportTitle', description: 'securityReportDescription' },
  ],
}
