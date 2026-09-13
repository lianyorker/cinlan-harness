import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import BrowserRuntime, {
  BrowserElementId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type { BrowserProvider } from '@deepseek-ai/dsh-browser'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as ToolBrowser from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const provider: BrowserProvider = {
  id: 'loader-browser',
  available: () => true,
  listPages: () => Promise.resolve([]),
  openPage: () => Promise.resolve({ pageId: BrowserPageId('loader-page') }),
  navigate: request => Promise.resolve({ pageId: request.pageId, url: request.url, title: 'Loader page' }),
  snapshot: request => Promise.resolve({
    observationId: BrowserObservationId('loader-observation'),
    pageId: request.pageId,
    url: 'https://loader.example/',
    title: 'Loader page',
    tree: 'document "Loader page"\n  button "Continue" [ref=e1]',
    elements: [{ elementId: BrowserElementId('e1'), role: 'button', name: 'Continue' }],
  }),
  click: request => Promise.resolve(request),
  screenshot: request => Promise.resolve({
    pageId: request.pageId,
    format: request.format,
    mediaType: request.format === 'png' ? 'image/png' : 'image/jpeg',
    data: Uint8Array.of(1),
  }),
  closePage: () => Promise.resolve(),
}

const TestBrowserProvider = {
  name: 'test-browser-provider',
  inject: ['browser'],
  apply(ctx: Context) {
    ctx.browser.registerProvider(provider)
  },
}

class TestAttachmentStore extends AttachmentStore {
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

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.resolve({
      attachmentId: AttachmentId('sha256:loader-image'),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    })
  }

  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('unused'))
  }
}

describe('dsh-tool-browser through a real cordis.yml Loader composition', () => {
  it('loads the capability and snapshots model-visible persistent-browser output', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tool-browser-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-browser'",
      "- name: '@deepseek-ai/dsh-test-browser-provider'",
      "- name: '@deepseek-ai/dsh-test-attachments'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-tool-browser'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-browser', BrowserRuntime],
      ['@deepseek-ai/dsh-test-browser-provider', TestBrowserProvider],
      ['@deepseek-ai/dsh-test-attachments', TestAttachmentStore],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-browser', ToolBrowser],
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

    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      'browser_list', 'browser_open', 'browser_navigate', 'browser_snapshot',
      'browser_click', 'browser_screenshot', 'browser_home', 'browser_search', 'browser_history',
      'browser_back', 'browser_forward', 'browser_network', 'browser_upload', 'browser_downloads', 'browser_save_download', 'browser_close',
    ])
    const result = await context.tools.execute({
      callId: ToolCallId('loader-browser-snapshot'),
      name: 'browser_snapshot',
      arguments: { page_id: 'loader-page' },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(result.content).toMatchInlineSnapshot(`
      [
        {
          "text": "Observation: loader-observation
      Page: loader-page
      Title: Loader page
      URL: https://loader.example/
      document \"Loader page\"
        button \"Continue\" [ref=e1]",
          "type": "text",
        },
      ]
    `)
  })
})
