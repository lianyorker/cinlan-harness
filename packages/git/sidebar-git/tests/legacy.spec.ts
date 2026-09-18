/** History paging and legacy destructive-action guarantees through the real Git owner. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fixtureGit, harness } from './fixture.ts'

afterEach(cleanup, 90_000)

describe('sidebar Git legacy behavior through real Loader composition', { timeout: 90_000 }, () => {
  it('pages the same ordered history with skip and count and stops at the measured end', async () => {
    const h = await harness()
    for (let index = 1; index < 10; index++) {
      await fixtureGit(h.repository, 'commit', '--quiet', '--allow-empty', '-m', `page ${index}`)
    }
    const first = await h.service.log({ ...h.request, count: 5, skip: 0 })
    const second = await h.service.log({ ...h.request, count: 5, skip: 5 })
    expect(first).toHaveLength(5)
    expect(second).toHaveLength(5)
    expect(first[0]?.hashFull).not.toBe(second[0]?.hashFull)
    expect(first[0]?.hash).toMatch(/^[0-9a-f]{7,}$/)
    expect(first[0]?.hashFull).toMatch(/^[0-9a-f]{40}$/)
    expect(first[0]?.refs).toContain('HEAD -> main')
    const all = await h.service.log({ ...h.request, count: 10, skip: 0 })
    expect(all.slice(0, 5)).toEqual(first)
    expect(all.slice(5)).toEqual(second)
    expect(all.map(entry => entry.subject)).toEqual(['page 9', 'page 8', 'page 7', 'page 6', 'page 5',
      'page 4', 'page 3', 'page 2', 'page 1', 'base'])
    const count = Number.parseInt(await fixtureGit(h.repository, 'rev-list', '--count', 'HEAD'), 10)
    expect(count).toBe(10)
    expect(await h.service.log({ ...h.request, count: 5, skip: count })).toEqual([])
  })

  it('keeps staged data on discard and refuses missing history hashes without changing the repository', async () => {
    const h = await harness()
    const file = join(h.repository, 'tracked.txt')
    await writeFile(file, 'staged content\n')
    await h.service.stage({ ...h.mutation, path: 'tracked.txt' })
    const staged = await h.service.diff({ ...h.request, path: 'tracked.txt', staged: true })
    expect(staged.diff).toContain('-base')
    expect(staged.diff).toContain('+staged content')
    await writeFile(file, 'unstaged content\n')
    await h.service.discard({ ...h.mutation, head: h.initial.head, path: 'tracked.txt' })
    expect(await readFile(file, 'utf8')).toBe('staged content\n')
    expect(await h.service.diff({ ...h.request, path: 'tracked.txt', staged: true })).toEqual(staged)
    expect(await h.service.diff({ ...h.request, path: 'tracked.txt', staged: false })).toEqual({ diff: '' })
    const before = await h.service.status(h.request)
    const missing = { ...h.mutation, head: h.initial.head, hash: 'deadbeef0000000000000000000000000000000000' }
    await expect(h.service.revert(missing)).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(h.service.cherryPick(missing)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(await h.service.status(h.request)).toEqual(before)
    expect((await fixtureGit(h.repository, 'rev-parse', 'HEAD')).trim()).toBe(h.initial.head)
    expect(await h.service.diff({ ...h.request, path: 'tracked.txt', staged: true })).toEqual(staged)
    expect(await readFile(file, 'utf8')).toBe('staged content\n')
  })
})
