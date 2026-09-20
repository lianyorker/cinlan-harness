/** Real phone answers and approvals through official tools, the Agent loop, and paired Gateway events. */
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ReplayEntry, ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { PairingInvitation, RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'
import { createPairedAssetHandler } from '../../desktop-host/src/phone-assets.ts'
import { installDesktopRemoteAccessHost } from '../../desktop-host/src/remote-access.ts'
import { installDesktopUpdateTaskControl } from '../../desktop-host/src/update-tasks.ts'
import { launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold } from '../../web/tests/scaffold.ts'

function toolCall(id: string, name: string, args: Record<string, unknown>): ReplayEntry {
  const callId = ToolCallId(id)
  const input = JSON.stringify(args)
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: input },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: input } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 32 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] }
}

function answer(text: string): ReplayEntry {
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
}

it('answers a real tool question and approves a confined write from a paired phone', async () => {
  if (webSnapshotMode() === 'record') throw new Error('Phone interaction acceptance requires keyless replay')
  const root = await mkdtemp(join(tmpdir(), 'dsh-phone-interactions-'))
  let host: WebScaffold | undefined = undefined
  let browser: Browser | undefined = undefined
  onTestFinished(async () => {
    try { await browser?.close() } finally {
      try { await host?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  const repository = fileURLToPath(new URL('../../../', import.meta.url))
  const certRoot = join(repository, 'packages/remote-access/remote-access/tests/fixtures')
  const overlay = join(root, 'phone.patch.yml')
  await writeFile(overlay, '- ' + JSON.stringify({ id: 'remote-access', config: {
    enabled: false, host: '127.0.0.1', port: 0, advertisedOrigin: 'https://127.0.0.1:0',
    tlsCertificatePath: join(certRoot, 'localhost-cert.pem'), tlsPrivateKeyPath: join(certRoot, 'localhost-key.pem'),
  } }))
  const replayOverride = join(root, 'replay.override.json')
  const fileText = 'This temporary file was approved from the paired phone.' + String.fromCharCode(10)
  const writeArgs = { file_path: 'phone-approved.txt', content: fileText }
  const questionDone = 'The phone answer was received by the original Agent.'
  const approvalDone = 'The approved write completed in the original Session.'
  const replay: ReplayOverrideDoc = [
    toolCall('phone-question', 'ask_user_question', { questions: [{ id: 'color', question: 'Which color should the phone use?',
      options: [{ label: 'Blue' }, { label: 'Green' }], multi_select: true }] }),
    answer(questionDone),
    toolCall('phone-write-denied', 'write', writeArgs),
    toolCall('phone-write-approved', 'write', { ...writeArgs, sandbox_permissions: 'workspace-write',
      justification: 'Create the requested temporary phone approval fixture inside this Session workspace.' }),
    answer(approvalDone),
  ]
  await writeFile(replayOverride, JSON.stringify(replay))
  host = await launchWebScaffold({ extraOverlayPath: overlay, toolsMode: 'native',
    replayFixture: join(root, 'override-only.jsonl'), replayOverride, compareReplaySession: false })
  const ctx = host.ctx
  installDesktopRemoteAccessHost(ctx, installDesktopUpdateTaskControl(ctx),
    createPairedAssetHandler(ctx.clientModules, join(repository, 'apps/desktop-host')))
  await ctx.loader.await()
  const sessionId = SessionId('paired-phone-interactions')
  await ctx.sessionController.create({ sessionId, cwd: host.workspaceCwd })
  ctx.permissionPresets.set(ctx.sessions.get(sessionId)!, 'read-only')
  const call = (method: string, args: Record<string, unknown> = {}) => ctx.typertGateway.invoke({
    namespace: 'pairing', method, args, access: ctx.connection.trustedAccess,
  })
  const status = await call('enable') as RemoteAccessStatus
  expect(status.state).toBe('ready')
  const invite = await call('createInvitation', { request: { sessionIds: [sessionId],
    scopes: ['session:read', 'session:send', 'questions:answer', 'approvals:decide'] } }) as PairingInvitation
  const certificate = new X509Certificate(await readFile(join(certRoot, 'localhost-cert.pem')))
  const pin = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  browser = await chromium.launch({ args: ['--ignore-certificate-errors-spki-list=' + pin] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(status.origin! + '/pair')
  await page.locator('#invitation').fill(invite.invitationId)
  await page.locator('#code').fill(invite.code)
  await page.locator('#name').fill('Phone interaction acceptance')
  await page.locator('#submit').click()
  await page.getByRole('combobox', { name: 'Authorized sessions' }).selectOption(sessionId)
  const evidence = join(repository, '.artifacts/native-migration')
  await mkdir(evidence, { recursive: true })
  const input = page.locator('[data-composer-input]').first()
  const questionSettled = host.whenTurnSettled()
  await input.fill('Ask me which color the phone should use.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const question = page.locator('[data-question-key]')
  await question.waitFor()
  await question.getByRole('checkbox', { name: 'Blue', exact: true }).click()
  await question.getByRole('textbox').fill('Keep the selected answer in this Session.')
  for (const width of [320, 640, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => question.evaluate((card) => {
      const bounds = card.getBoundingClientRect()
      return [...card.querySelectorAll('footer button')].every((button) => {
        const rect = button.getBoundingClientRect()
        return rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right
          && rect.left >= 0 && rect.right <= innerWidth && rect.top >= bounds.top && rect.bottom <= bounds.bottom
          && rect.bottom <= innerHeight
      })
    })).toBe(true)
  }
  await page.screenshot({ path: join(evidence, 'stage4-phone-question.png') })
  await question.getByRole('button', { name: 'Submit', exact: true }).tap()
  expect(await questionSettled).toBe(sessionId)
  await page.getByText(questionDone, { exact: true }).waitFor()
  const questionEvents = await readPersistedEvents(host, sessionId)
  const result = questionEvents.filter(event => event.type === 'tool/result').flatMap(event => event.data.message.content)
    .find(block => block.type === 'tool-result' && block.toolCallId === ToolCallId('phone-question'))
  expect(JSON.stringify(result)).toContain('Blue')
  expect(JSON.stringify(result)).toContain('Keep the selected answer in this Session.')
  expect(await question.count()).toBe(0)
  const approvalSettled = host.whenTurnSettled()
  await input.fill('Create the temporary phone-approved.txt file, asking for approval if needed.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const approval = page.locator('[data-approval-key]')
  await approval.waitFor()
  expect(existsSync(join(host.workspaceCwd, 'phone-approved.txt'))).toBe(false)
  await page.screenshot({ path: join(evidence, 'stage4-phone-approval.png') })
  await approval.getByRole('button', { name: 'Allow once', exact: true }).click()
  expect(await approvalSettled).toBe(sessionId)
  await page.getByText(approvalDone, { exact: true }).waitFor()
  expect(await readFile(join(host.workspaceCwd, 'phone-approved.txt'), 'utf8')).toBe(fileText)
  const events = await readPersistedEvents(host, sessionId)
  expect(JSON.stringify(events.filter(event => event.type === 'approval/decided'))).toContain('allowed-once')
  expect(JSON.stringify(events.filter(event => event.type === 'tool/result'))).toContain('[sandbox:')
  expect(await approval.count()).toBe(0)
  expect(errors).toEqual([])
  await page.reload()
  await page.getByRole('combobox', { name: 'Authorized sessions' }).selectOption(sessionId)
  await page.getByText(approvalDone, { exact: true }).waitFor()
  await page.screenshot({ path: join(evidence, 'stage4-phone-interactions-complete.png') })
  await writeFile(join(evidence, 'stage4-phone-interactions.json'), JSON.stringify({ sessionId,
    questionAnswered: true, answerPersisted: true, approvalAllowedOnce: true, approvedFileWritten: true, reload: true, errors,
  }, null, 2) + String.fromCharCode(10))
  await call('disable')
}, 180_000)
