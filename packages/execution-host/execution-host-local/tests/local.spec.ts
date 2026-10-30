/** Local execution-host identity resolution, including operator-pinned host ids. */
import { hostname } from 'node:os'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

const ENV_KEYS = ['CLH_EXECUTION_HOST_ID', 'DSH_EXECUTION_HOST_ID'] as const

async function withEnv(overrides: Record<string, string | undefined>, run: () => void | Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) saved.set(key, process.env[key])
  try {
    for (const key of ENV_KEYS) Reflect.deleteProperty(process.env, key)
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue
      process.env[key] = value
    }
    await run()
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key)
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  }
}

async function boot(config: object = {}) {
  const ctx = new Context()
  apply(ctx, config)
  await ctx.loader?.await().catch(() => {})
  await new Promise((resolve) => { setImmediate(resolve) })
  return ctx
}

it('reports process identity with a fresh local id when nothing is pinned', async () => {
  await withEnv({}, async () => {
    const ctx = await boot()
    const info = ctx.executionHost.current()
    expect(info.hostId).toMatch(/^local-/)
    expect(info.hostname).toBe(hostname())
    expect(info.pid).toBe(process.pid)
    expect(info.platform).toBe(process.platform)
    expect(info.createdAt).toBeTypeOf('string')
    expect(ctx.executionHost.current()).toEqual(info)
  })
})

it('prefers the configured host id over every environment pin', async () => {
  await withEnv({ CLH_EXECUTION_HOST_ID: 'env-clh', DSH_EXECUTION_HOST_ID: 'env-dsh' }, async () => {
    const ctx = await boot({ hostId: '  pinned-config  ' })
    expect(ctx.executionHost.current().hostId).toBe('pinned-config')
  })
})

it('uses the first non-empty environment pin when unconfigured', async () => {
  await withEnv({ CLH_EXECUTION_HOST_ID: 'env-clh', DSH_EXECUTION_HOST_ID: 'env-dsh' }, async () => {
    expect((await boot()).executionHost.current().hostId).toBe('env-clh')
  })
  await withEnv({ CLH_EXECUTION_HOST_ID: '   ', DSH_EXECUTION_HOST_ID: '  env-dsh  ' }, async () => {
    expect((await boot()).executionHost.current().hostId).toBe('env-dsh')
  })
})

it('skips blank pins and falls back to a fresh local id', async () => {
  await withEnv({ CLH_EXECUTION_HOST_ID: '', DSH_EXECUTION_HOST_ID: '   ' }, async () => {
    expect((await boot({ hostId: '\t' })).executionHost.current().hostId).toMatch(/^local-/)
  })
})
