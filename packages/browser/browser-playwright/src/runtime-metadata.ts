/** Pinned Playwright registry adapter; no browser process or installer runs during metadata lookup. */
import { createRequire } from 'node:module'
import { dirname, relative, join } from 'node:path'

const require = createRequire(import.meta.url)
interface Executable {
  executablePath(): string | undefined
  directory?: string
  revision?: string
  browserVersion?: string
  downloadURLs?: string[]
}
// Playwright publishes this registry entry without declarations; this adapter owns its pinned API.
const bundle = require('playwright-core/lib/coreBundle') as {
  registry: { registry: { findExecutable(name: string): Executable }; registryDirectory: string }
}
const packageInfo = require('playwright-core/package.json') as { version: string }
const chromium = bundle.registry.registry.findExecutable('chromium')
const executable = chromium.executablePath()
if (!chromium.directory || !executable || !chromium.revision || !chromium.browserVersion) {
  throw new Error('Pinned Playwright does not support managed Chromium on this platform')
}
/** Platform-specific paths and versions supplied by the installed, pinned runtime. */
export const runtimeMetadata = {
  playwrightVersion: packageInfo.version,
  revision: chromium.revision,
  browserVersion: chromium.browserVersion,
  executableRelative: relative(bundle.registry.registryDirectory, executable),
  markerRelative: relative(bundle.registry.registryDirectory, join(chromium.directory, 'INSTALLATION_COMPLETE')),
  cliPath: join(dirname(require.resolve('playwright-core/package.json')), 'cli.js'),
  downloadOrigins: [...new Set((chromium.downloadURLs ?? []).map(url => new URL(url).origin))],
}
/** Resolve a system channel through Playwright's platform registry without launching it.
 * @param channel - Supported system installation.
 * @returns Expected executable path; absence does not imply installation.
 */
export function systemExecutable(channel: 'chrome' | 'msedge'): string | undefined {
  return bundle.registry.registry.findExecutable(channel).executablePath()
}
