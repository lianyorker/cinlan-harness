import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import AutomationController from '../src/index.ts'
import { answer, bootRuntimeFixture, waitForRun } from '../../../automation/automation/tests/fixtures/runtime.ts'

let active: Awaited<ReturnType<typeof bootRuntimeFixture>> | undefined
let home: string | undefined
afterEach(async () => {
  await active?.dispose()
  active = undefined
  vi.unstubAllEnvs()
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

async function boot() {
  home = await mkdtemp(join(tmpdir(), 'dsh-automation-controller-'))
  vi.stubEnv('DSH_HOME', home)
  active = await bootRuntimeFixture({ home,
    modules: new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModel],
      ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
      ['@deepseek-ai/dsh-api-automation-controller', AutomationController],
    ]),
    entries: [
      { name: '@deepseek-ai/dsh-agent-default-model', config: { provider: 'fixture', model: 'deterministic' } },
      { name: '@deepseek-ai/dsh-typert-registry' },
      { name: '@deepseek-ai/dsh-api-automation-controller' },
    ],
  })
  return active
}

describe('AutomationController real Loader composition', () => {
  it('reads real selector services and committed definitions without a model or external process call', async () => {
    const { ctx, model, draft, workspace } = await boot()
    const controller = ctx.automationController
    const catalog = await controller.catalog()
    expect(catalog.workspaces).toEqual([{ id: workspace.id, title: 'workspace', path: workspace.path, availability: 'ready' }])
    expect({
      presets: catalog.agentPresets.map(preset => ({ id: preset.id, availability: preset.availability })),
      models: catalog.models,
      permissions: catalog.permissionPresets,
      defaults: catalog.defaults,
    }).toMatchInlineSnapshot(
      `
      {
        "defaults": {
          "agentPresetId": "fixture",
          "model": {
            "model": "deterministic",
            "provider": "fixture",
          },
          "modelAvailability": "unlisted",
          "permissionPresetId": "initial",
        },
        "models": [
          {
            "availability": "unlisted",
            "id": "deterministic",
            "provider": "fixture",
          },
        ],
        "permissions": [
          {
            "availability": "ready",
            "id": "initial",
            "name": "initial",
            "permission": {
              "approval": "ask",
              "sandbox": "read-only",
            },
          },
          {
            "availability": "ready",
            "id": "unattended",
            "name": "unattended",
            "permission": {
              "approval": "never",
              "sandbox": "workspace-write",
            },
          },
        ],
        "presets": [
          {
            "availability": "ready",
            "id": "fixture",
          },
        ],
      }
      `,
    )
    const abort = new AbortController()
    const iterator = controller.follow(abort.signal)[Symbol.asyncIterator]()
    try {
      expect((await iterator.next()).value).toMatchObject({ type: 'baseline', value: { status: 'ready', definitions: [] } })
      const saved = await controller.create(draft)
      expect(saved.enabled).toBe(false)
      expect((await iterator.next()).value).toMatchObject({ type: 'snapshot', value: { definitions: [saved] } })
      const updated = await controller.update({ id: saved.id, expectedRevision: saved.revision, draft: { ...draft, title: 'Updated title' }, enabled: false })
      expect(updated.revision).toBe(saved.revision + 1)
      await expect(controller.update({ id: saved.id, expectedRevision: saved.revision, draft, enabled: true })).rejects.toMatchObject({
        code: 'automation/operation-failed', details: { code: 'conflict' }, message: 'Automation changed; refresh before retrying.',
      })
      const afterUtc = Date.UTC(2026, 0, 1)
      const preview = await controller.previewSchedule({ schedule: draft.schedule, afterUtc })
      expect(preview).toHaveLength(5)
      expect(preview.every(value => value > afterUtc)).toBe(true)
      expect(await controller.runs({ id: saved.id, cursor: null, limit: 10 })).toEqual({ runs: [], nextCursor: null })
      expect(model.requests).toHaveLength(0)
      expect(model.unexpected).toHaveLength(0)
      await controller.delete({ id: saved.id, expectedRevision: updated.revision })
      expect(controller.snapshot()).toMatchObject({ status: 'ready', definitions: [] })
    } finally {
      abort.abort()
      await iterator.return?.()
    }
  })

  it('admits through the runtime and reads durable invocation evidence through the controller', async () => {
    const { ctx, model, draft } = await boot()
    const saved = await ctx.automationController.create(draft)
    model.responses.push(() => answer('Controller invocation completed.'))
    const request = { id: saved.id, expectedRevision: saved.revision, requestId: 'controller-admission' as never }
    const admitted = await ctx.automationController.run(request)
    const completed = await waitForRun(ctx.automationRuntime, saved.id, admitted.id, run => run.status === 'completed')
    const page = await ctx.automationController.runs({ id: saved.id, cursor: null, limit: 10 })
    expect(page.runs).toEqual([completed])
    expect(completed.sessionId).not.toBeNull()
    expect(completed.messageId).not.toBeNull()
    expect(completed.turn).not.toBeNull()
    expect((await ctx.automationController.run(request)).id).toBe(admitted.id)
    expect(model.requests).toHaveLength(1)
    expect(model.unexpected).toHaveLength(0)
  })
})
