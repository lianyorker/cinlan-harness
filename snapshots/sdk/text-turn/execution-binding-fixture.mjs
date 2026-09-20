/** SDK projection fixture for execution-aware Agent publication without remote providers. */
export const name = 'snapshot-execution-binding'

const local = Object.freeze({ kind: 'local' })

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - Composed SDK runtime context.
 */
export function apply(ctx) {
  const published = new Map()
  ctx.provide('executionBindings', {
    async bindingForSession(sessionId) {
      const binding = published.get(sessionId)
      if (binding === undefined) throw new Error('Snapshot Session execution is not published')
      return binding
    },
    async setup(_agentCtx, agent, requested) {
      const recorded = agent.session.snapshotEvents().find(event => event.type === 'execution/bound')?.data.binding
      const binding = requested ?? recorded ?? local
      if (recorded === undefined) agent.session.append('execution/bound', { binding })
      return { commit() { published.set(agent.id, binding) } }
    },
  })
}
