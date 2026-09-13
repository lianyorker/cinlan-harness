import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import ComputerUseRuntime from '@deepseek-ai/dsh-computer-use'
import * as CinlanComputerUse from '@deepseek-ai/dsh-computer-use-cinlan'
import * as ComputerUsePermissionPolicy from '@deepseek-ai/dsh-computer-use-permission-policy'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolComputerUse from '@deepseek-ai/dsh-tool-computer-use'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FIXTURE_CINLAN_COMMAND,
  FIXTURE_CINLAN_EXECUTABLE,
  FixtureCinlanSubprocess,
} from './fixtures/cinlan-command.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMPUTER_USE_PACKAGES = [
  '@deepseek-ai/dsh-computer-use',
  '@deepseek-ai/dsh-computer-use-cinlan',
  '@deepseek-ai/dsh-computer-use-permission-policy',
  '@deepseek-ai/dsh-tool-computer-use',
] as const

let fixtureRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

class FixtureAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1024,
    maxImagePixels: 1024, maxImageDimension: 1024,
    mediaTypes: ['image/png'],
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
  if (!Array.isArray(parsed)) throw new TypeError('cinlan-computer-use patch must be a patch list')
  return { manifest, patches: parsed as PatchOptions[] }
}

describe('dsh-cinlan-computer-use bundle', () => {
  it('remains opt-in and composes four least-privilege permission classes', async () => {
    const { manifest, patches } = await bundleInputs()
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([...COMPUTER_USE_PACKAGES].sort())

    const basePatch = await readFile(resolve(PACKAGE_ROOT, '../base/cordis.patch.yml'), 'utf8')
    for (const packageName of COMPUTER_USE_PACKAGES) expect(basePatch).not.toContain(packageName)

    const rows = applyEntryPatches([], structuredClone(patches), () => {})
    expect(rows.map(row => row.id)).toEqual([
      'computer-use',
      'computer-use-cinlan',
      'computer-use-permission-policy',
      'tool-computer-use',
    ])
    expect(rows.find(row => row.id === 'computer-use')?.config).toEqual({ provider: 'cinlan' })
    expect(rows.find(row => row.id === 'computer-use-cinlan')?.config).toEqual({ providerId: 'cinlan' })
    expect(rows.find(row => row.id === 'computer-use-permission-policy')?.config).toEqual({
      observe: 'ask',
      pointer: 'ask',
      keyboard: 'ask',
      accessibilityAction: 'ask',
    })
  })

  it.each(['ask', 'allow'] as const)('computer Loader composition with %s observation policy', async (policy) => {
    const { patches } = await bundleInputs()
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-cinlan-computer-use-bundle-'))
    const configPath = join(fixtureRoot, 'cordis.yml')
    const fixtureLayer: PatchOptions[] = [{
      insert: [
        { id: 'fixture-subprocess', name: 'fixture-subprocess' },
        { id: 'fixture-attachments', name: 'fixture-attachments' },
        { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
        { id: 'tools', name: '@deepseek-ai/dsh-tools' },
      ],
    }]
    const profileOverride: PatchOptions[] = [{
      id: 'computer-use-cinlan',
      config: {
        providerId: 'cinlan',
        command: FIXTURE_CINLAN_COMMAND,
        commandTimeoutMs: 1_000,
      },
    }]
    const composed = applyEntryPatches(
      [],
      structuredClone([...fixtureLayer, ...patches, ...profileOverride, { id: 'computer-use-permission-policy', config: { observe: policy, pointer: 'ask', keyboard: 'ask', accessibilityAction: 'ask' } }]),
      () => {},
    )
    await writeFile(configPath, yaml.dump(composed, { lineWidth: -1, noRefs: true }))

    context = new Context()
    context.baseUrl = pathToFileURL(fixtureRoot).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-subprocess', FixtureCinlanSubprocess],
      ['fixture-attachments', FixtureAttachments],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-computer-use', ComputerUseRuntime],
      ['@deepseek-ai/dsh-computer-use-cinlan', CinlanComputerUse],
      ['@deepseek-ai/dsh-computer-use-permission-policy', ComputerUsePermissionPolicy],
      ['@deepseek-ai/dsh-tool-computer-use', ToolComputerUse],
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
      'computer_list_apps',
      'computer_list_windows',
      'computer_observe',
      'computer_pointer',
      'computer_keyboard',
      'computer_accessibility',
    ])
    const subprocess = context.subprocess as FixtureCinlanSubprocess
    await expect(context.computerUse.listApps()).resolves.toMatchObject([{
      appId: 'fixture.app',
      name: 'Fixture App',
    }])
    expect(subprocess.resolvedCommands).toEqual([FIXTURE_CINLAN_COMMAND])
    expect(subprocess.specs[0]?.argv).toEqual([
      FIXTURE_CINLAN_EXECUTABLE,
      'computer',
      'list-apps',
      '--json',
    ])

    const spawned = subprocess.specs.length
    const denied = await context.tools.execute({
      callId: ToolCallId('bundle-computer-list-apps'),
      name: 'computer_list_apps',
      arguments: {},
      signal: new AbortController().signal,
    })
    if (policy === 'ask') {
      expect(denied).toMatchObject({
        isError: true,
        content: [{
          type: 'text',
          text: 'Error: Allow this call to observe local desktop applications or window content?',
        }],
      })
      expect(subprocess.specs).toHaveLength(spawned)
    } else {
      expect(denied.isError).toBe(false)
      expect(subprocess.specs).toHaveLength(spawned + 1)
      expect(denied.content).toEqual([{ type: 'text', text: 'fixture.app Fixture App pid=7' }])
    }

    const prompt = await context.systemPrompt.assemble()
    expect(prompt.sections.find(section => section.name === 'tool:computer-use')?.text)
      .toContain('local desktop applications')
  })
})
