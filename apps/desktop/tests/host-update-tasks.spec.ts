import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import { installDesktopUpdateTaskControl } from '../../desktop-host/src/update-tasks.ts'

function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const agents: { status: string; inbox: { nextTurn: unknown[]; nextStep: unknown[] } }[] = []
  const jobs = new Map<unknown, { status: string }[]>()
  ctx.provide('agents', { list: () => agents } as never)
  ctx.provide('jobs', { list: (owner: unknown) => jobs.get(owner) ?? [] } as never)
  return { ctx, agents, jobs, control: installDesktopUpdateTaskControl(ctx) }
}

describe('native Desktop task admission', () => {
  it('drains delegated operations with local work and refuses invocation after locking', async () => {
    const { control, ctx } = fixture()
    const result = Promise.withResolvers<string>()
    const admitted = control.admit(() => result.promise)
    const locked = control.run('lock')
    let invoked = false
    await expect(control.admit(() => { invoked = true; return 'unexpected' })).rejects.toThrow('admission is closed')
    expect(invoked).toBe(false)
    result.resolve('delegated result')
    await expect(admitted).resolves.toBe('delegated result')
    await expect(locked).resolves.toBe(false)
    await control.run('unlock')
    await expect(control.admit(() => 'admitted again')).resolves.toBe('admitted again')
    await ctx.fiber.dispose()
    await expect(control.admit(() => { invoked = true })).rejects.toThrow('admission is closed')
    expect(invoked).toBe(false)
  })

  it.each(['running', 'nextTurn', 'nextStep', 'unowned job', 'owned job'])('detects %s work', async (kind) => {
    const { control, agents, jobs } = fixture()
    const agent = { status: 'idle', inbox: { nextTurn: [] as unknown[], nextStep: [] as unknown[] } }
    agents.push(agent)
    if (kind === 'running') agent.status = 'running'
    if (kind === 'nextTurn') agent.inbox.nextTurn.push({})
    if (kind === 'nextStep') agent.inbox.nextStep.push({})
    if (kind === 'unowned job') jobs.set(undefined, [{ status: 'running' }])
    if (kind === 'owned job') jobs.set(agent, [{ status: 'stopping' }])
    await expect(control.run('inspect')).resolves.toBe(true)
  })

  it('drains dispatch mutations while refusing new work and leaves response streams open', async () => {
    const { control, jobs } = fixture()
    const mutation = Promise.withResolvers<undefined>()
    const responseBody = new ReadableStream<Uint8Array>()
    const dispatch = control.dispatch(async () => {
      await mutation.promise
      jobs.set(undefined, [{ status: 'running' }])
      return new Response(responseBody)
    })
    let locked = false
    const lock = control.run('lock').then((active) => { locked = true; return active })
    expect((await control.dispatch(async () => { throw new Error('must not dispatch') })).status).toBe(503)
    expect(locked).toBe(false)
    mutation.resolve(undefined)
    const response = await dispatch
    await expect(lock).resolves.toBe(true)
    jobs.clear()
    await expect(control.run('lock')).resolves.toBe(false)
    await response.body?.cancel()
    await control.run('unlock')
    expect((await control.dispatch(async () => new Response(null, { status: 204 }))).status).toBe(204)
  })

  it.each(['unlock', 'dispose', 'replacement lock'])('invalidates a draining lock on %s', async (kind) => {
    const { ctx, control } = fixture()
    const mutation = Promise.withResolvers<Response>()
    const dispatch = control.dispatch(() => mutation.promise)
    const first = expect(control.run('lock')).rejects.toThrow(kind === 'dispose' ? 'stopping' : 'superseded')
    let replacement: Promise<boolean> | undefined
    if (kind === 'unlock') await control.run('unlock')
    if (kind === 'dispose') await ctx.fiber.dispose()
    if (kind === 'replacement lock') replacement = control.run('lock')
    await first
    mutation.resolve(new Response())
    await dispatch
    await replacement
  })

  it('rejects missing task services and releases a failed dispatch', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const control = installDesktopUpdateTaskControl(ctx)
    await expect(control.run('inspect')).rejects.toThrow('services are unavailable')
    await expect(control.run('lock')).rejects.toThrow('services are unavailable')
    await expect(control.run('unlock')).rejects.toThrow('services are unavailable')
    ctx.provide('agents', { list: () => [] } as never)
    ctx.provide('jobs', { list: () => [] } as never)
    await expect(control.dispatch(() => Promise.reject(new Error('mutation failed')))).rejects.toThrow('mutation failed')
    await expect(control.run('lock')).resolves.toBe(false)
    await ctx.fiber.dispose()
    await expect(control.run('inspect')).rejects.toThrow('stopping')
  })
})
