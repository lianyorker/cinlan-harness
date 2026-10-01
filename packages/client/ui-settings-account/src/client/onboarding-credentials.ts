/** Desktop login owns model-credential discovery for both welcome and onboarding. */

/**
 * Read the same safe credential fact used by native login.
 * @returns configured API-key presence; rejects when the desktop bridge is unavailable.
 */
export async function readOnboardingApiKeyPresence(): Promise<boolean> {
  const carrier = (globalThis as typeof globalThis & {
    clhOnboarding?: { hasApiKey(): Promise<boolean> }
    dshOnboarding?: { hasApiKey(): Promise<boolean> }
  })
  const bridge = carrier.clhOnboarding ?? carrier.dshOnboarding
  if (bridge === undefined) throw new Error('desktop login bridge unavailable')
  return bridge.hasApiKey()
}
