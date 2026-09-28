/** Published export/Loader smoke; requires workspace build:lib:host artifacts. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

test('published spill-policy namespace loads its configuration through Loader', async (t) => {
  assert.equal('default' in SpillPolicy, false)
  assert.equal(SpillPolicy.name, 'spill-policy')
  assert.deepEqual(SpillPolicy.inject, ['tools'])
  assert.equal(typeof SpillPolicy.apply, 'function')
  assert.equal(typeof SpillPolicy.Config, 'function')

  const root = await mkdtemp(join(tmpdir(), 'dsh-spill-policy-built-loader-'))
  const context = new Context()
  t.after(async () => {
    try {
      await context.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  const policyUrl = import.meta.resolve('@deepseek-ai/dsh-spill-policy')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: ' + JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-system-prompt')),
    '- name: ' + JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-tools')),
    '- name: ' + JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-llm')),
    '- name: ' + JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-session')),
    '- name: ' + JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-spill-local')),
    '  config:',
    '    root: ' + JSON.stringify(join(root, 'spill')),
    '    cleanupPeriodDays: 0',
    '- name: ' + JSON.stringify(policyUrl),
    '  config:',
    '    maxInlineTokens: 500',
    '',
  ].join('\n'))
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  const entry = [...context.loader.entries()].find(entry => entry.options.name === policyUrl)
  // FiberState.ACTIVE is the erased const-enum value 2 (vendor/cordis/src/fiber.ts).
  assert.equal(entry?.fiber?.state, 2)
  assert.equal(entry.fiber.config.maxInlineTokens, 500)
  const policyContext = entry.fiber.ctx
  const session = context.sessions.create(SessionId('built-policy'), { meta: { cwd: root } })
  const agent = { id: SessionId('built-agent'), session, options: {}, ctx: context }
  const parent = scopeOf(policyContext)
  const scope = createScope(policyContext, agent, parent === undefined ? {} : { parent })
  await scope.ctx.fiber.await()
  const payload = 'retained '.repeat(500)
  context.effect(() => context.tools.register(defineContentToolFixture({
    name: 'large', description: 'large', parameters: {},
    async execute() { return [{ type: 'text', text: payload }] },
  })))
  const result = await policyContext.tools.execute({
    name: 'large', arguments: {}, callId: ToolCallId('built-policy-call'),
    agent, signal: new AbortController().signal,
  })
  assert.equal(result.isError, false)
  const preview = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  const marker = 'Full formatted result stored at: '
  const start = preview.indexOf(marker)
  assert.notEqual(start, -1, 'published policy must emit a spill locator')
  const locatorStart = start + marker.length
  const locatorEnd = preview.indexOf('.txt.', locatorStart)
  assert.notEqual(locatorEnd, -1, 'published policy must emit a complete spill locator')
  assert.equal(await readFile(preview.slice(locatorStart, locatorEnd + '.txt'.length), 'utf8'), payload)
})
