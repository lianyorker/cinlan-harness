/** The schema preserves durable values and one Host fiber owns registration. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import * as types from '../src/types.ts'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from '../src/settings-schema.ts'

const defaults = {
  branchPrefix: 'none', branchPrefixCustom: '', refreshLocalBaseRefOnWorktreeCreate: false,
  sourceControlGroupOrder: 'changes-first', compareAgainstUpstream: false, enableGitHubAttribution: false,
}

describe('git-settings', () => {
  it('keeps the durable namespace and all six defaults', () => {
    expect(GIT_SETTINGS_NAMESPACE).toBe('git-source-control')
    expect(GitSourceControlSettingsSchema()).toEqual(defaults)
    expect(Object.keys(types)).toEqual([])
    expect('default' in plugin).toBe(false)
  })

  it.each([
    { branchPrefix: 'automatic' }, { branchPrefixCustom: true }, { refreshLocalBaseRefOnWorktreeCreate: 'true' },
    { sourceControlGroupOrder: 'other' }, { compareAgainstUpstream: 1 }, { enableGitHubAttribution: 'true' },
  ])('rejects an invalid preference: %j', (value) => {
    expect(() => GitSourceControlSettingsSchema(value as never)).toThrow()
  })

  it('declares plugin metadata and config schema', () => {
    expect(plugin.name).toBe('@deepseek-ai/dsh-git-settings')
    expect(plugin.inject).toEqual(['settings'])
    expect(plugin.Config).toBe(GitSourceControlSettingsSchema)
  })

  it('configures settings presentation on apply', () => {
    const ctx = new Context()
    let configured = false
    ctx.provide('settings', {
      configure(options: { auto?: boolean }) {
        expect(options).toEqual({ auto: true })
        configured = true
        return () => {}
      },
    } as never)
    plugin.apply(ctx)
    expect(configured).toBe(true)
  })
})
