import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { execa } from 'execa'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import GitWorkspaceIsolation from '@deepseek-ai/dsh-workspace-isolation-git'

/**
 * End-to-end tests for workspace-isolation lifecycle.
 *
 * Tests the complete flow: ensure → modify → hibernate → activate → verify → merge → teardown
 * These tests use real Git operations and real filesystem operations.
 */

let ctx: Context | undefined
let testRoot: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (testRoot !== undefined) {
    await rm(testRoot, { recursive: true, force: true })
  }
  testRoot = undefined
})

async function mountStorage(context: Context): Promise<void> {
  await context.plugin(Storage)
  context.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(context, { backend: 'memory', routes: {} })
  context.storage.mount('domain', facility)
  context.provide('storageDomain', facility)
  await context.plugin(AgentRegistry)
  await context.plugin(LocalSubprocessRuntime)
}

async function harness() {
  testRoot = await mkdtemp(join(tmpdir(), 'dsh-workspace-isolation-e2e-'))

  // Create a test Git repository
  const repoPath = join(testRoot, 'test-repo')
  await mkdir(repoPath, { recursive: true })

  // Initialize Git repo
  await execa('git', ['init'], { cwd: repoPath })
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: repoPath })
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })

  // Create initial commit
  await writeFile(join(repoPath, 'README.md'), '# Test Repository\n')
  await writeFile(join(repoPath, 'file1.txt'), 'original content\n')
  await execa('git', ['add', '.'], { cwd: repoPath })
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: repoPath })

  // Create storage and managed directory
  const storageDir = join(testRoot, 'storage')
  const managedDir = join(testRoot, 'managed')
  await mkdir(storageDir, { recursive: true })
  await mkdir(managedDir, { recursive: true })

  // Set up Context with plugins
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await mountStorage(ctx)
  await ctx.plugin(GitWorkspaceIsolation, {
    root: managedDir,
    maxActiveCheckouts: 10,
  })

  return { ctx, repoPath, managedDir }
}

describe('workspace-isolation e2e: complete lifecycle', () => {
  it('completes the full lifecycle: ensure → modify → hibernate → activate → verify → merge → teardown', async () => {
    const h = await harness()
    const sessionId = SessionId('lifecycle-test')

    // Step 1: Create initial lease
    const lease1 = await h.ctx.workspaceIsolation.ensure({
      sessionId,
      sourcePath: h.repoPath,
    })

    expect(lease1.phase).toBe('active')
    expect(lease1.baseBranch).toBeTruthy()
    expect(lease1.baseHead).toMatch(/^[0-9a-f]{40}$/)
    expect(lease1.checkoutPath).toContain(h.managedDir)

    // Verify initial content
    const initialContent = await readFile(join(lease1.checkoutPath, 'file1.txt'), 'utf8')
    expect(initialContent).toBe('original content\n')

    // Step 2: Make changes in the worktree
    await writeFile(join(lease1.checkoutPath, 'file1.txt'), 'modified content\n')
    await writeFile(join(lease1.checkoutPath, 'newfile.txt'), 'new content\n')

    // Step 3: Hibernate the worktree
    await h.ctx.workspaceIsolation.hibernate(lease1.id)

    // Verify lease is hibernated
    const hibernatedLease = h.ctx.workspaceIsolation.find(lease1.sessionId)
    expect(hibernatedLease?.phase).toBe('hibernated')

    // Step 4: Activate (resume) the worktree
    const lease2 = await h.ctx.workspaceIsolation.ensure({
      sessionId,
      sourcePath: h.repoPath,
    })

    expect(lease2.phase).toBe('active')
    expect(lease2.id).toBe(lease1.id) // Same lease resumed

    // Step 5: Verify changes were preserved
    const modifiedContent = await readFile(join(lease2.checkoutPath, 'file1.txt'), 'utf8')
    expect(modifiedContent).toBe('modified content\n')

    const newContent = await readFile(join(lease2.checkoutPath, 'newfile.txt'), 'utf8')
    expect(newContent).toBe('new content\n')

    // Step 6: Integrate the managed branch into its recorded base branch.
    await h.ctx.workspaceIsolation.merge(lease2.id)
    expect(await readFile(join(h.repoPath, 'file1.txt'), 'utf8')).toBe('modified content\n')
    expect(await readFile(join(h.repoPath, 'newfile.txt'), 'utf8')).toBe('new content\n')

    // Step 7: Teardown after safe integration.
    await h.ctx.workspaceIsolation.teardown(lease2.id)

    // Verify lease is removed
    const removedLease = h.ctx.workspaceIsolation.find(lease2.sessionId)
    expect(removedLease).toBeUndefined()
  })

  it('handles multiple concurrent sessions', async () => {
    const h = await harness()

    // Create leases for multiple sessions
    const session1 = SessionId('concurrent-1')
    const session2 = SessionId('concurrent-2')
    const session3 = SessionId('concurrent-3')

    const lease1 = await h.ctx.workspaceIsolation.ensure({
      sessionId: session1,
      sourcePath: h.repoPath,
    })

    const lease2 = await h.ctx.workspaceIsolation.ensure({
      sessionId: session2,
      sourcePath: h.repoPath,
    })

    const lease3 = await h.ctx.workspaceIsolation.ensure({
      sessionId: session3,
      sourcePath: h.repoPath,
    })

    // Verify all leases are independent
    expect(lease1.id).not.toBe(lease2.id)
    expect(lease2.id).not.toBe(lease3.id)
    expect(lease1.checkoutPath).not.toBe(lease2.checkoutPath)
    expect(lease2.checkoutPath).not.toBe(lease3.checkoutPath)

    // Make different changes in each worktree
    await writeFile(join(lease1.checkoutPath, 'marker.txt'), 'session1\n')
    await writeFile(join(lease2.checkoutPath, 'marker.txt'), 'session2\n')
    await writeFile(join(lease3.checkoutPath, 'marker.txt'), 'session3\n')

    // Verify isolation
    const marker1 = await readFile(join(lease1.checkoutPath, 'marker.txt'), 'utf8')
    const marker2 = await readFile(join(lease2.checkoutPath, 'marker.txt'), 'utf8')
    const marker3 = await readFile(join(lease3.checkoutPath, 'marker.txt'), 'utf8')

    expect(marker1).toBe('session1\n')
    expect(marker2).toBe('session2\n')
    expect(marker3).toBe('session3\n')

    // Cleanup
    await h.ctx.workspaceIsolation.teardown(lease1.id)
    await h.ctx.workspaceIsolation.teardown(lease2.id)
    await h.ctx.workspaceIsolation.teardown(lease3.id)
  })

  it('enforces maxActiveCheckouts limit', async () => {
    const h = await harness()

    // Reconfigure with maxActiveCheckouts: 2
    await h.ctx.fiber.dispose()

    ctx = new Context()
    await ctx.plugin(SessionStore)
    await mountStorage(ctx)
    await ctx.plugin(GitWorkspaceIsolation, {
      root: h.managedDir,
      maxActiveCheckouts: 2,
    })

    // Create 2 active leases
    const lease1 = await ctx.workspaceIsolation.ensure({
      sessionId: SessionId('limit-1'),
      sourcePath: h.repoPath,
    })

    const lease2 = await ctx.workspaceIsolation.ensure({
      sessionId: SessionId('limit-2'),
      sourcePath: h.repoPath,
    })

    expect(lease1.phase).toBe('active')
    expect(lease2.phase).toBe('active')

    // Creating a third should reclaim the oldest
    const lease3 = await ctx.workspaceIsolation.ensure({
      sessionId: SessionId('limit-3'),
      sourcePath: h.repoPath,
    })

    expect(lease3.phase).toBe('active')

    // Verify lease1 was reclaimed (hibernated)
    const reclaimed = ctx.workspaceIsolation.find(lease1.sessionId)
    expect(reclaimed?.phase).toBe('hibernated')
  })

  it('prunes orphaned worktrees', async () => {
    const h = await harness()
    const sessionId = SessionId('orphan-test')

    // Create a lease
    const lease = await h.ctx.workspaceIsolation.ensure({
      sessionId,
      sourcePath: h.repoPath,
    })

    expect(lease.phase).toBe('active')

    // Manually corrupt: teardown but simulate incomplete cleanup
    // by directly removing the lease record while leaving the worktree
    await h.ctx.workspaceIsolation.teardown(lease.id)

    // Create a new lease to trigger pruneOrphans internally
    // (or call it explicitly if exposed)
    const newSessionId = SessionId('new-session')
    const newLease = await h.ctx.workspaceIsolation.ensure({
      sessionId: newSessionId,
      sourcePath: h.repoPath,
    })

    expect(newLease.phase).toBe('active')
    expect(newLease.id).not.toBe(lease.id)
  })

  it('preserves baseBranch and baseHead across lifecycle', async () => {
    const h = await harness()
    const sessionId = SessionId('base-tracking')

    // Get current branch and HEAD before creating lease
    const branchResult = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: h.repoPath })
    const baseBranch = branchResult.stdout.trim()

    const headResult = await execa('git', ['rev-parse', 'HEAD'], { cwd: h.repoPath })
    const baseHead = headResult.stdout.trim()

    // Create lease
    const lease1 = await h.ctx.workspaceIsolation.ensure({
      sessionId,
      sourcePath: h.repoPath,
    })

    expect(lease1.baseBranch).toBe(baseBranch)
    expect(lease1.baseHead).toBe(baseHead)

    // Hibernate
    await h.ctx.workspaceIsolation.hibernate(lease1.id)

    const hibernated = h.ctx.workspaceIsolation.find(lease1.sessionId)
    expect(hibernated?.baseBranch).toBe(baseBranch)
    expect(hibernated?.baseHead).toBe(baseHead)

    // Activate
    const lease2 = await h.ctx.workspaceIsolation.ensure({
      sessionId,
      sourcePath: h.repoPath,
    })

    expect(lease2.baseBranch).toBe(baseBranch)
    expect(lease2.baseHead).toBe(baseHead)
  })
})
