/** Shared application defaults keep mobile listeners independent across processes. */
import { fileURLToPath } from 'node:url'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { expect, it } from 'vitest'

it('uses an OS-assigned mobile listener port and permits an explicit fixed port', () => {
  const rows = loadOverlayPatches('mobile-listener-defaults', fileURLToPath(new URL('../../cinlan-web/cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'cinlan-mobile-host')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('@deepseek-ai/dsh-cinlan-remote-tunnel')
  expect(rows[0]!.config).toEqual({ port: 0, requireCinlanAccount: true })
  const configured = applyEntryPatches(rows, [{ id: 'cinlan-mobile-host', config: { port: 43081 } }],
    (message) => { throw new Error(message) })
  expect(configured[0]!.config).toEqual({ port: 43081 })
})
