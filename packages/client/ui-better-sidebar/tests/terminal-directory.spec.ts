/** Floating terminal directories are resolved against real, canonical Session workspaces. */
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import { floatingTerminalDirectory } from '../src/terminal-directory.ts'

let scratch = ''
let workspace: string
let child: string
let outside: string
const links: string[] = []

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'dsh-terminal-directory-'))
  workspace = join(scratch, 'workspace')
  child = join(workspace, 'nested', 'child')
  outside = join(scratch, 'workspace-neighbor')
  await Promise.all([mkdir(child, { recursive: true }), mkdir(outside)])
  await writeFile(join(workspace, 'plain-file.txt'), 'not a directory')
})

afterEach(async () => {
  for (const path of links.splice(0)) await unlink(path)
  if (scratch !== '') await rm(scratch, { recursive: true, force: true })
  scratch = ''
})

async function directoryLink(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
  links.push(path)
}

describe('floatingTerminalDirectory', () => {
  it('accepts the workspace, a relative child, and an absolute child as canonical directories', async () => {
    const root = await realpath(workspace)
    const nested = await realpath(child)
    await expect(floatingTerminalDirectory(workspace, '')).resolves.toBe(root)
    await expect(floatingTerminalDirectory(workspace, '.')).resolves.toBe(root)
    await expect(floatingTerminalDirectory(workspace, 'nested/child')).resolves.toBe(nested)
    await expect(floatingTerminalDirectory(workspace, child)).resolves.toBe(nested)
  })

  it.each([undefined, '', 'relative/workspace'])('rejects a missing or non-absolute authoritative workspace: %s', async (root) => {
    await expect(floatingTerminalDirectory(root, '')).rejects.toMatchObject({ name: 'SidebarTerminalError', code: 'invalid-directory' })
  })

  it('rejects missing workspaces, missing children, files, and sibling paths sharing the workspace prefix', async () => {
    for (const [root, requested] of [
      [join(scratch, 'missing'), ''],
      [join(workspace, 'plain-file.txt'), ''],
      [workspace, 'missing'],
      [workspace, 'plain-file.txt'],
      [workspace, outside],
    ] as const) {
      await expect(floatingTerminalDirectory(root, requested)).rejects.toMatchObject({ code: 'invalid-directory' })
    }
  })

  it('rejects lexical traversal even when normalization returns an existing directory inside the workspace', async () => {
    const requested = 'nested/child/../child'
    expect(await realpath(resolve(workspace, requested))).toBe(await realpath(child))
    await expect(floatingTerminalDirectory(workspace, requested)).rejects.toMatchObject({ code: 'invalid-directory' })
    await expect(floatingTerminalDirectory(workspace, 'nested\\child\\..\\child')).rejects.toMatchObject({ code: 'invalid-directory' })
    await expect(floatingTerminalDirectory(workspace, '../workspace/nested/child')).rejects.toMatchObject({ code: 'invalid-directory' })
  })

  it('accepts canonical aliases inside the workspace and a linked authoritative workspace', async () => {
    const childAlias = join(workspace, 'child-link')
    const rootAlias = join(scratch, 'workspace-link')
    await directoryLink(child, childAlias)
    await directoryLink(workspace, rootAlias)
    await expect(floatingTerminalDirectory(workspace, 'child-link')).resolves.toBe(await realpath(child))
    await expect(floatingTerminalDirectory(rootAlias, 'nested/child')).resolves.toBe(await realpath(child))
    await expect(floatingTerminalDirectory(rootAlias, '')).resolves.toBe(await realpath(workspace))
  })

  it('rejects a symlink or junction whose canonical target escapes the workspace', async () => {
    const escape = join(workspace, 'escape')
    await directoryLink(outside, escape)
    expect(await realpath(escape)).toBe(await realpath(outside))
    await expect(floatingTerminalDirectory(workspace, 'escape')).rejects.toBeInstanceOf(SidebarTerminalError)
    await expect(floatingTerminalDirectory(workspace, escape)).rejects.toMatchObject({ code: 'invalid-directory' })
  })
})
