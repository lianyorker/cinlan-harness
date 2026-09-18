import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { chromium, type BrowserContext } from 'playwright-core'
import * as BrowserPermissionPolicy from '@deepseek-ai/dsh-browser-permission-policy'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolBrowser from '@deepseek-ai/dsh-tool-browser'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BROWSER_PACKAGES = [
  '@deepseek-ai/dsh-browser',
  '@deepseek-ai/dsh-browser-playwright',
  '@deepseek-ai/dsh-browser-permission-policy',
  '@deepseek-ai/dsh-tool-browser',
  '@deepseek-ai/dsh-api-browser-controller',
  '@deepseek-ai/dsh-client-ui-browser-element-capture',
] as const

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
  manifest: { dependencies?: Record<string, string>; dsh?: { bundle?: { patch?: string } } }
  patches: PatchOptions[]
}> {
  const manifest = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const parsed = yaml.load(
    await readFile(resolve(PACKAGE_ROOT, manifest.dsh!.bundle!.patch!), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError('cinlan-browser patch must be a patch list')
  return { manifest, patches: parsed as PatchOptions[] }
}

describe('dsh-cinlan-browser bundle', () => {
  it('remains opt-in and composes a least-privilege browser layer', async () => {
    const { manifest, patches } = await bundleInputs()
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([...BROWSER_PACKAGES].sort())

    const basePatch = await readFile(resolve(PACKAGE_ROOT, '../base/cordis.patch.yml'), 'utf8')
    for (const packageName of BROWSER_PACKAGES) expect(basePatch).not.toContain(packageName)

    const rows = applyEntryPatches([], structuredClone(patches), () => {})
    expect(rows.map(row => row.id)).toEqual([
      'browser',
      'browser-playwright',
      'browser-permission-policy',
      'tool-browser',
      'browser-controller',
      'ui-browser-element-capture',
    ])
    expect(rows.find(row => row.id === 'browser')?.config).toEqual({ provider: 'local' })
    expect(rows.find(row => row.id === 'browser-playwright')?.config).toEqual({ providerId: 'local' })
    expect(rows.find(row => row.id === 'browser-permission-policy')?.config).toEqual({
      observe: 'ask',
      navigate: 'ask',
      interact: 'ask',
    })
  })

  it('boots the native provider through Loader without any external application command', async () => {
    const { patches } = await bundleInputs()
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-cinlan-browser-bundle-'))
    const configPath = join(fixtureRoot, 'cordis.yml')
    const fixtureLayer: PatchOptions[] = [{
      insert: [
        { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: join(fixtureRoot, 'settings.json'), watch: false } },
        { id: 'fixture-attachments', name: 'fixture-attachments' },
        { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
        { id: 'tools', name: '@deepseek-ai/dsh-tools' },
        { id: 'typert', name: '@deepseek-ai/dsh-typert-registry' },
      ],
    }]
    const profileOverride: PatchOptions[] = [{
      // Browser presentation is exercised by the assembled Web acceptance case.
      id: 'ui-browser-element-capture',
      disabled: true,
    }, {
      id: 'browser-playwright',
      config: {
        providerId: 'local',
        storageDir: join(fixtureRoot, 'browser-profile'),
        headless: true,
      },
    }]
    const composed = applyEntryPatches(
      [],
      structuredClone([...fixtureLayer, ...patches, ...profileOverride]),
      () => {},
    )
    expect(composed.find(row => row.id === 'browser-playwright')?.config).toMatchObject({
      providerId: 'local',
      headless: true,
    })
    await writeFile(configPath, yaml.dump(composed, { lineWidth: -1, noRefs: true }))

    context = new Context()
    context.baseUrl = pathToFileURL(fixtureRoot).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
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

    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      'browser_list',
      'browser_open',
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_screenshot',
      'browser_home',
      'browser_search',
      'browser_history',
      'browser_back',
      'browser_forward',
      'browser_network',
      'browser_upload',
      'browser_downloads',
      'browser_save_download',
      'browser_close',
    ])
    const closed = vi.fn(async () => {})
    const launch = vi.spyOn(chromium, 'launchPersistentContext').mockResolvedValue({
      pages: () => [], on: () => {}, close: closed,
      setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {},
    } as unknown as BrowserContext)
    expect(context.get('subprocess')).toBeUndefined()
    expect(launch).not.toHaveBeenCalled()
    const denied = await context.tools.execute({
      callId: ToolCallId('bundle-browser-list'),
      name: 'browser_list',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(denied).toMatchObject({
      isError: true,
      content: [{
        type: 'text',
        text: 'Error: Allow this call to observe persistent browser tabs or page content?',
      }],
    })
    expect(launch).not.toHaveBeenCalled()
    await expect(context.browser.listPages()).resolves.toEqual([])
    expect(launch).toHaveBeenCalledWith(join(fixtureRoot, 'browser-profile'), expect.objectContaining({ channel: 'chrome', headless: true }))


    const prompt = await context.systemPrompt.assemble()
    expect(prompt.sections.find(section => section.name === 'tool:browser')?.text)
      .toContain('persistent web pages in the configured browser')
    await context.fiber.dispose()
    expect(closed).toHaveBeenCalledOnce()
  })
})
