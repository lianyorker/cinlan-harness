/** Real Loader composition for execution binding, Agent setup and Session observation. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import ExecutionHostLocal from '@deepseek-ai/dsh-execution-host-local'
import Targets from '@deepseek-ai/dsh-execution-host-targets'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Bindings from '../src/index.ts'
import { remoteFixture } from './fixture-ssh.ts'

/**
 * Load production target, provider, Session and Agent services from an isolated cordis.yml.
 * @param options - optional real JSONL persistence for Agent publication tests.
 * @returns the owned Host context, local directory and remote endpoint factory.
 */
export async function createHarness(options: { persistence?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-binding-'))
  const localRoot = join(root, 'local')
  const ctx = new Context()
  const unregister: (() => void)[] = []
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally {
      for (const dispose of unregister) dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
  await mkdir(localRoot)
  await writeFile(join(localRoot, 'shared.txt'), 'local')
  const modules = new Map<string, unknown>([
    ['storage', Storage], ['storage-json', StorageJson], ['storage-domain', StorageDomain],
    ['fs-local', LocalFs], ['subprocess-local', LocalSubprocess], ['execution-host-local', ExecutionHostLocal],
    ['execution-host-targets', Targets], ['session', SessionStore], ['session-projection', SessionProjections],
    ['session-query-sqlite', SessionQuery], ['session-persistence-jsonl', SessionPersistenceJsonl],
    ['agent', AgentRegistry], ['agent-loop', AgentLoop],
    ['llm', LlmRuntime], ['tools', ToolRuntime], ['system-prompt', SystemPrompt], ['execution-binding', Bindings],
  ])
  const rows = [
    { name: 'storage' }, { name: 'storage-json', config: { root: join(root, 'storage') } },
    { name: 'storage-domain', config: { backend: 'json' } },
    { name: 'fs-local', config: { cwd: localRoot } }, { name: 'subprocess-local' }, { name: 'execution-host-local' },
    { name: 'execution-host-targets' }, { name: 'session' }, { name: 'session-projection' },
    ...options.persistence === true
      ? [{ name: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } }] : [],
    { name: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    { name: 'llm' }, { name: 'tools' }, { name: 'system-prompt', config: { personaPrefix: 'Binding fixture.' } },
    { name: 'agent' }, { name: 'agent-loop', config: { agents: [] } },
    { name: 'execution-binding', config: { sandboxMode: 'workspace-write' } },
  ]
  const file = join(root, 'cordis.yml')
  await writeFile(file, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected binding fixture import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  return {
    ctx, root, localRoot,
    /** Save an independently addressable deployed SSH target. */
    async remote(label: string) {
      const fixture = remoteFixture(label)
      unregister.push(() => { fixture.unregister() })
      const { target } = await ctx.executionHostTargets.create({
        label, sshAlias: 'inspection', execution: {
          endpoint: { host: fixture.world.host, port: 22, username: 'fixture',
            privateKeyFile: join(root, 'unused-key'), hostKeySHA256: 'a'.repeat(64) },
          node: '/usr/bin/node', helper: '/opt/helper.mjs', helperHash: 'b'.repeat(64), workspace: '/project',
          bootstrapPath: '/opt/bootstrap.mjs', bootstrapHash: 'c'.repeat(64),
        },
      })
      const binding = ctx.executionHostTargets.snapshotExecution({ id: target.id, revision: target.revision })
      return { world: fixture.world, target, binding }
    },
  }
}
