// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localizeStartupDocument } from '../src/startup-document.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { DesktopStartupApi } from '../src/ipc.ts'
import type { DesktopStartupState } from '../src/startup.ts'

const template = readFileSync(resolve('apps/desktop/renderer/startup.html'), 'utf8')
const script = readFileSync(resolve('apps/desktop/renderer/startup.js'), 'utf8')

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function render(localeId: string) {
  const locale = resolveDesktopLocale(localeId)
  document.documentElement.innerHTML = localizeStartupDocument(template, locale)
  let notify!: (state: DesktopStartupState) => void
  const unsubscribe = vi.fn()
  const api: DesktopStartupApi = {
    read: async () => ({ locale, state: { phase: 'starting', stage: 'opening' } }),
    subscribe: (listener) => { notify = listener; return unsubscribe },
    quit: vi.fn(async () => {}), restart: vi.fn(async () => {}),
  }
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('dshStartup', api)
  runInNewContext(script, { window, document, matchMedia: () => media })
  await Promise.resolve()
  return { notify, api, media, unsubscribe }
}

function text(id: string) { return document.getElementById(id)!.textContent }
function button(id: string) { return document.getElementById(id)! as HTMLButtonElement }

describe('localized startup page', () => {
  it.each([
    { locale: 'en', initial: 'Opening DeepSeek Harness', installing: 'Installing the local runtime…', stopping: 'Finishing safely before closing…', exit: 'Exit' },
    { locale: 'zh-CN', initial: '正在打开 DeepSeek Harness', installing: '正在安装本地运行环境…', stopping: '正在安全结束并退出…', exit: '退出' },
  ])('renders real stages and exit state in $locale', async ({ locale, initial, installing, stopping, exit }) => {
    const ui = await render(locale)
    expect(text('startup-title')).toBe(initial)
    expect(button('quit').textContent).toBe(exit)
    expect(document.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
    ui.notify({ phase: 'starting', stage: 'installing' })
    expect(text('stage-label')).toBe(installing)
    expect(document.body.dataset.stage).toBe('installing')
    ui.notify({ phase: 'starting', stage: 'cleaning' })
    expect(text('stage-label')).toBe(locale === 'en'
      ? 'The background runtime has not stopped. Retrying cleanup…'
      : '后台运行环境尚未停止，正在重试清理…')
    expect(button('restart').hidden).toBe(true)
    button('quit').click()
    expect(ui.api.quit).toHaveBeenCalledOnce()
    ui.notify({ phase: 'stopping' })
    expect(text('startup-title')).toBe(stopping)
    expect(button('quit').disabled).toBe(true)
    expect(button('restart').hidden).toBe(true)
  })

  it('shows the saved path and exposes restart only after safe failure', async () => {
    const ui = await render('zh-CN')
    ui.notify({ phase: 'error', message: '<untrusted & failure>', diagnosticFile: 'C:\\private-test\\startup-error.log', canRestart: true })
    expect([text('startup-title'), text('startup-detail'), text('diagnostic-label'), button('restart').textContent]).toEqual([
      'DeepSeek Harness 无法启动', '启动已停止。您可以重启应用或退出。', '诊断文件', '重启应用',
    ])
    expect(text('error-message')).toBe('<untrusted & failure>')
    expect(document.querySelector('#error-message untrusted')).toBeNull()
    expect(text('diagnostic-path')).toBe('C:\\private-test\\startup-error.log')
    expect(document.getElementById('failure')?.hidden).toBe(false)
    button('restart').click()
    expect(ui.api.restart).toHaveBeenCalledOnce()
    ui.notify({ phase: 'error', message: 'cleanup', canRestart: false })
    expect(button('restart').hidden).toBe(true)
    expect(text('diagnostic-label')).toBe('无法保存诊断文件。')
    expect(text('startup-detail')).toBe('后台清理未能完成。请再次点击退出以重试清理。')
    window.dispatchEvent(new Event('pagehide'))
    expect(ui.unsubscribe).toHaveBeenCalledOnce()
    expect(ui.media.removeEventListener).toHaveBeenCalledOnce()
  })

  it('escapes initial locale text and rejects a missing template key', () => {
    const locale = resolveDesktopLocale('en')
    expect(localizeStartupDocument('{{startupTitle}}', {
      ...locale, messages: { ...locale.messages, startupTitle: '<>&"\'' },
    })).toBe('&lt;&gt;&amp;&quot;&#39;')
    expect(() => localizeStartupDocument('{{missing}}', locale)).toThrow('unknown locale key')
  })
})
