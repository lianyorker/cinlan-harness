// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobileSessionView, type MobileSessionViewProps } from '../src/components/MobileSessionView'
import zh from '../src/locales/zh-CN.json'

const notice = vi.fn()
vi.mock('../src/context/ThemeLanguageContext', () => ({
  useAppConfig: () => ({
    language: 'zh-CN', showNotice: notice,
    t: (key: string) => zh.session[key.slice('session.'.length) as keyof typeof zh.session],
  }),
}))
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
function mount(overrides: Partial<MobileSessionViewProps> = {}) {
  const props: MobileSessionViewProps = {
    sessionId: 'session', sessionTitle: 'Review', status: 'paired', steps: [],
    activeThought: '', activeContent: '', pendingApproval: null,
    onApprovalDecision: vi.fn(async () => {}), onInjectPrompt: vi.fn(async () => {}),
    onBack: vi.fn(), quotaBalance: 0, onOpenQuota: vi.fn(), ...overrides,
  }
  const view = render(<MobileSessionView {...props} />)
  return { props, view }
}
it('offers text control without unsupported model, policy, attachment or voice controls', () => {
  const { view } = mount()
  expect(screen.getByRole('textbox', { name: zh.session.message_label })).toBeTruthy()
  expect(screen.getByText(zh.session.host_managed)).toBeTruthy()
  expect(view.container.querySelector('input[type=file]')).toBeNull()
  expect(view.container.textContent).not.toMatch(/DeepSeek-V41|工作区内|全盘读写|创造模式|智能体团队/u)
  expect(screen.queryByRole('button', { name: /浏览项目文件|语音输入|添加操作/u })).toBeNull()
  expect(view.container.textContent).toMatchSnapshot()
})
it('keeps model and permission choices across Host refreshes without applying catalog defaults', async () => {
  const capabilities = {
    models: { default: { provider: 'provider', model: 'default' }, routableProviders: ['provider'], failures: [], groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'chosen', name: 'Chosen' }] }] },
    permissions: { defaultPreset: 'workspace-write', options: [{ value: 'read-only', name: 'Read only' }] },
  }
  const { props, view } = mount({ capabilities })
  expect(screen.getByRole('combobox', { name: zh.session.permission_label })).toHaveProperty('value', '')
  fireEvent.change(screen.getByRole('combobox', { name: zh.session.model_label }), { target: { value: JSON.stringify(['provider', 'chosen']) } })
  fireEvent.change(screen.getByRole('combobox', { name: zh.session.permission_label }), { target: { value: 'read-only' } })
  view.rerender(<MobileSessionView {...props} capabilities={{ ...capabilities }} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'selected settings' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(props.onInjectPrompt).toHaveBeenCalledWith('selected settings', { model: { provider: 'provider', model: 'chosen' }, permission: 'read-only' }))
})
it('submits text once and clears the draft after Host acknowledgement', async () => {
  const { props } = mount()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'review this change' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => { expect(screen.getByRole('textbox')).toHaveProperty('value', '') })
  expect(props.onInjectPrompt).toHaveBeenCalledExactlyOnceWith('review this change')
})
it('keeps the draft when the Host rejects submission', async () => {
  mount({ onInjectPrompt: vi.fn(async () => { throw new Error('offline') }) })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep this draft' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => { expect(notice).toHaveBeenCalled() })
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'keep this draft')
})
it('does not submit while disconnected or composing an IME character', () => {
  const { props, view } = mount()
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: '中文输入' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(props.onInjectPrompt).not.toHaveBeenCalled()
  view.rerender(<MobileSessionView {...props} status="disconnected" />)
  expect(screen.getByRole('button', { name: '发送' })).toHaveProperty('disabled', true)
  fireEvent.submit(input.closest('form')!)
  expect(props.onInjectPrompt).not.toHaveBeenCalled()
})
it('shows only a supplied project path and dismisses menus with Escape', () => {
  const { props, view } = mount({ projectPath: 'D:/Projects/review' })
  expect(screen.getByTitle('D:/Projects/review')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '更多' }))
  expect(screen.getByText('退出会话')).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByText('退出会话')).toBeNull()
  view.rerender(<MobileSessionView {...props} projectPath={undefined} />)
  expect(screen.queryByTitle('D:/Projects/review')).toBeNull()
})
it.each(['missing', 'rejected'])('reports a copy failure when clipboard access is %s', async (access) => {
  localStorage.setItem('cinlan-mobile:preferences-v1', JSON.stringify({ workSteps: 'always', busySend: 'steer' }))
  vi.stubGlobal('navigator', access === 'missing' ? {} : { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
  mount({ steps: [{ id: 'message', role: 'assistant', content: 'Review result', timestamp: 0 }] })
  fireEvent.click(screen.getByRole('button', { name: zh.session.copy_message }))
  await waitFor(() => { expect(notice).toHaveBeenCalledWith(expect.objectContaining({ message: zh.session.copy_failed })) })
})
it('copies the visible session identifier when its title is unavailable', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  mount({ sessionTitle: '' })
  fireEvent.click(screen.getByRole('button', { name: 'Session', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '复制会话标题' }))
  await waitFor(() => { expect(writeText).toHaveBeenCalledWith('session') })
})
it('shares the session identity and workspace without sending a misleading app URL', async () => {
  const share = vi.fn(async () => {})
  vi.stubGlobal('navigator', { share })
  mount({ projectPath: 'D:/Projects/review' })
  fireEvent.click(screen.getByRole('button', { name: '更多' }))
  fireEvent.click(screen.getByRole('button', { name: '分享会话' }))
  await waitFor(() => {
    expect(share).toHaveBeenCalledWith({
      title: 'Review',
      text: 'Review\nD:/Projects/review\nSession ID: session',
    })
  })
})
