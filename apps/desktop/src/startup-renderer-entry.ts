/** Electron renderer entry for the shared application loading view. */
import { mountDesktopLoading } from './startup-renderer.ts'
import type { DesktopStartupApi } from './ipc.ts'

const root = document.getElementById('root')
const api = (window as Window & { readonly dshStartup?: DesktopStartupApi }).dshStartup
if (root === null || api === undefined) throw new Error('Desktop loading view is missing its root or lifecycle bridge')
mountDesktopLoading(root, api)
