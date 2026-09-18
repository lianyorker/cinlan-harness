// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { GitSettingsSection, type GitSettingsSectionProps } from '../src/client/GitSettingsSection.tsx'
import { createGitSettingsOperations } from '../src/client/settings-operations.ts'
import { en, zh, type GitSettingsKey } from '../src/client/locales.ts'
import { settingsFixture } from './settings-fixture.client.ts'

afterEach(cleanup)
const translator = (dictionary: typeof en): GitSettingsSectionProps['t'] => {
  const t = (key: GitSettingsKey, params: Record<string, string | number> = {}): string =>
    Object.entries(params).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), dictionary[key])
  return t as GitSettingsSectionProps['t']
}

function setup(fixture = settingsFixture(), dictionary = en) {
  const props = {
    ...createGitSettingsOperations(fixture.scope), useSettings: bindSnapshotSelector(fixture.store), t: translator(dictionary),
  } as GitSettingsSectionProps
  return { ...fixture, ...render(<GitSettingsSection {...props} />), props }
}

describe('Git native settings rows', () => {
  it('shows the existing fields with localized anchors and one page heading', () => {
    const view = setup(settingsFixture(), zh)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(zh.nav)
    expect(screen.getByText(zh.runtimeNotice)).toBeTruthy()
    expect(Array.from(view.container.querySelectorAll('[data-settings-anchor]')).map(row => row.getAttribute('data-settings-anchor')))
      .toEqual(['git-branch-prefix', 'git-custom-prefix', 'git-update-base', 'git-group-order', 'git-upstream', 'git-attribution'])
    expect(screen.getAllByRole('combobox').map(control => control.getAttribute('id'))).toEqual(['git-branch-prefix', 'git-group-order'])
    expect(screen.getAllByRole('switch').map(control => control.getAttribute('aria-label')))
      .toEqual([zh.keepLocalMainTitle, zh.compareUpstreamTitle, zh.attributionTitle])
    expect(screen.getByLabelText(zh.branchPrefixCustomLabel)).toHaveProperty('disabled', true)
  })

  it('preserves a saved base-refresh value, disables edits, and permits reset', async () => {
    const f = settingsFixture({ user: { refreshLocalBaseRefOnWorktreeCreate: true } })
    f.publish({ value: { ...f.store.getSnapshot().value!, refreshLocalBaseRefOnWorktreeCreate: true } })
    setup(f)
    const refresh = screen.getByRole('switch', { name: en.keepLocalMainTitle })
    expect(refresh).toHaveProperty('disabled', true)
    expect(refresh.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.keepLocalMainDescription)).toBeTruthy()
    fireEvent.click(refresh)
    expect(f.mutate).not.toHaveBeenCalled()
    f.mutate.mockImplementationOnce(async () => {
      f.publish({ user: {}, revision: 2, value: { ...f.store.getSnapshot().value!, refreshLocalBaseRefOnWorktreeCreate: false } })
      return true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset ' + en.keepLocalMainTitle }))
    await screen.findByText(en.settingsSaved)
    expect(f.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['refreshLocalBaseRefOnWorktreeCreate'] }], 1)
    expect(refresh.getAttribute('aria-checked')).toBe('false')
    expect(refresh).toHaveProperty('disabled', true)
  })

  it('previews only literal branch names and explains repository username resolution', () => {
    const f = setup()
    expect(screen.getByText('Preview: dsh/task/<uuid>')).toBeTruthy()
    act(() => { f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefix: 'custom', branchPrefixCustom: 'team/' } }) })
    expect(screen.getByText('Preview: team/dsh/task/<uuid>')).toBeTruthy()
    act(() => { f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefixCustom: 'team' } }) })
    expect(screen.getByText('Preview: team/dsh/task/<uuid>')).toBeTruthy()
    act(() => { f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefixCustom: '' } }) })
    expect(screen.getByText('Preview: ' + en.branchPrefixEmpty)).toBeTruthy()
    act(() => { f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefix: 'git-username' } }) })
    expect(screen.getByText(en.branchPrefixGitUsernameDesc)).toBeTruthy()
    expect(screen.queryByText(/^Preview:/)).toBeNull()
  })

  it('reports a recovered write failure without claiming saved', async () => {
    const view = setup()
    view.mutate.mockResolvedValue(false)
    fireEvent.click(screen.getByRole('switch', { name: en.compareUpstreamTitle }))
    await screen.findByText(en.settingsSaveFailed)
    expect(screen.queryByText(en.settingsSaved)).toBeNull()
    expect(screen.getByRole('switch', { name: en.compareUpstreamTitle }).getAttribute('aria-checked')).toBe('false')
  })

  it('keeps custom text local until save and preserves the draft after failure', async () => {
    const f = settingsFixture()
    f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefix: 'custom', branchPrefixCustom: 'base/' } })
    const view = setup(f)
    const input = screen.getByLabelText<HTMLInputElement>(en.branchPrefixCustomLabel)
    fireEvent.change(input, { target: { value: 'team/' } })
    expect(f.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.settingsSaveFailed)
    expect(input.value).toBe('team/')
    f.mutate.mockImplementationOnce(async () => {
      f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefixCustom: 'team/' }, user: { branchPrefixCustom: 'team/' }, revision: 2 })
      return true
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.settingsSaved)
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
    expect(view.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['branchPrefixCustom'], value: 'team/' }], 1)
  })

  it('rejects a stale custom-prefix draft and lets Discard reveal the current Host value', async () => {
    const f = settingsFixture()
    f.publish({ value: { ...f.store.getSnapshot().value!, branchPrefix: 'custom' } })
    setup(f)
    const input = screen.getByLabelText<HTMLInputElement>(en.branchPrefixCustomLabel)
    fireEvent.change(input, { target: { value: 'my-draft/' } })
    act(() => { f.publish({ revision: 2, value: { ...f.store.getSnapshot().value!, branchPrefixCustom: 'external/' } }) })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.settingsSaveFailed)
    expect(f.mutate).not.toHaveBeenCalled()
    expect(input.value).toBe('my-draft/')
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(input.value).toBe('external/')
  })

  it('reflects external readonly and loading state instead of keeping writable stale rows', () => {
    const f = setup()
    act(() => { f.publish({ writable: false, user: { compareAgainstUpstream: false } }) })
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    for (const control of screen.getAllByRole('switch')) expect(control).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Reset ' + en.compareUpstreamTitle })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('switch', { name: en.compareUpstreamTitle }))
    expect(f.mutate).not.toHaveBeenCalled()
    act(() => { f.publish({ status: 'loading' }) })
    expect(screen.getByText(en.settingsLoading)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    act(() => { f.publish({ status: 'unavailable' }) })
    expect(screen.getByText(en.settingsError)).toBeTruthy()
  })

  it('disables concurrent controls while saving and clears an explicit override on reset', async () => {
    const f = settingsFixture({ user: { compareAgainstUpstream: false } })
    let release!: (accepted: boolean) => void
    f.mutate.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve }))
    setup(f)
    fireEvent.click(screen.getByRole('button', { name: 'Reset ' + en.compareUpstreamTitle }))
    await screen.findByText(en.settingsSaving)
    expect(screen.getByRole('combobox', { name: en.branchPrefixTitle })).toHaveProperty('disabled', true)
    await act(async () => { f.publish({ user: {}, revision: 2 }); release(true) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Reset ' + en.compareUpstreamTitle })).toBeNull() })
    expect(screen.getByText(en.settingsSaved)).toBeTruthy()
  })
})
