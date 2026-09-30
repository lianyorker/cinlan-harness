import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include, {
  applyEntryPatches,
  entryListSchema,
} from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import BrowserController from '@deepseek-ai/dsh-api-browser-controller'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import * as LocalBrowser from '@deepseek-ai/dsh-browser-playwright'
import BrowserRuntimeManager from '@deepseek-ai/dsh-browser-playwright/runtime'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
const FileSettingsProvider = {
  name: '@deepseek-ai/dsh-settings-file',
  apply(c: Context) {
    c.provide('settings', {
      describe: () => [],
      configure: () => () => {},
    } as never)
  },
}
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import * as BrowserPermissionPolicy from '@deepseek-ai/dsh-browser-permission-policy'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

let fixtureRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

class FixtureAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1024,
    maxImagePixels: 1024,
    maxImageDimension: 8192,
    mediaTypes: ['image/png', 'image/jpeg'],
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('fixture does not persist screenshots'))
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('fixture does not read screenshots'))
  }
}

async function bundleInputs(): Promise<{
  patches: PatchOptions[]
}> {
  const manifest = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  const parsed = yaml.load(
    await readFile(resolve(PACKAGE_ROOT, manifest.dsh!.bundle!.patch!), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('cinlan-browser patch must be a patch list')
  return { patches: parsed as PatchOptions[] }
}

describe('Desktop co-screen live integration with CDP bridge', () => {
  it('exposes cdpEndpoint and launches Chromium with remoteDebuggingPort for co-screen inspection', async () => {
    const { patches } = await bundleInputs()
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-co-screen-'))
    const configPath = join(fixtureRoot, 'cordis.yml')

    const fixtureLayer: PatchOptions[] = [{
      insert: [
        { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
        { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: join(fixtureRoot, 'settings.json'), watch: false } },
        { id: 'fixture-attachments', name: 'fixture-attachments' },
        { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
        { id: 'tools', name: '@deepseek-ai/dsh-tools' },
        { id: 'typert', name: '@deepseek-ai/dsh-typert-registry' },
      ],
    }]

    const coScreenProfileOverride: PatchOptions[] = [
      { id: 'ui-browser-element-capture', disabled: true },
      { id: 'browser-runtime', config: { storageDir: join(fixtureRoot, 'runtime') } },
      {
        id: 'browser-permission-policy',
        config: { observe: 'allow', navigate: 'allow', interact: 'allow' },
      },
      {
        id: 'browser-playwright',
        config: {
          providerId: 'local',
          storageDir: join(fixtureRoot, 'browser-profile'),
          headless: true,
          remoteDebuggingPort: 9222,
        },
      },
    ]

    const composed = applyEntryPatches(
      [],
      structuredClone([...fixtureLayer, ...patches, ...coScreenProfileOverride]),
      () => {},
    )

    await writeFile(configPath, yaml.dump(composed, { lineWidth: -1, noRefs: true }))

    context = new Context()
    context.baseUrl = pathToFileURL(fixtureRoot).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include

    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
      ['@deepseek-ai/dsh-browser-playwright/runtime', BrowserRuntimeManager],
      ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
      ['fixture-attachments', FixtureAttachments],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-browser', BrowserRuntime],
      ['@deepseek-ai/dsh-browser-playwright', LocalBrowser],
      ['@deepseek-ai/dsh-browser-permission-policy', BrowserPermissionPolicy],
      ['@deepseek-ai/dsh-tool-browser', ToolBrowser],
      ['@deepseek-ai/dsh-api-browser-controller', BrowserController],
      ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ])

    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    // 1. Verify CDP endpoint is exposed by the persistent browser provider
    expect(context.browser.cdpEndpoint?.()).toBe('http://127.0.0.1:9222')

    // 2. Mock Playwright browser and page interactions
    const events = new EventEmitter()
    const closed = vi.fn(async () => { events.emit('close') })
    const mockPageEvents = new EventEmitter()
    const mockPage = {
      url: () => 'https://cinlan.test/dashboard',
      title: async () => 'Cinlan Workstation Dashboard',
      on: mockPageEvents.on.bind(mockPageEvents),
      once: mockPageEvents.once.bind(mockPageEvents),
      removeListener: mockPageEvents.removeListener.bind(mockPageEvents),
      isClosed: () => false,
      close: vi.fn(async () => {}),
      goto: vi.fn(async () => null),
      screenshot: vi.fn(async () => Buffer.from('fake-png')),
    } as unknown as Page

    const launch = vi.spyOn(chromium, 'launchPersistentContext').mockResolvedValue({
      pages: () => [mockPage],
      newPage: vi.fn(async () => mockPage),
      on: events.on.bind(events),
      close: closed,
      setDefaultTimeout: () => {},
      setDefaultNavigationTimeout: () => {},
    } as unknown as BrowserContext)

    // 3. Human opens page or user visits dashboard
    const pages = await context.browser.listPages()
    expect(launch).toHaveBeenCalledOnce()
    const launchOptions = launch.mock.calls[0]?.[1]
    expect(launchOptions?.args).toContain('--remote-debugging-port=9222')
    expect(pages).toHaveLength(1)
    expect(pages[0]?.title).toBe('Cinlan Workstation Dashboard')
    expect(pages[0]?.url).toBe('https://cinlan.test/dashboard')

    // 4. Agent queries browser state via model tool browser_list
    const listResult = await context.tools.execute({
      callId: ToolCallId('agent-call-1'),
      name: 'browser_list',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(listResult.isError).toBeFalsy()
    expect(listResult.content[0]?.type).toBe('text')
    const listText = (listResult.content[0] as { type: 'text'; text: string }).text
    expect(listText).toContain('Cinlan Workstation Dashboard')

    // 5. Co-screen state consistency: both human view and agent tool observe identical page
    expect(context.browser.cdpEndpoint?.()).toBe('http://127.0.0.1:9222')

    await context.fiber.dispose()
    expect(closed).toHaveBeenCalledOnce()
  })
})
