/** Real Loader, JSON storage, credentials and bridge composition for keyless owner tests. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as DomainStorage from '@deepseek-ai/dsh-storage-domain'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import McpRegistry from '@deepseek-ai/dsh-mcp-client/registry'
import McpManagement from '../src/index.ts'

export async function createFixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-management-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  return directory
}

export async function bootFixture(options: {
  directory?: string
  profile?: string
  patches?: PatchOptions[]
  prepare?: (ctx: Context) => void
} = {}): Promise<{ ctx: Context; directory: string }> {
  const directory = options.directory ?? await createFixtureDirectory()
  const composition = await mkdtemp(join(directory, 'composition-'))
  const configFile = join(composition, 'cordis.yml')
  await writeFile(configFile, await readFile(resolve(import.meta.dirname, 'fixture.cordis.yml')))
  const ctx = await boot('mcp-management-fixture', configFile, [
    { id: 'json', config: { root: join(directory, 'storage') } },
    { id: 'credentials', config: { path: join(directory, 'credentials.yaml'), watch: false } },
    { id: 'manager', config: { profile: options.profile ?? 'fixture-profile' } },
    ...options.patches ?? [],
  ], (context) => {
    onTestFinished(async () => {
      await context.fiber.dispose()
      while (context.fiber.inertia !== undefined) await context.fiber.inertia
    })
    Object.assign(context.loader.builtins, {
      'mcp-fixture-prompt': SystemPrompt, 'mcp-fixture-tools': ToolRuntime,
      'mcp-fixture-storage': Storage, 'mcp-fixture-json': JsonStorage, 'mcp-fixture-domains': DomainStorage,
      'mcp-fixture-credentials': CredentialsLocal, 'mcp-fixture-registry': McpRegistry, 'mcp-fixture-manager': McpManagement,
    })
    options.prepare?.(context)
  })
  return { ctx, directory }
}
