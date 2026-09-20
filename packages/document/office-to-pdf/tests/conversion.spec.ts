/** Real Office conversion through Loader, workspace authorization, local FS, and independent PDF parsing. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as WorkspaceFiles from '@deepseek-ai/dsh-api-workspace-files'
import * as LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import * as Sessions from '@deepseek-ai/dsh-session'
import * as SessionProjections from '@deepseek-ai/dsh-session-projection'
import * as TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { expect, it, onTestFinished } from 'vitest'
import * as OfficeProvider from '../src/index.ts'
import { docxFixture, pptxFixture, xlsxFixture } from './fixtures/office.ts'

async function inspectPdf(bytes: Uint8Array): Promise<{ text: string; width: number; height: number }[]> {
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true })
  try {
    const pdf = await task.promise
    const pages: { text: string; width: number; height: number }[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })
      pages.push({ text: content.items.map(item => 'str' in item ? item.str : '').join(' '), width: viewport.width, height: viewport.height })
      page.cleanup()
    }
    return pages
  } finally { await task.destroy() }
}

it('renders Word text and tables, spreadsheet values, and ordered slides through the real Host composition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-office-conversion-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  }, 120_000)
  const modules = new Map<string, object>([
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-session', Sessions],
    ['@deepseek-ai/dsh-session-projection', SessionProjections],
    ['@deepseek-ai/dsh-sandbox-policy', SandboxPolicy],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-api-workspace-files', WorkspaceFiles],
    ['@deepseek-ai/dsh-office-to-pdf', OfficeProvider],
  ])
  const configPath = join(directory, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([...modules.keys()].map(name => ({ name, config: name === '@deepseek-ai/dsh-office-to-pdf'
    ? { maxConcurrentConversions: 1, maxInputBytes: 1024 * 1024, maxSourceBytes: 1024 * 1024 }
    : name === '@deepseek-ai/dsh-fs-local' ? { cwd: directory } : {} }))))
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // Keep Loader imports on the test's source graph so Cordis service identities are shared.
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error('Unexpected test plugin: ' + specifier)
      return module
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  const session = ctx.sessions.create(undefined, { meta: { cwd: directory } })
  const agent = { session } as Agent
  const provider = ctx.officeToPdf
  const signal = new AbortController().signal
  const fixtures = [
    { extension: 'docx', bytes: docxFixture(), expected: [['DOCX_TEXT_MARKER', 'DOCX_TABLE_MARKER', 'Sample widgets', '42'], ['DOCX_SECOND_PAGE']] },
    { extension: 'xlsx', bytes: xlsxFixture(), expected: [['XLSX_TABLE_MARKER', 'Revenue', 'North', '1200', 'South', '345', 'Calculated total', '1545']] },
    { extension: 'pptx', bytes: pptxFixture(), expected: [['PPTX_FIRST_SLIDE_MARKER'], ['PPTX_SECOND_SLIDE_MARKER']] },
  ]
  for (const fixture of fixtures) {
    const path = join(directory, 'preview.' + fixture.extension)
    await writeFile(path, fixture.bytes, { flag: 'wx' })
    const source = await ctx.workspaceFiles.stat(agent, path, signal)
    const result = await provider.render(agent, path, 'foreground', signal)
    expect(result).toMatchObject({ absolutePath: source.absolutePath, version: source.version,
      offset: 0, eof: true, generation: provider.generation })
    const bytes = Uint8Array.from(Buffer.from(result.data, 'base64'))
    expect(bytes.length).toBe(result.bytes)
    const pages = await inspectPdf(bytes)
    expect(pages).toHaveLength(fixture.expected.length)
    for (const [index, markers] of fixture.expected.entries()) {
      for (const marker of markers) expect(pages[index]!.text).toContain(marker)
    }
    if (fixture.extension === 'pptx') expect(pages[0]!.width).toBeGreaterThan(pages[0]!.height)
    const cached = await provider.render(agent, path, 'foreground', signal)
    expect(cached.data).toBe(result.data)
    expect(await readFile(path)).toEqual(Buffer.from(fixture.bytes))
  }
  const invalid = join(directory, 'invalid.docx')
  await writeFile(invalid, 'This is not an Office document.')
  await expect(provider.render(agent, invalid, 'foreground', signal)).rejects.toMatchObject({
    code: 'document-render/failed', details: { reason: 'invalid-document' },
  })
  const oversized = join(directory, 'oversized.docx')
  await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1))
  await expect(provider.render(agent, oversized, 'foreground', signal)).rejects.toMatchObject({
    code: 'document-render/failed', details: { reason: 'input-too-large' },
  })
  expect(session.snapshotEvents()).toEqual([])
  await ctx.fiber.dispose()
  expect(ctx.get('officeToPdf')).toBeUndefined()
  await expect(provider.render(agent, invalid, 'foreground', signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
}, 120_000)
