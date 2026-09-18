/** Source-launch crash fixture: Loader boot is inert; the parent explicitly commands each run. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AutomationRequestId } from '../../src/types.ts'
import { bootRuntimeFixture } from './runtime.ts'

const home = process.argv[2]
const phase = process.argv[3]
if (home === undefined || (phase !== 'starting' && phase !== 'running')) throw new Error('Expected home and crash phase')
const fixture = await bootRuntimeFixture({
  home,
  ...(phase === 'starting' ? {
    modules: new Map([[new URL('./preset.ts', import.meta.url).href, {
      name: 'blocked-preset',
      inject: ['systemPrompt'],
      async apply(_ctx: Context) {
        process.send?.({ type: 'barrier', phase, snapshot: fixture.ctx.automationRuntime.snapshot(), calls: fixture.model.requests.length })
        await new Promise<void>(() => {})
      },
    }]]),
  } : {}),
})
process.send?.({ type: 'ready', calls: fixture.model.requests.length, snapshot: fixture.ctx.automationRuntime.snapshot() })
const message = await new Promise<unknown>((resolve) => { process.once('message', resolve) })
if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'run') {
  throw new Error('Fixture requires an explicit run command')
}
const runtime = fixture.ctx.automationRuntime
const created = await runtime.create(fixture.draft)
if (created.enabled || fixture.model.requests.length !== 0) throw new Error('Create must remain inert')
const enabled = await runtime.update({ id: created.id, expectedRevision: created.revision, draft: fixture.draft, enabled: true })
fixture.model.responses.push(async function* () {
  process.send?.({ type: 'barrier', phase, snapshot: runtime.snapshot(), calls: fixture.model.requests.length })
  await new Promise<void>(() => {})
  yield { type: 'finish', reason: { kind: 'stop' } }
})
await runtime.run({ id: enabled.id, expectedRevision: enabled.revision, requestId: brandString<AutomationRequestId>('crash-request') })
