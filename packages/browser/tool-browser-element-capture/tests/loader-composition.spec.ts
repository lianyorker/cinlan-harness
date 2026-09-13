/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import BrowserRuntime from '@deepseek-ai/dsh-browser'
import * as BrowserPermissionPolicy from '@deepseek-ai/dsh-browser-permission-policy'
import * as BrowserPlaywright from '@deepseek-ai/dsh-browser-playwright'
import CoordinationLocal from '@deepseek-ai/dsh-coordination-local'
import * as BrowserElementCaptureExecutor from '@deepseek-ai/dsh-coordination-browser-element-capture'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { chromium } from 'playwright-core'
import type { BrowserContext, ElementHandle, Locator, Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as BrowserElementCaptureConsumer from '../src/index.ts'
import FixtureAttachmentStore from './fixtures/attachment-store.ts'
import FixtureVisionAdapter from './fixtures/vision-adapter.ts'

let fixtureRoot: string | undefined
let context: Context | undefined
let callNumber = 0

class FixtureElement {
  readonly dispose = vi.fn(() => Promise.resolve())
  readonly boundingBox = vi.fn(() => Promise.resolve({ x: 10, y: 20, width: 30, height: 40 }))

  evaluate<T>(callback: (node: Element) => T): Promise<T> {
    const node = {
      tagName: 'BUTTON',
      getAttribute: (name: string) => name === 'role'
        ? 'button'
        : name === 'aria-label'
          ? 'Continue'
          : null,
      textContent: 'Continue',
    } as unknown as Element
    return Promise.resolve(callback(node))
  }
}

class FixtureLocator {
  constructor(
    private readonly body: boolean,
    private readonly element: FixtureElement,
  ) {}

  ariaSnapshot(): Promise<string> {
    return Promise.resolve('- document "Capture fixture"')
  }

  count(): Promise<number> {
    return Promise.resolve(this.body ? 0 : 1)
  }

  nth(_index: number): Locator {
    return this as unknown as Locator
  }

  isVisible(): Promise<boolean> {
    return Promise.resolve(true)
  }

  elementHandle(): Promise<ElementHandle> {
    return Promise.resolve(this.element as unknown as ElementHandle)
  }

  evaluate<T>(callback: (node: { tagName: string }) => T): Promise<T> {
    return Promise.resolve(callback({ tagName: 'BUTTON' }))
  }

  getAttribute(name: string): Promise<string | null> {
    return Promise.resolve(name === 'role' ? 'button' : name === 'aria-label' ? 'Continue' : null)
  }

  textContent(): Promise<string> {
    return Promise.resolve('Continue')
  }
}

class FixturePage {
  readonly element = new FixtureElement()
  readonly screenshot = vi.fn(() => Promise.resolve(Buffer.from([1, 2, 3])))
  private readonly frame = {}
  private readonly listeners = new Map<string, Array<(value: unknown) => void>>()

  on(event: string, listener: (value: unknown) => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }

  url(): string {
    return 'https://capture.fixture/'
  }

  title(): Promise<string> {
    return Promise.resolve('Capture fixture')
  }

  isClosed(): boolean {
    return false
  }

  mainFrame(): object {
    return this.frame
  }

  locator(selector: string): Locator {
    return new FixtureLocator(selector === 'body', this.element) as unknown as Locator
  }

  evaluate<T>(_callback: () => T): Promise<T> {
    return Promise.resolve({ width: 800, height: 600 } as T)
  }
}

class FixtureBrowserContext {
  readonly page = new FixturePage()
  readonly close = vi.fn(() => Promise.resolve())
  readonly setDefaultTimeout = vi.fn()
  readonly setDefaultNavigationTimeout = vi.fn()

  pages(): Page[] {
    return [this.page as unknown as Page]
  }

  on(_event: string, _listener: (page: Page) => void): this {
    return this
  }
}

function expectSuccess(result: ToolExecutionResult): asserts result is Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful tool result')
}

function execute(
  ctx: Context,
  name: string,
  arguments_: unknown,
  agent?: unknown,
): Promise<ToolExecutionResult> {
  callNumber += 1
  return ctx.tools.execute({
    callId: ToolCallId(`loader-capture-${callNumber}`),
    name,
    arguments: arguments_,
    signal: new AbortController().signal,
    ...(agent === undefined ? {} : { agent: agent as never }),
  })
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.restoreAllMocks()
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

describe('browser element capture through a real cordis.yml Loader composition', () => {
  it('loads the opt-in provider and persists a verified snapshot-bound crop', async () => {
    const browserContext = new FixtureBrowserContext()
    const launch = vi.spyOn(chromium, 'launchPersistentContext')
      .mockResolvedValue(browserContext as unknown as BrowserContext)
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-browser-capture-settings-'))
    const template = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
    const path = join(fixtureRoot, 'cordis.yml')
    await writeFile(path, template.replace('FIXTURE_SETTINGS_PATH', JSON.stringify(join(fixtureRoot, 'settings.json'))))
    const configUrl = pathToFileURL(path)

    context = new Context()
    context.baseUrl = new URL('./fixtures/', import.meta.url).href
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
      ['@deepseek-ai/dsh-browser', BrowserRuntime],
      ['@deepseek-ai/dsh-browser-playwright', BrowserPlaywright],
      ['./attachment-store.ts', FixtureAttachmentStore],
      ['@deepseek-ai/dsh-llm', LlmRuntime],
      ['./vision-adapter.ts', FixtureVisionAdapter],
      ['@deepseek-ai/dsh-coordination-local', CoordinationLocal],
      ['@deepseek-ai/dsh-coordination-browser-element-capture', BrowserElementCaptureExecutor],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-browser', ToolBrowser],
      ['@deepseek-ai/dsh-browser-permission-policy', BrowserPermissionPolicy],
      ['@deepseek-ai/dsh-tool-browser-element-capture', BrowserElementCaptureConsumer],
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
      config: { path: configUrl.href },
    })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      'browser_list', 'browser_open', 'browser_navigate', 'browser_snapshot',
      'browser_click', 'browser_screenshot', 'browser_home', 'browser_search', 'browser_history',
      'browser_back', 'browser_forward', 'browser_network', 'browser_upload', 'browser_downloads', 'browser_save_download', 'browser_close',
      'browser_select_element', 'browser_capture_element',
    ])

    const listed = await execute(context, 'browser_list', {})
    expectSuccess(listed)
    const page = (listed.value as { pages: Array<{ page_id: string }> }).pages[0]
    if (page === undefined) throw new Error('fixture page was not listed')

    const snapshot = await execute(context, 'browser_snapshot', { page_id: page.page_id })
    expectSuccess(snapshot)
    const observed = snapshot.value as {
      observation_id: string
      elements: Array<{ element_id: string }>
    }
    const element = observed.elements[0]
    if (element === undefined) throw new Error('fixture element was not observed')

    const agent = {
      options: { provider: 'fixture', model: 'vision' },
      session: { requestHeader: () => ({ config: { provider: 'fixture', model: 'vision' } }) },
    }
    const capture = await execute(context, 'browser_capture_element', {
      page_id: page.page_id,
      observation_id: observed.observation_id,
      element_id: element.element_id,
    }, agent)
    expectSuccess(capture)
    expect(capture.value).toEqual({
      page_id: page.page_id,
      target: {
        kind: 'observation',
        observation_id: observed.observation_id,
        element_id: element.element_id,
      },
      verified: true,
      image: {
        attachmentId: 'sha256:loader-element',
        mediaType: 'image/png',
        bytes: 3,
        width: 30,
        height: 40,
        name: 'browser-element.png',
      },
    })
    expect(capture.content).toEqual([
      { type: 'text', text: expect.stringContaining('Captured a verified browser element image.') },
      {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('sha256:loader-element'),
          mediaType: 'image/png',
          bytes: 3,
          width: 30,
          height: 40,
          name: 'browser-element.png',
        },
      },
    ])
    expect(browserContext.page.screenshot).toHaveBeenCalledWith({
      type: 'png',
      clip: { x: 10, y: 20, width: 30, height: 40 },
    })
    expect(launch).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]profile$/u),
      expect.objectContaining({ channel: 'chrome', headless: true }),
    )

    const stored = await context.attachments.readImage({
      attachmentId: AttachmentId('sha256:loader-element'),
      mediaType: 'image/png',
      bytes: 3,
      width: 30,
      height: 40,
      name: 'browser-element.png',
    })
    expect([...stored.data]).toEqual([1, 2, 3])
  })
})
