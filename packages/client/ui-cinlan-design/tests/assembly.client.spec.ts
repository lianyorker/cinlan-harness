// @vitest-environment jsdom
import { afterEach, expect } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { CinlanDesignBody } from '../src/client/view/CinlanDesignBody.tsx'
import type { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'

const it = createClientTest({ roster: webApp })
const SELF = '@deepseek-ai/dsh-client-ui-cinlan-design'
afterEach(() => { localStorage.clear() })

it('registers the Design body and persistence seat through the shipped Loader and removes them on unload', async ({ start }) => {
  const client = await start()
  const entries = () => client.ctx.slots.entries('sidebar.right.pane.tab').filter(entry => entry.options.key === SELF)
  expect(entries()).toHaveLength(1)
  expect(entries()[0]?.component).toBe(CinlanDesignBody)
  expect(entries()[0]?.store).toBeDefined()
  const tools = () => client.ctx.slots.entries('browser.design.tools')
  expect(tools()).toHaveLength(1)
  expect(tools()[0]?.store).toBeDefined()
  const tabs = client.ctx.get('sidebarRightTabs') as SidebarRightTabRegistry
  expect(tabs.get('cinlan-design')?.title('sidebar://cinlan-design')).toBe('Design')
  expect(tabs.get('cinlan-design')?.guide).toBeUndefined()
  await client.reload(SELF)
  expect(entries()).toHaveLength(1)
  expect(entries()[0]?.component).toBe(CinlanDesignBody)
  expect(tools()).toHaveLength(1)
  await client.unload(SELF)
  expect(entries()).toHaveLength(0)
  expect(tools()).toHaveLength(0)
  expect(tabs.get('cinlan-design')).toBeUndefined()
}, 60_000)
