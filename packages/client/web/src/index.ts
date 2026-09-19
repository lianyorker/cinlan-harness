/**
 * Web shell library entry. The shell's product is {@link AppWebEntry} —
 * apps/web's Vite entry runs it against #root. The separate ./boot-page entry
 * shares the loading view with Desktop; fiber-state projection remains internal.
 * The static module table defines the shared modules available to bundles.
 * @module @deepseek-ai/dsh-client-web
 */

export { AppWebEntry, type BootSeams } from './boot.ts'
export { getStaticModules } from './seed.ts'
export { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS, type PlatformModule } from './platform.ts'
