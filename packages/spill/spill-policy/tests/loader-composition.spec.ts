/**
 * Source-plane composition through the real Cordis Loader with local storage.
 * Published exports are checked separately by the build-dependent test:built script.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import LocalAttachments from '@deepseek-ai/dsh-attachment-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import * as SpillPolicy from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('spill-policy source Loader composition', () => {
  it('loads maxInlineTokens and retains an oversized result through the source entry', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-spill-policy-source-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      '    cwd: ' + JSON.stringify(root),
      "- name: '@deepseek-ai/dsh-attachment-local'",
      '  config:',
      '    dshHome: ' + JSON.stringify(join(root, 'home')),
      "- name: '@deepseek-ai/dsh-spill-local'",
      '  config:',
      '    root: ' + JSON.stringify(join(root, 'spill')),
      '    cleanupPeriodDays: 0',
      "- name: '@deepseek-ai/dsh-spill-policy'",
      '  config:',
      '    maxInlineTokens: 500',
      '',
    ].join('\n'))

    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-fs-local', FileSystem],
      ['@deepseek-ai/dsh-attachment-local', LocalAttachments],
      ['@deepseek-ai/dsh-spill-local', LocalSpillStore],
      ['@deepseek-ai/dsh-spill-policy', SpillPolicy],
    ])
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const module = modules.get(specifier)
        if (module === undefined) throw new Error('unexpected Loader import: ' + specifier)
        return module
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    const policyEntry = [...context.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-spill-policy')
    expect(policyEntry?.fiber).toBeDefined()

    expect(context.get('spillStore')).toBeDefined()
    expect(context.get('tools')).toBeDefined()
    expect(context.get('llm')).toBeDefined()
    const session = context.sessions.create(SessionId('source-policy'), { meta: { cwd: root } })
    const agent = { id: SessionId('source-agent'), session, options: {}, ctx: context } as Agent
    const policyContext = policyEntry!.fiber!.ctx
    const parent = scopeOf(policyContext)
    const agentScope = createScope(policyContext, agent, parent === undefined ? {} : { parent })
    await agentScope.ctx.fiber.await()
    const payload = 'retained '.repeat(500)
    context.tools.register(defineContentToolFixture({
      name: 'large', description: 'large', parameters: {},
      async execute(): Promise<ContentBlock[]> { return [{ type: 'text', text: payload }] },
    }))
    const result = await policyEntry!.fiber!.ctx.tools.execute({
      name: 'large', arguments: {}, callId: ToolCallId('source-policy-call'),
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    const preview = result.content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('')
    const marker = 'Full formatted result stored at: '
    const start = preview.indexOf(marker)
    if (start < 0) throw new Error('source policy did not emit a spill locator')
    const locatorStart = start + marker.length
    const locatorEnd = preview.indexOf('.txt.', locatorStart)
    if (locatorEnd < 0) throw new Error('source policy emitted an incomplete spill locator')
    const locator = preview.slice(locatorStart, locatorEnd + '.txt'.length)
    expect(await readFile(locator, 'utf8')).toBe(payload)
    await agentScope.dispose()
  }, 30_000)
})
