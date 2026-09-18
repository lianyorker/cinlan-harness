// @vitest-environment jsdom
/** User operations on the native integrated-terminal settings page. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { SIDEBAR_PREFS_DEFAULTS } from '@deepseek-ai/dsh-client-ui-better-sidebar/src/prefs-shared.ts'
import { TerminalSettingsSection, type TerminalSettingsProps, type TerminalCapability } from '../src/client/TerminalSettingsSection.tsx'
import { en, zh, type TerminalSettingsKey } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

function bench(language: 'en' | 'zh' = 'en', capability: TerminalCapability = { status: 'available' }) {
  const snapshot: SettingsScopeSnapshot<SidebarPrefs> = {
    status: 'ready', mode: 'host', writable: true, revision: 7, value: { ...SIDEBAR_PREFS_DEFAULTS },
    base: undefined, user: { terminalShell: '/custom/shell' },
  }
  const save = vi.fn<TerminalSettingsProps['save']>(async () => true)
  const reset = vi.fn<TerminalSettingsProps['reset']>(async () => true)
  const checkCapability = vi.fn(async () => capability)
  // Settings sections consume none of the standard session/workspace props.
  const props = {
    usePreferences: select => select(snapshot), checkCapability, save, reset,
    t: (key: TerminalSettingsKey) => (language === 'en' ? en : zh)[key],
  } as TerminalSettingsProps
  const view = render(<TerminalSettingsSection {...props} />)
  return { ...view, snapshot, save, reset, checkCapability, props, copy: language === 'en' ? en : zh }
}

describe('native integrated terminal settings', () => {
  it.each(['en', 'zh'] as const)('saves only changed fields with the first-edit revision in %s', async (language) => {
    const b = bench(language)
    fireEvent.change(await screen.findByRole('textbox', { name: b.copy.shell }), { target: { value: '/new/shell' } })
    fireEvent.change(screen.getByRole('textbox', { name: b.copy.args }), { target: { value: '--login -i' } })
    b.snapshot.revision = 8
    b.rerender(<TerminalSettingsSection {...b.props} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: b.copy.scrollback }), { target: { value: '8000' } })
    fireEvent.click(screen.getByRole('button', { name: b.copy.save }))
    expect(await screen.findByText(b.copy.saved)).toBeTruthy()
    expect(b.save).toHaveBeenCalledWith({ terminalShell: '/new/shell', terminalShellArgs: '--login -i', terminalScrollback: 8000 }, 7)
    expect(screen.getByText(b.copy.lifetime)).toBeTruthy()
    expect(screen.getByRole('textbox', { name: b.copy.shell }).closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor')).toBe('shell')
  })

  it.each(['unsupported-scheme', 'missing-dependencies', 'probe-failed'] as const)('keeps the form absent for %s', async (reason) => {
    const b = bench('en', { status: 'unavailable', reason })
    await waitFor(() => { expect(b.checkCapability).toHaveBeenCalledOnce() })
    expect(await screen.findByRole('button', { name: en.retry })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: en.shell })).toBeNull()
    expect(b.save).not.toHaveBeenCalled()
    const anchor = b.container.querySelector<HTMLElement>('[data-settings-anchor="shell"]')!
    anchor.focus()
    expect(document.activeElement).toBe(anchor)
  })

  it('records the unavailable Chinese terminal page without editable controls', async () => {
    const b = bench('zh', { status: 'unavailable', reason: 'unsupported-scheme' })
    await screen.findByRole('button', { name: zh.retry })
    expect({
      title: screen.getByRole('heading', { level: 2 }).textContent,
      status: screen.getByRole('status').textContent,
      labels: [...b.container.querySelectorAll('[data-settings-anchor] span')].map(node => node.textContent),
      lifetime: screen.getByText(zh.lifetime).textContent,
    }).toMatchInlineSnapshot(`
      {
        "labels": [
          "Shell 可执行文件",
          "Shell 参数",
          "字体",
          "字号",
          "回滚行数",
          "光标样式",
          "光标闪烁",
        ],
        "lifetime": "重新连接可接回仍在运行的同一个进程。终端关闭或主机重启后需要创建新进程，无法恢复原先运行的命令。",
        "status": "当前应用不提供集成侧边栏终端。重新检查",
        "title": "终端",
      }
    `)
  })

  it('enables controls only after a successful capability probe and a writable namespace', async () => {
    const b = bench()
    await screen.findByRole('textbox', { name: en.shell })
    b.snapshot.writable = false
    b.rerender(<TerminalSettingsSection {...b.props} />)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.shell }).disabled).toBe(false)
    expect(screen.getByRole('textbox', { name: en.shell }).closest('fieldset')?.disabled).toBe(true)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
  })

  it('requires confirmation before unsetting terminal overrides and allows cancellation', async () => {
    const b = bench()
    fireEvent.click(await screen.findByRole('button', { name: en.reset }))
    expect(screen.getByRole('dialog', { name: en.resetTitle })).toBeTruthy()
    expect(b.reset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.reset }))
    fireEvent.click(screen.getByRole('button', { name: en.resetConfirm }))
    expect(await screen.findByText(en.resetDone)).toBeTruthy()
    expect(b.reset).toHaveBeenCalledWith(7)
  })

  it('clears an unchanged draft without showing a saved message', async () => {
    const b = bench()
    b.save.mockResolvedValueOnce(false)
    fireEvent.change(await screen.findByRole('textbox', { name: en.font }), { target: { value: 'Example Mono' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.discard })).toBeNull() })
    expect(screen.queryByText(en.saved)).toBeNull()
  })

  it('reports rejected writes without a success message and shows the latest host values', async () => {
    const b = bench()
    b.save.mockRejectedValueOnce(new Error('revision conflict'))
    fireEvent.change(await screen.findByRole('textbox', { name: en.font }), { target: { value: 'Example Mono' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.failed)
    expect(screen.queryByText(en.saved)).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.font }).value).toBe('')
  })
})
