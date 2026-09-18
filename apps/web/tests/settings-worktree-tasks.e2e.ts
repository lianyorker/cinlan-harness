/** Real Web defaults and task lifecycle over a private Git repository and owned hook markers. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, waitForApplicationFrame } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/settings-worktree-tasks/review.expected.md', import.meta.url))
const TASK_NAME = 'Native worktree acceptance'
const LITERAL_ARGUMENT = 'literal $HOME; & argument with spaces'
const execFileAsync = promisify(execFile)

async function openTasks(page: Page): Promise<Locator> {
  const settings = page.getByRole('region', { name: 'Settings', exact: true })
  if (!await settings.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('button', { name: 'Worktree tasks', exact: true }).click()
  await settings.getByRole('heading', { name: 'Worktree tasks', level: 1, exact: true }).waitFor()
  await expect.poll(() => settings.getByRole('button', { name: 'Save defaults', exact: true }).isEnabled()).toBe(true)
  return settings
}

async function fillProgram(group: Locator, executable: string, args: readonly string[]): Promise<void> {
  await group.getByRole('textbox', { name: 'Executable', exact: true }).fill(executable)
  for (const [index, argument] of args.entries()) {
    await group.getByRole('button', { name: 'Add argument', exact: true }).click()
    await group.getByRole('textbox', { name: 'Argument ' + String(index + 1), exact: true }).fill(argument)
  }
}

function detail(region: Locator, label: string): Locator {
  return region.getByText(label, { exact: true }).locator('..').locator('dd')
}

async function confirm(page: Page, action: 'Hibernate' | 'Archive' | 'Delete'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: action + ' this worktree task?', exact: true })
  await dialog.waitFor()
  expect(await dialog.getByRole('button', { name: action, exact: true }).isEnabled()).toBe(false)
  await dialog.getByRole('checkbox', {
    name: 'I understand that this reclaims the checkout and retains an unmerged branch.', exact: true,
  }).check()
  await dialog.getByRole('button', { name: action, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

it('persists defaults, reviews a real task, hibernates without cleanup, and exposes an archive receipt', async () => {
  const allocatedRoot = await mkdtemp(join(tmpdir(), 'dsh-settings-worktree-web-'))
  // oxlint-disable-next-line eslint/prefer-const -- Teardown is registered before partial setup can assign these resources.
  let scaffold: WebScaffold | undefined
  // oxlint-disable-next-line eslint/prefer-const -- Teardown is registered before partial setup can assign these resources.
  let browser: Browser | undefined
  onTestFinished(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => { failures.push(error) })
    await scaffold?.close().catch((error: unknown) => { failures.push(error) })
    await rm(allocatedRoot, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
    if (failures.length > 0) throw new AggregateError(failures, 'Worktree settings Web teardown failed')
  })
  const root = await realpath(allocatedRoot)
  const repository = join(root, 'repository')
  const managed = join(root, 'managed')
  const hookPath = join(root, 'lifecycle-hook.mjs')
  const setupMarker = join(root, 'setup-marker.jsonl')
  const cleanupMarker = join(root, 'cleanup-marker.jsonl')
  const emptyConfig = join(root, 'empty.gitconfig')
  const emptyHooks = join(root, 'empty-hooks')
  const nodeExecutable = await realpath(process.execPath)
  await mkdir(repository)
  await mkdir(emptyHooks)
  await writeFile(emptyConfig, '')
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    const result = await execFileAsync('git', [
      '-c', 'commit.gpgSign=false', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + emptyHooks, ...args,
    ], {
      cwd, encoding: 'utf8', timeout: 30_000,
      env: { ...inheritedEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' },
    })
    return result.stdout
  }
  await git(repository, 'init', '--template=', '--initial-branch=main', '--object-format=sha1')
  await git(repository, 'config', '--local', 'user.name', 'Worktree Web Fixture')
  await git(repository, 'config', '--local', 'user.email', 'worktree-web-fixture@localhost')
  await git(repository, 'config', '--local', 'core.autocrlf', 'false')
  await writeFile(join(repository, 'tracked.txt'), 'captured baseline\n')
  await git(repository, 'add', '--all')
  await git(repository, 'commit', '-m', 'Fixture baseline')
  const baseHead = (await git(repository, 'rev-parse', 'HEAD')).trim()
  await git(repository, 'branch', 'fixture-base')
  await writeFile(join(repository, 'tracked.txt'), 'source main head\n')
  await git(repository, 'commit', '-am', 'Different source head')
  const sourceHead = (await git(repository, 'rev-parse', 'HEAD')).trim()
  expect(sourceHead).not.toBe(baseHead)
  await writeFile(hookPath, [
    "import { appendFileSync } from 'node:fs'",
    'const [marker, phase, argument] = process.argv.slice(2)',
    "appendFileSync(marker, JSON.stringify({ phase, cwd: process.cwd(), argument }) + '\\n')",
    '',
  ].join('\n'))
  const setupArgs = [hookPath, setupMarker, 'setup', LITERAL_ARGUMENT]
  const cleanupArgs = [hookPath, cleanupMarker, 'cleanup', LITERAL_ARGUMENT]
  const overlay = join(root, 'worktree.patch.yml')
  // These optional production rows extend the shipped Web composition through its normal overlay.
  await writeFile(overlay, JSON.stringify([{ insert: [
    { id: 'worktree-task-git', name: '@deepseek-ai/dsh-worktree-task-git', config: { root: managed } },
    { id: 'worktree-task-controller', name: '@deepseek-ai/dsh-api-worktree-task-controller' },
    { id: 'ui-worktree-task', name: '@deepseek-ai/dsh-client-ui-worktree-task' },
  ] }]) + '\n')
  scaffold = await launchWebScaffold({
    extraOverlayPath: overlay, harnessHome: join(root, 'home'), storageRoot: join(root, 'storage'),
  })
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  page.setDefaultTimeout(15_000)
  const observation = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-worktree-tasks'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await connectFreshWorkspace(page, root, 'repository')
  const settings = await openTasks(page)
  const defaults = settings.getByRole('region', { name: 'New task defaults', exact: true })
  await defaults.getByRole('textbox', { name: 'Default subdirectory', exact: true }).fill('tasks')
  await defaults.getByRole('textbox', { name: 'Default starting point', exact: true }).fill('fixture-base')
  await fillProgram(defaults.getByRole('group', { name: 'Setup program', exact: true }), nodeExecutable, setupArgs)
  await fillProgram(defaults.getByRole('group', { name: 'Cleanup program', exact: true }), nodeExecutable, cleanupArgs)
  await defaults.getByRole('button', { name: 'Save defaults', exact: true }).click()
  await defaults.getByRole('status').filter({ hasText: 'Defaults saved. No programs were run.' }).waitFor()
  await expect(stat(setupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(cleanupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  const warnings = observation.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(observation, warnings)
  await openTasks(page)
  expect(await defaults.getByRole('textbox', { name: 'Default subdirectory', exact: true }).inputValue()).toBe('tasks')
  expect(await defaults.getByRole('textbox', { name: 'Default starting point', exact: true }).inputValue()).toBe('fixture-base')
  for (const [label, args] of [['Setup program', setupArgs], ['Cleanup program', cleanupArgs]] as const) {
    const group = defaults.getByRole('group', { name: label, exact: true })
    expect(await group.getByRole('textbox', { name: 'Executable', exact: true }).inputValue()).toBe(nodeExecutable)
    for (const [index, argument] of args.entries()) {
      expect(await group.getByRole('textbox', { name: 'Argument ' + String(index + 1), exact: true }).inputValue()).toBe(argument)
    }
  }
  await expect(stat(setupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(cleanupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  await settings.getByRole('button', { name: 'Create worktree', exact: true }).click()
  const create = settings.getByRole('region', { name: 'Create worktree', exact: true })
  await create.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption({ label: 'repository' })
  expect(await create.getByRole('textbox', { name: 'Source repository path', exact: true }).inputValue()).toBe(repository)
  await create.getByRole('textbox', { name: 'Task name', exact: true }).fill(TASK_NAME)
  expect(await create.getByRole('textbox', { name: 'Starting point (optional)', exact: true }).inputValue()).toBe('')
  await create.getByRole('button', { name: 'Create worktree', exact: true }).click()
  await create.waitFor({ state: 'hidden' })
  const task = settings.getByRole('listitem').filter({ has: page.getByRole('heading', { name: TASK_NAME, exact: true }) })
  await task.getByText('Active', { exact: true }).waitFor()
  const checkout = (await detail(task, 'Checkout path').innerText()).trim()
  const branch = (await detail(task, 'Branch').innerText()).trim()
  expect(relative(join(managed, 'tasks'), checkout)).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/)
  expect(await detail(task, 'Starting point (optional)').innerText()).toBe('fixture-base')
  expect((await git(checkout, 'rev-parse', 'HEAD')).trim()).toBe(baseHead)
  const setupReceipt = JSON.stringify({ phase: 'setup', cwd: checkout, argument: LITERAL_ARGUMENT }) + '\n'
  expect(await readFile(setupMarker, 'utf8')).toBe(setupReceipt)
  await expect(stat(cleanupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(join(checkout, 'tracked.txt'), 'reviewed task change\n')
  await writeFile(join(checkout, 'untracked notes.txt'), 'untracked contents stay outside the active review patch\n')
  const dirtyStatus = await git(checkout, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
  const patch = await git(checkout, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', baseHead, '--')
  await task.getByRole('button', { name: 'Review', exact: true }).click()
  const review = settings.getByRole('region', { name: 'Review: ' + TASK_NAME, exact: true })
  await review.getByText('Uncommitted changes', { exact: true }).waitFor()
  expect(await detail(review, 'Captured base commit').innerText()).toBe(baseHead)
  expect(await review.getByLabel('Tracked changes', { exact: true }).textContent()).toBe(patch)
  expect(patch).toContain('-captured baseline\n+reviewed task change')
  expect(await review.getByRole('listitem').allTextContents()).toEqual(['untracked notes.txt'])
  expect(await review.innerText()).not.toContain('untracked contents stay outside the active review patch')
  expect(await detail(review, 'Setup program').innerText()).toBe(JSON.stringify([nodeExecutable, ...setupArgs]))
  expect(await detail(review, 'Cleanup program').innerText()).toBe(JSON.stringify([nodeExecutable, ...cleanupArgs]))
  expect(await detail(review, 'Cleanup receipt').innerText()).toBe('No execution receipt')
  expect(await git(checkout, 'status', '--porcelain=v1', '-z', '--untracked-files=all')).toBe(dirtyStatus)
  expect((await git(checkout, 'rev-parse', 'HEAD')).trim()).toBe(baseHead)
  expect(await readFile(setupMarker, 'utf8')).toBe(setupReceipt)
  await expect(stat(cleanupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  const reviewAria = await captureStableAria(page, 'section[aria-label="Review: ' + TASK_NAME + '"]', root, {
    replacements: [
      // ARIA quotes each JSON program as a YAML string; match both encoding layers.
      [JSON.stringify(JSON.stringify([nodeExecutable, ...setupArgs])), JSON.stringify(JSON.stringify(['{{node}}', '{{hook}}', '{{setupMarker}}', 'setup', LITERAL_ARGUMENT]))],
      [JSON.stringify(JSON.stringify([nodeExecutable, ...cleanupArgs])), JSON.stringify(JSON.stringify(['{{node}}', '{{hook}}', '{{cleanupMarker}}', 'cleanup', LITERAL_ARGUMENT]))],
      [checkout, '{{checkout}}'], [baseHead, '{{baseHead}}'],
    ],
  })
  await task.getByRole('button', { name: 'Hibernate', exact: true }).click()
  await confirm(page, 'Hibernate')
  await task.getByText('Hibernated', { exact: true }).waitFor()
  await expect(stat(checkout)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(setupMarker, 'utf8')).toBe(setupReceipt)
  await expect(stat(cleanupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  await review.getByText('No untracked files.', { exact: true }).waitFor()
  await review.getByRole('button', { name: 'Refresh review', exact: true }).click()
  await review.getByText('No execution receipt', { exact: true }).waitFor()
  await expect(stat(checkout)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(cleanupMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  await task.getByRole('button', { name: 'Archive', exact: true }).click()
  await confirm(page, 'Archive')
  await task.getByText('Archived', { exact: true }).waitFor()
  await review.getByText('Cleanup succeeded. Archive or delete will not run it again.', { exact: true }).waitFor()
  expect(await detail(review, 'Requested operation').innerText()).toBe('Archive')
  const cleanupReceipt = JSON.stringify({ phase: 'cleanup', cwd: checkout, argument: LITERAL_ARGUMENT }) + '\n'
  expect(await readFile(cleanupMarker, 'utf8')).toBe(cleanupReceipt)
  expect(await readFile(setupMarker, 'utf8')).toBe(setupReceipt)
  await expect(stat(checkout)).rejects.toMatchObject({ code: 'ENOENT' })
  await task.getByRole('button', { name: 'Delete', exact: true }).click()
  await confirm(page, 'Delete')
  await settings.getByRole('status').filter({ hasText: 'is not merged. The checkout was reclaimed' }).waitFor()
  await task.getByRole('button', { name: 'Review', exact: true }).click()
  await review.getByText('Cleanup succeeded. Archive or delete will not run it again.', { exact: true }).waitFor()
  expect(await readFile(cleanupMarker, 'utf8')).toBe(cleanupReceipt)
  expect(await git(repository, 'show', 'refs/heads/' + branch + ':tracked.txt')).toBe('reviewed task change\n')
  expect((await git(repository, 'rev-parse', 'HEAD')).trim()).toBe(sourceHead)
  expect(await git(repository, 'status', '--porcelain=v1', '-z')).toBe('')
  expect(observation.pageErrors).toEqual([])
  expect(observation.warnings).toEqual([])
  const mode = webSnapshotMode()
  if (mode === 'refresh') await mkdir(dirname(EXPECTED), { recursive: true })
  await compareOrRefreshGolden(EXPECTED, reviewAria, mode)
}, 180_000)
