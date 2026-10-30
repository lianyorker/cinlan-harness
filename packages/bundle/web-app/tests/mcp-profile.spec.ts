/** Launch-profile resolution for the shipped MCP management row. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import McpManagement, { type Config } from '@deepseek-ai/dsh-mcp-management'
import { expect, it, onTestFinished } from 'vitest'

it.each(['web', 'desktop', 'custom-web'])('resolves MCP ownership from the launch profile: %s', async (profile) => {
  const rows = loadOverlayPatches('mcp-profile', fileURLToPath(new URL('../../cinlan-web/cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'mcp-management')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('@deepseek-ai/dsh-mcp-management')
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', {
    name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
    cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  })
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  let resolved: Config | undefined
  ctx.loader.builtins['mcp-config-observer'] = {
    Config: McpManagement.Config,
    apply: (_ctx: Context, config: Config) => { resolved = config },
  }
  await ctx.loader.root.update([{ ...rows[0]!, name: 'cordis:mcp-config-observer' }])
  await ctx.loader.await()
  expect(resolved).toEqual({ profile })
})
