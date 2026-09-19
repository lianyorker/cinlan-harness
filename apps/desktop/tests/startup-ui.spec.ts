// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localizeStartupDocument } from '../src/startup-document.ts'
import { mountDesktopLoading } from '../src/startup-renderer.ts'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { DesktopStartupApi } from '../src/ipc.ts'
import type { DesktopStartupState } from '../src/startup.ts'

const template = readFileSync(resolve('apps/desktop/renderer/startup.html'), 'utf8')

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
  vi.stubGlobal('matchMedia', () => media)
  mountDesktopLoading(document.getElementById('root')!, api)
  await Promise.resolve()
  return { notify, api, media, unsubscribe }
}

function text(id: string) { return document.getElementById(id)!.textContent }
function button(id: string) { return document.getElementById(id)! as HTMLButtonElement }

describe('shared Desktop loading view', () => {
  it.each(['en', 'zh-CN'])('keeps the app loading indicator throughout preparation in %s', async (locale) => {
    const ui = await render(locale)
    const spinner = document.querySelector('[data-dsh-boot-spinner]')
    expect(spinner).not.toBeNull()
    for (const stage of ['recovering', 'verifying', 'extracting', 'installing', 'checking', 'cleaning', 'activating', 'starting-host'] as const) {
      ui.notify({ phase: 'starting', stage })
      expect(document.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
      expect(document.getElementById('failure')!.hidden).toBe(true)
      expect(document.body.dataset.stage).toBe(stage)
    }
    await expect(`${JSON.stringify({
      loading: document.querySelector('[data-dsh-boot]')!.textContent,
      failureHidden: document.getElementById('failure')!.hidden,
      progressCardPresent: document.getElementById('stage-label') !== null,
      openingCardPresent: document.querySelector('.mark') !== null,
    }, null, 2)}\n`).toMatchFileSnapshot('./expected/startup-loading.json')
    ui.notify({ phase: 'stopping' })
    expect(document.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    expect(document.getElementById('failure')!.hidden).toBe(true)
    expect(button('quit').disabled).toBe(true)
  })

  it('shows diagnostics and safe lifecycle actions only on failure', async () => {
    const ui = await render('zh-CN')
    ui.notify({ phase: 'error', message: '<untrusted & failure>', diagnosticFile: 'C:\\private-test\\startup-error.log', canRestart: true })
    expect([text('startup-title'), text('startup-detail'), text('diagnostic-label'), button('restart').textContent]).toEqual([
      'DeepSeek Harness 无法启动', '启动已停止。您可以重启应用或退出。', '诊断文件', '重启应用',
    ])
    expect(document.querySelector('[data-dsh-boot]')).toBeNull()
    expect(text('error-message')).toBe('<untrusted & failure>')
    expect(document.querySelector('#error-message untrusted')).toBeNull()
    expect(text('diagnostic-path')).toBe('C:\\private-test\\startup-error.log')
    expect(document.getElementById('failure')!.hidden).toBe(false)
    button('restart').click()
    expect(ui.api.restart).toHaveBeenCalledOnce()
    ui.notify({ phase: 'error', message: 'cleanup', canRestart: false })
    expect(button('restart').hidden).toBe(true)
    expect(text('diagnostic-label')).toBe('无法保存诊断文件。')
    expect(text('startup-detail')).toBe('后台清理未能完成。请再次点击退出以重试清理。')
    button('quit').click()
    expect(ui.api.quit).toHaveBeenCalledOnce()
    window.dispatchEvent(new Event('pagehide'))
    expect(ui.unsubscribe).toHaveBeenCalledOnce()
    expect(ui.media.removeEventListener).toHaveBeenCalledOnce()
  })

  it('ignores state notifications after leaving the loading document', async () => {
    const ui = await render('en')
    window.dispatchEvent(new Event('pagehide'))
    ui.notify({ phase: 'error', message: 'late failure', canRestart: true })
    expect(document.getElementById('failure')!.hidden).toBe(true)
    expect(text('error-message')).toBe('')
  })

  it('escapes initial locale text and rejects a missing template key', () => {
    const locale = resolveDesktopLocale('en')
    expect(localizeStartupDocument('{{startupTitle}}', {
      ...locale, messages: { ...locale.messages, startupTitle: '<>&"\'' },
    })).toBe('&lt;&gt;&amp;&quot;&#39;')
    expect(() => localizeStartupDocument('{{missing}}', locale)).toThrow('unknown locale key')
  })
})
