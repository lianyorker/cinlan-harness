import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { botIdFor, botRecordProblem, presetIdFor, toPresetDefinition, type BotRecord } from '../src/form.ts'
import { BotRegistryService } from '../src/index.ts'

const validBot: BotRecord = {
  id: 'weekly-report',
  name: '周报整理',
  description: '每周五汇总',
  persona: '你是部门周报整理助手',
  tools: ['tool-fs', 'tool-goal'],
  credentials: ['gitee-ro'],
  order: 10,
}

describe('form projection', () => {
  it('projects a bot row into a constrained PresetDefinition', () => {
    const definition: PresetDefinition = toPresetDefinition(validBot)
    expect(definition.id).toBe('bot-weekly-report')
    expect(definition.order).toBe(10)
    const names = definition.plugins.map(row => row.name)
    expect(names[0]).toBe('@deepseek-ai/dsh-persona')
    // persona prefix rides the persona row's config, not a plugin name
    expect(definition.plugins[0]!.config).toEqual({ prefix: validBot.persona })
    expect(names).toContain('tool-fs')
    expect(names).toContain('tool-goal')
    // credentials never carry values, only scope names
    const credentials = definition.plugins.filter(row => row.name === '@deepseek-ai/dsh-credentials/grant')
    expect(credentials).toHaveLength(1)
    expect(credentials[0]!.config).toEqual({ scope: 'gitee-ro' })
  })

  it('round-trips preset id and bot id', () => {
    expect(presetIdFor('weekly-report')).toBe('bot-weekly-report')
    expect(botIdFor('bot-weekly-report')).toBe('weekly-report')
    expect(botIdFor('standard')).toBeUndefined()
  })

  it('rejects malformed rows', () => {
    expect(botRecordProblem({ ...validBot, id: 'Bad Id' })).toMatch(/id must be lowercase/)
    expect(botRecordProblem({ ...validBot, persona: ' ' })).toMatch(/persona is required/)
    expect(botRecordProblem({ ...validBot, tools: [42] })).toMatch(/tools must be a list/)
    expect(botRecordProblem({ ...validBot, credentials: [''] })).toMatch(/credentials must be a list/)
    expect(botRecordProblem({ ...validBot, order: 1.5 })).toMatch(/order must be an integer/)
    expect(botRecordProblem(validBot)).toBeUndefined()
  })
})

describe('BotRegistryService', () => {
  it('stores rows, gates writes by role, appends audit, and converges registrations', async () => {
    const registered: string[] = []
    const unregistered: string[] = []
    const stubPresets = {
      register: async (definition: PresetDefinition) => {
        registered.push(definition.id)
        return async () => { unregistered.push(definition.id) }
      },
    }
    const ctx = new Context()
    ctx.provide('agentPresets', stubPresets as never)
    await ctx.plugin(BotRegistryService, {})
    const service = ctx.botRegistry

    // init reloads the (empty) namespace: nothing registered yet
    expect(registered).toEqual([])

    await service.putBot('owner', validBot)
    expect((await service.listBots()).map(row => row.id)).toEqual(['weekly-report'])
    expect(registered).toEqual(['bot-weekly-report'])

    // A viewer (from the namespace's role table) cannot write; the refusal names the role.
    const withRoles = service as unknown as { memory: { roles: { subject: string; role: string }[] } }
    withRoles.memory.roles = [{ subject: 'auditor', role: 'viewer' }]
    await expect(service.putBot('auditor', { ...validBot, id: 'other' })).rejects.toThrow(/role "viewer"/)

    // Every committed write appends one audit row.
    const trail = await service.auditTrail()
    expect(trail).toHaveLength(1)
    expect(trail[0]).toMatchObject({ action: 'create', botId: 'weekly-report' })

    await service.putBot('owner', { ...validBot, description: 'v2' })
    const updated = await service.auditTrail()
    expect(updated).toHaveLength(2)
    expect(updated[1]).toMatchObject({ action: 'update' })
    // re-register converges: old definition disposed, new one mounted
    expect(unregistered).toEqual(['bot-weekly-report'])
    expect(registered).toEqual(['bot-weekly-report', 'bot-weekly-report'])

    await service.deleteBot('owner', 'weekly-report')
    expect(await service.listBots()).toEqual([])
    expect(unregistered).toEqual(['bot-weekly-report', 'bot-weekly-report'])
    const final = await service.auditTrail()
    expect(final[final.length - 1]).toMatchObject({ action: 'delete', botId: 'weekly-report' })

    await expect(service.deleteBot('owner', 'weekly-report')).rejects.toThrow(/Unknown bot/)
  })
})
