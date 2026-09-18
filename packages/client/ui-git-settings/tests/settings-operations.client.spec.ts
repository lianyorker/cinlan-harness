/** Git saves report durable outcomes, including rejected writes recovered by SettingsScope. */
import { describe, expect, it } from 'vitest'
import { createGitSettingsOperations, hasOverride } from '../src/client/settings-operations.ts'
import { settingsFixture } from './settings-fixture.client.ts'

describe('Git settings operations', () => {
  it('refuses edits to the unavailable base-refresh preference', async () => {
    const f = settingsFixture()
    const operations = createGitSettingsOperations(f.scope)
    await expect(operations.save('refreshLocalBaseRefOnWorktreeCreate', true)).resolves.toBe(false)
    expect(f.mutate).not.toHaveBeenCalled()
  })

  it('fences the current revision and confirms the user override before reporting success', async () => {
    const f = settingsFixture()
    const operations = createGitSettingsOperations(f.scope)
    f.mutate.mockImplementationOnce(async () => {
      f.publish({
        value: { ...f.store.getSnapshot().value!, compareAgainstUpstream: true }, user: { compareAgainstUpstream: true }, revision: 2,
      })
      return true
    })
    await expect(operations.save('compareAgainstUpstream', true)).resolves.toBe(true)
    expect(f.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['compareAgainstUpstream'], value: true }], 1)
  })

  it('does not call a recovered rejection saved, even when the old value already matched', async () => {
    const f = settingsFixture({ user: { compareAgainstUpstream: false } })
    const operations = createGitSettingsOperations(f.scope)
    f.mutate.mockResolvedValue(false)
    await expect(operations.save('compareAgainstUpstream', false)).resolves.toBe(false)
    f.mutate.mockImplementationOnce(async () => { f.publish({ revision: 2 }); return true })
    await expect(operations.save('compareAgainstUpstream', true)).resolves.toBe(false)
    f.mutate.mockRejectedValueOnce(new Error('transport failed'))
    await expect(operations.save('compareAgainstUpstream', true)).resolves.toBe(false)
  })

  it('resets explicit default-valued overrides and confirms their removal', async () => {
    const f = settingsFixture({ user: { compareAgainstUpstream: false } })
    const operations = createGitSettingsOperations(f.scope)
    expect(hasOverride(f.store.getSnapshot().user, 'compareAgainstUpstream')).toBe(true)
    f.mutate.mockResolvedValueOnce(false)
    await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(false)
    f.mutate.mockImplementationOnce(async () => { f.publish({ user: {}, revision: 2 }); return true })
    await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(true)
    expect(f.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['compareAgainstUpstream'] }], 1)
    await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(false)
    expect(f.mutate).toHaveBeenCalledTimes(2)
  })

  it('rejects refused writes even when recovery publishes the requested value at a newer revision', async () => {
    const f = settingsFixture()
    const operations = createGitSettingsOperations(f.scope)
    f.mutate.mockImplementationOnce(async () => {
      f.publish({
        value: { ...f.store.getSnapshot().value!, compareAgainstUpstream: true }, user: { compareAgainstUpstream: true }, revision: 2,
      })
      return false
    })
    await expect(operations.save('compareAgainstUpstream', true)).resolves.toBe(false)
    expect(f.store.getSnapshot().value?.compareAgainstUpstream).toBe(true)
  })

  it('accepts a Host-approved idempotent write without requiring a revision change', async () => {
    const f = settingsFixture({ user: { compareAgainstUpstream: false } })
    f.mutate.mockResolvedValue(true)
    const operations = createGitSettingsOperations(f.scope)
    await expect(operations.save('compareAgainstUpstream', false)).resolves.toBe(true)
    expect(f.store.getSnapshot().revision).toBe(1)
    await expect(operations.save('compareAgainstUpstream', false, 0)).resolves.toBe(false)
    expect(f.mutate).toHaveBeenCalledOnce()
  })

  it('requires both raw and effective values after Host acceptance', async () => {
    const f = settingsFixture({ user: { compareAgainstUpstream: true } })
    f.mutate.mockResolvedValue(true)
    const operations = createGitSettingsOperations(f.scope)
    await expect(operations.save('compareAgainstUpstream', false)).resolves.toBe(false)
    await expect(operations.save('compareAgainstUpstream', true)).resolves.toBe(false)
  })

  it('requires reset acceptance and removal even when recovery clears the override independently', async () => {
    const f = settingsFixture({ user: { compareAgainstUpstream: false } })
    const operations = createGitSettingsOperations(f.scope)
    f.mutate.mockResolvedValueOnce(true)
    await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(false)
    f.mutate.mockRejectedValueOnce(new Error('transport failed'))
    await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(false)
    f.mutate.mockImplementationOnce(async () => { f.publish({ user: {}, revision: 2 }); return false })
    await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(false)
    expect(f.store.getSnapshot().user).toEqual({})
  })

  it.each([{ writable: false }, { mode: 'memory' as const }, { status: 'unavailable' as const }])(
    'refuses writes and resets when the snapshot cannot persist: %j', async (snapshot) => {
      const f = settingsFixture({ ...snapshot, user: { compareAgainstUpstream: false } })
      const operations = createGitSettingsOperations(f.scope)
      await expect(operations.save('compareAgainstUpstream', true)).resolves.toBe(false)
      await expect(operations.reset('compareAgainstUpstream')).resolves.toBe(false)
      expect(f.mutate).not.toHaveBeenCalled()
    },
  )
})
