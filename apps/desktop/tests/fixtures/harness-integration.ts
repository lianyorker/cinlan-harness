/** Isolated local-module scenario; no Electron app or model provider is launched. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadHarnessConfig } from '../../src/harness/config/loader.ts'
import { createLogger } from '../../src/harness/logging/logger.ts'
import { MemorySessionManager } from '../../src/harness/session/manager.ts'
import { MemoryToolRegistry } from '../../src/harness/tools/registry.ts'

const project = process.argv[2]
if (project === undefined) throw new Error('missing project directory')
const config = await loadHarnessConfig(project)
const logger = createLogger({ level: 'info', format: 'json', destination: join(project, 'logs', 'harness.log') })
const manager = new MemorySessionManager()
const registry = new MemoryToolRegistry()
const session = await manager.createSession(project)
const child = logger.child({ sessionId: session.id })
registry.register({
  definition: { name: 'write_note', description: 'Write the test note', parameters: [
    { name: 'text', type: 'string', description: 'Note text', required: true },
  ] },
  async execute(args) {
    if (typeof args.text !== 'string') throw new Error('text must be a string')
    const path = join(project, 'note.txt')
    await writeFile(path, args.text)
    return { success: true, output: path }
  },
})
child.info('Harness modules initialized', { model: config.llm.model, sessions: (await manager.listSessions()).length, tools: registry.list().length })
await session.setState('active')
await session.updateContext({ model: config.llm.model, task: 'write_note' })
const result = await registry.execute('write_note', { text: 'M3 local integration verified' })
await session.addEvent({ type: 'tool_executed', data: { name: 'write_note', success: result.success } })
await session.updateContext({ output: result.output })
child.info('Tool completed', { tool: 'write_note', success: result.success })
await session.setState('paused')
await session.setState('active')
const missing = await registry.execute('missing_tool', {})
const invalid = await registry.execute('write_note', { text: 42 })
await session.setState('error')
child.error('Tool failed', { tool: 'write_note', error: invalid.error })
await session.setState('idle')
await session.setState('completed')
registry.unregister('write_note')
await manager.deleteSession(session.id)
process.stdout.write(JSON.stringify({
  sessionId: session.id, model: config.llm.model, temperature: config.llm.temperature, fontSize: config.ui.fontSize,
  result, missing, invalid, state: session.getState(), context: session.getContext(),
  events: session.getHistory().map(event => event.type),
  sessions: (await manager.listSessions()).length, tools: registry.list().length,
}) + '\n')
