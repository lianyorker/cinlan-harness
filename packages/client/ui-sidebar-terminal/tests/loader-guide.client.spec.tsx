// @vitest-environment jsdom
import { afterEach, expect, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TerminalGuide, type TerminalGuideInjected, type TerminalGuideProps } from '../src/client/TerminalGuide.tsx'
import { en } from '../src/client/locales.ts'

const it = createClientTest({ roster: webApp })
const SELF = '@deepseek-ai/dsh-client-ui-sidebar-terminal'
afterEach(() => { cleanup(); localStorage.clear() })

it('discovers shells through the Loader-provided guide without launching a terminal and removes the guide on unload', async ({ start, mock }) => {
  mock.unary('terminal/shells', ok([{ name: 'PowerShell', path: 'pwsh', args: [] }]))
  const client = await start()
  const entries = () => client.ctx.slots.entries('sidebar.right.tab.guide.entry').filter(entry => entry.options.key === SELF)
  expect(entries()).toHaveLength(1)
  expect(entries()[0]!.component).toBe(TerminalGuide)
  const sessionId = 'terminal-guide-fixture' as SessionId
  // The registry erases inject parameters; restore this entry's declared Session seat.
  const inject = entries()[0]!.inject as (sessionId: SessionId) => Partial<TerminalGuideInjected>
  const injected = inject(sessionId)
  if (injected.loadShells === undefined || injected.selectShell === undefined) throw new Error('expected terminal guide actions')
  const openTab = vi.fn()
  // The guide consumes these owner, locale and injected seats; unrelated framework hooks are unused.
  const props = {
    sessionId, entryId: 'new', kind: 'terminal', title: en.new, description: en.description, t: makeTranslate(en),
    useTabInfo: () => ({ tab: { actions: { openTab } } }),
    useShortcuts: (select: (entries: readonly never[]) => unknown) => select([]),
    loadShells: injected.loadShells, selectShell: injected.selectShell,
  } as TerminalGuideProps
  const Guide = entries()[0]!.component as typeof TerminalGuide
  const view = render(<Guide {...props} />)
  fireEvent.click(view.getByRole('button', { name: en.shell }))
  expect(await view.findByRole('menuitem', { name: 'PowerShell' })).toBeTruthy()
  expect(openTab).not.toHaveBeenCalled()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(view.queryByRole('menu')).toBeNull()
  view.unmount()
  await client.reload(SELF)
  expect(entries()).toHaveLength(1)
  await client.unload(SELF)
  expect(entries()).toHaveLength(0)
}, 60_000)
