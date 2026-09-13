import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import MobileDeviceRuntime from '@deepseek-ai/dsh-mobile-device'
import * as CinlanMobileDevice from '@deepseek-ai/dsh-mobile-device-cinlan'
import * as MobileDevicePermissionPolicy from '@deepseek-ai/dsh-mobile-device-permission-policy'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolMobileDevice from '@deepseek-ai/dsh-tool-mobile-device'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Bundle from '../src/index.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MOBILE_PACKAGES = [
  '@deepseek-ai/dsh-mobile-device',
  '@deepseek-ai/dsh-mobile-device-cinlan',
  '@deepseek-ai/dsh-mobile-device-permission-policy',
  '@deepseek-ai/dsh-tool-mobile-device',
] as const

let fixtureRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

function envelope(result: unknown): string {
  return JSON.stringify({ id: 'fixture', ok: true, result, _meta: { runtimeId: 'fixture-runtime' } })
}

class FixtureSubprocess extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []

  resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(`C:\\fixture\\${command}.exe`)
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const result = spec.argv.includes('devices')
      ? [{
        backend: 'android', id: 'fixture-device', name: 'Fixture Pixel', state: 'booted', isAvailable: true,
      }]
      : { protocolVersion: 1 }
    const text = envelope(result)
    return {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: {
        stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: vi.fn(),
      waitForExit: vi.fn(() => Promise.resolve(true)),
    }
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('not used'))
  }
}

class FixtureAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024,
    maxImagePixels: 1024, maxImageDimension: 1024, mediaTypes: ['image/png'],
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
  if (!Array.isArray(parsed)) throw new TypeError('cinlan-mobile-device patch must be a patch list')
  return { manifest, patches: parsed as PatchOptions[] }
}

describe('dsh-cinlan-mobile-device bundle', () => {
  it('remains opt-in and composes all permission classes as ask', async () => {
    expect(Bundle.name).toBe('cinlan-mobile-device-bundle')
    Bundle.apply()
    const { manifest, patches } = await bundleInputs()
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([...MOBILE_PACKAGES].sort())
    const basePatch = await readFile(resolve(PACKAGE_ROOT, '../base/cordis.patch.yml'), 'utf8')
    for (const packageName of MOBILE_PACKAGES) expect(basePatch).not.toContain(packageName)
    const rows = applyEntryPatches([], structuredClone(patches), () => {})
    expect(rows.map(row => row.id)).toEqual([
      'mobile-device', 'mobile-device-cinlan', 'mobile-device-permission-policy', 'tool-mobile-device',
    ])
    expect(rows.find(row => row.id === 'mobile-device-permission-policy')?.config).toEqual({
      observe: 'ask', touch: 'ask', textInput: 'ask', deviceNavigation: 'ask',
    })
  })

  it.each(['ask', 'allow'] as const)('mobile Loader composition with %s observation policy', async (policy) => {
    const { patches } = await bundleInputs()
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-cinlan-mobile-device-bundle-'))
    const configPath = join(fixtureRoot, 'cordis.yml')
    const fixtureLayer: PatchOptions[] = [{ insert: [
      { id: 'fixture-subprocess', name: 'fixture-subprocess' },
      { id: 'fixture-attachments', name: 'fixture-attachments' },
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
      { id: 'tools', name: '@deepseek-ai/dsh-tools' },
    ] }]
    const override: PatchOptions[] = [{
      id: 'mobile-device-cinlan',
      config: { providerId: 'cinlan', command: 'fixture-cinlan', commandTimeoutMs: 1_000 },
    }]
    const composed = applyEntryPatches([], structuredClone([...fixtureLayer, ...patches, ...override, { id: 'mobile-device-permission-policy', config: { observe: policy, touch: 'ask', textInput: 'ask', deviceNavigation: 'ask' } }]), () => {})
    await writeFile(configPath, yaml.dump(composed, { lineWidth: -1, noRefs: true }))

    context = new Context()
    context.baseUrl = pathToFileURL(fixtureRoot).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-subprocess', FixtureSubprocess],
      ['fixture-attachments', FixtureAttachments],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-mobile-device', MobileDeviceRuntime],
      ['@deepseek-ai/dsh-mobile-device-cinlan', CinlanMobileDevice],
      ['@deepseek-ai/dsh-mobile-device-permission-policy', MobileDevicePermissionPolicy],
      ['@deepseek-ai/dsh-tool-mobile-device', ToolMobileDevice],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      'mobile_list_devices', 'mobile_observe', 'mobile_touch', 'mobile_type', 'mobile_button',
    ])
    const subprocess = context.subprocess as FixtureSubprocess
    await expect(context.mobileDevice.listDevices()).resolves.toMatchObject([{ id: 'fixture-device' }])
    const spawned = subprocess.specs.length
    const denied = await context.tools.execute({
      callId: ToolCallId('bundle-mobile-list'), name: 'mobile_list_devices', arguments: {},
      signal: new AbortController().signal,
    })
    if (policy === 'ask') {
      expect(denied).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Error: Allow this call to list or observe local mobile devices?' }],
      })
      expect(subprocess.specs).toHaveLength(spawned)
    } else {
      expect(denied.isError).toBe(false)
      expect(subprocess.specs).toHaveLength(spawned + 1)
      expect(denied.value).toMatchObject({ devices: [{ device_id: 'fixture-device' }] })
    }
    expect((await context.systemPrompt.assemble()).sections.find(section => section.name === 'tool:mobile-device')?.text)
      .toContain('Android emulators')
  })
})
