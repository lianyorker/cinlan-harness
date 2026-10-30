// @vitest-environment jsdom
import './control-row-dom.ts'
import { afterEach, beforeEach, expect } from 'vitest'
import { act, waitFor, within } from '@testing-library/react'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'

const it = createClientTest({ roster: webApp }, { mount: true })
const CONVERSATION = '@deepseek-ai/dsh-client-ui-conversation'

usePinnedBrowserLanguages('en-US')
beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear() })

it('keeps the no-session workspace trigger and composer available after Loader reload and removes them on unload', async ({ start }) => {
  const client = await start()
  const root = client.container!
  const view = within(root)
  expect(await view.findByRole('button', { name: 'Choose workspace' })).toBeTruthy()
  const editor = root.querySelector('[data-composer-input]')
  expect(editor).not.toBeNull()
  expect(editor?.getAttribute('contenteditable')).not.toBe('true')
  expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
  await act(async () => { await client.reload(CONVERSATION) })
  expect(await view.findByRole('button', { name: 'Choose workspace' })).toBeTruthy()
  expect(root.querySelectorAll('[data-composer-input]')).toHaveLength(1)
  expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
  await act(async () => { await client.unload(CONVERSATION) })
  await waitFor(() => { expect(root.querySelector('[data-composer-input]')).toBeNull() })
  expect(view.queryByRole('button', { name: 'Choose workspace' })).toBeNull()
}, 60_000)
