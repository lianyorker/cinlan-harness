// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { GitSettingsSection, type GitSettingsSectionProps } from '../src/client/GitSettingsSection.tsx'
import { createGitSettingsOperations } from '../src/client/settings-operations.ts'
import type { SourceControlAiSettings } from '../src/types.ts'
import { en, zh, type GitSettingsKey } from '../src/client/locales.ts'
import { settingsFixture } from './settings-fixture.client.ts'

afterEach(cleanup)
const translator = (dictionary: typeof en): GitSettingsSectionProps['t'] => {
  const t = (key: GitSettingsKey, params: Record<string, string | number> = {}): string =>
    Object.entries(params).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), dictionary[key])
  return t as GitSettingsSectionProps['t']
}

function setup(fixture = settingsFixture(), dictionary = en) {
  const budget = vi.fn(async (provider: 'github' | 'gitlab') => ({
    provider,
    state: 'reported' as const,
    reason: null,
    remaining: 42,
    limit: 5000,
    resetsAt: '2026-11-18T12:00:00Z',
  }))
  const props = {
    ...createGitSettingsOperations(fixture.scope), budget, useSettings: bindSnapshotSelector(fixture.store), t: translator(dictionary),
  } as GitSettingsSectionProps
  return { ...fixture, ...render(<GitSettingsSection {...props} />), props, budget }
}

describe('Git native settings rows', () => {
  it('shows the existing fields with localized anchors and no duplicated page heading', () => {
    const view = setup(settingsFixture(), zh)
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.getByText(zh.runtimeNotice)).toBeTruthy()
    expect(Array.from(view.container.querySelectorAll('[data-settings-anchor]')).map(row => row.getAttribute('data-settings-anchor')))
      .toEqual([
        'git-branch-prefix', 'git-custom-prefix', 'git-group-order',
        'git-upstream', 'git-attribution', 'git-rename-branch', 'git-update-base',
        'git-ai-author', 'git-ai-sensitive-filter', 'git-ai-max-diff', 'git-ai-recipe-defaults',
        'git-budget-github', 'git-budget-gitlab',
      ])
    expect(screen.getAllByRole('combobox').map(control => control.getAttribute('id')))
      .toEqual(['git-branch-prefix', 'git-group-order', 'git-ai-max-diff-select', 'git-ai-action-select'])
    expect(screen.getAllByRole('switch').map(control => control.getAttribute('aria-label')))
      .toEqual([
        zh.compareUpstreamTitle, zh.attributionTitle, zh.renameBranchTitle, zh.keepLocalMainTitle,
        zh.sourceControlAiEnabled, zh.sourceControlAiFilterSensitiveTitle, zh.recipeEnabledLabel,
      ])
    expect(screen.getByLabelText(zh.branchPrefixCustomLabel)).toHaveProperty('disabled', true)
  })

  it('saves a base-refresh change and resets the override', async () => {
    const f = settingsFixture({ user: { refreshLocalBaseRefOnWorktreeCreate: true } })
    f.publish({ value: { ...f.store.getSnapshot().value!, refreshLocalBaseRefOnWorktreeCreate: true } })
    setup(f)
    const refresh = screen.getByRole('switch', { name: en.keepLocalMainTitle })
    expect(refresh).toHaveProperty('disabled', false)
    expect(refresh.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.keepLocalMainDescription)).toBeTruthy()
    f.mutate.mockImplementationOnce(async () => {
      f.publish({
        user: { refreshLocalBaseRefOnWorktreeCreate: false }, revision: 2,
        value: { ...f.store.getSnapshot().value!, refreshLocalBaseRefOnWorktreeCreate: false },
      })
      return true
    })
    fireEvent.click(refresh)
    await screen.findByText(en.settingsSaved)
    expect(f.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['refreshLocalBaseRefOnWorktreeCreate'], value: false }], 1)
    expect(refresh.getAttribute('aria-checked')).toBe('false')
    f.mutate.mockImplementationOnce(async () => {
      f.publish({
        user: {}, revision: 3,
        value: { ...f.store.getSnapshot().value!, refreshLocalBaseRefOnWorktreeCreate: false },
      })
      return true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset ' + en.keepLocalMainTitle }))
    await screen.findByText(en.settingsSaved)
    expect(f.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['refreshLocalBaseRefOnWorktreeCreate'] }], 2)
    expect(refresh.getAttribute('aria-checked')).toBe('false')
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

  it('supports toggling AI Author and editing / saving action recipes', async () => {
    const f = settingsFixture()
    const view = setup(f)

    // Toggle AI author off
    const aiSwitch = screen.getByRole('switch', { name: en.sourceControlAiEnabled })
    expect(aiSwitch.getAttribute('aria-checked')).toBe('true')

    f.mutate.mockImplementationOnce(async (ops) => {
      const val = (ops[0] as { op: 'set'; path: string[]; value: SourceControlAiSettings }).value
      f.publish({
        value: { ...f.store.getSnapshot().value!, sourceControlAi: val },
        user: { sourceControlAi: val },
        revision: 2,
      })
      return true
    })

    const templateArea = screen.getByLabelText<HTMLTextAreaElement>(en.recipeTemplateLabel)
    expect(templateArea.value).toContain('{{diff}}')

    // 每配方启用开关在食谱卡内，关闭后模板不可编辑
    const recipeSwitch = screen.getByRole('switch', { name: en.recipeEnabledLabel })
    expect(recipeSwitch.getAttribute('aria-checked')).toBe('true')

    // Append variable
    fireEvent.click(screen.getByRole('button', { name: en.recipeInsertBranch }))
    expect(templateArea.value).toContain('{{branch}}')

    // Save recipe draft
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.settingsSaved)
    expect(view.mutate).toHaveBeenCalled()
  })

  it('shows API budgets from the integration preflight probe and a failure message', async () => {
    const view = setup()
    expect(view.budget).toHaveBeenCalledWith('github', expect.anything())
    expect(view.budget).toHaveBeenCalledWith('gitlab', expect.anything())
    // budget mock 的 resolve 发生在 act 之外；等一个宏任务让 React 18 调度把 setBudgets 刷进 DOM
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50) }) })
    // reported 与 resets 拼在同一个 <p> 里，用正则匹配而不是全文精确匹配
    expect(await screen.findAllByText(/42 of 5000 requests left/)).toHaveLength(2)
    expect(screen.getAllByText(/resets at/)).toHaveLength(2)

    // probe 失败：budget mock 造一次 reject，错误文案渲染出来而不是静默
    cleanup()
    const failing = vi.fn(async () => { throw new Error('probe exploded') })
    const f = settingsFixture()
    render(<GitSettingsSection {...{
      ...createGitSettingsOperations(f.scope), budget: failing, useSettings: bindSnapshotSelector(f.store), t: translator(en),
    } as GitSettingsSectionProps} />)
    expect(await screen.findAllByText(/probe exploded/)).toHaveLength(2)
  })
})

