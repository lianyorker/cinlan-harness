/** Loader-entry matching for the capability page's provider controls. */

/**
 * The entries that provide a capability, plus the bundle that composes those
 * entries as one row, so a bundle-managed deployment still renders its controls.
 */
export const PROVIDER_MATCHERS = {
  mobile: /^@deepseek-ai\/dsh-(?:mobile-device-adb|cinlan-mobile-device)$/i,
} as const
