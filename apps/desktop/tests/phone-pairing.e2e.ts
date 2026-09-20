/** Built paired-phone UI over real TLS, Gateway authorization, Session persistence, and Desktop asset admission. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, X509Certificate } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type { PairingInvitation, RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'
import { createPairedAssetHandler } from '../../desktop-host/src/phone-assets.ts'
import { installDesktopRemoteAccessHost } from '../../desktop-host/src/remote-access.ts'
import { installDesktopUpdateTaskControl } from '../../desktop-host/src/update-tasks.ts'
import { launchWebScaffold, readPersistedEvents, webSnapshotMode, type WebScaffold } from '../../web/tests/scaffold.ts'

it('pairs a phone viewport to only its granted real Session and revokes the live carrier', async () => {
  if (webSnapshotMode() === 'record') throw new Error('Paired phone acceptance requires the keyless replay mode')
  const root = await mkdtemp(join(tmpdir(), 'dsh-paired-phone-browser-'))
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
  await writeFile(overlay, [
    '- ' + JSON.stringify({ id: 'remote-access', name: '@deepseek-ai/dsh-remote-access', config: {
      enabled: false, host: '127.0.0.1', port: 0, advertisedOrigin: 'https://127.0.0.1:0',
      tlsCertificatePath: join(certRoot, 'localhost-cert.pem'), tlsPrivateKeyPath: join(certRoot, 'localhost-key.pem'),
    } }),
    '- ' + JSON.stringify({ id: 'pairing-controller', name: '@deepseek-ai/dsh-api-pairing-controller' }),
  ].join(String.fromCharCode(10)))
  const prompt = 'Only this real Session is shared with the phone.'
  const reply = 'The paired phone reached the real Agent through HTTPS.'
  const cancelPrompt = 'Keep generating until I stop this turn.'
  const hanging = join(root, 'model-hang-ready')
  const replayOverride = join(root, 'replay.override.json')
  const replay: ReplayOverrideDoc = [{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: reply },
    { type: 'block-end', index: 0, block: { type: 'text', text: reply } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }, { kind: 'hang', readyFile: hanging }]
  await writeFile(replayOverride, JSON.stringify(replay))
  host = await launchWebScaffold({
    replayFixture: join(root, 'override-only.jsonl'), replayOverride, compareReplaySession: false,
    extraOverlayPath: overlay,
    extraInstallAnchors: [join(repository, 'packages/remote-access/remote-access/package.json'),
      join(repository, 'packages/api/pairing-controller/package.json')],
  })
  const ctx = host.ctx
  const control = installDesktopUpdateTaskControl(ctx)
  installDesktopRemoteAccessHost(ctx, control, createPairedAssetHandler(ctx.clientModules, join(repository, 'apps/desktop-host')))
  await ctx.loader.await()
  const shared = SessionId('paired-browser-shared')
  const hidden = SessionId('paired-browser-hidden')
  for (const id of [shared, hidden]) {
    await ctx.sessionController.create({ sessionId: id, cwd: host.workspaceCwd })
  }
  const call = (method: string, args: Record<string, unknown> = {}) => ctx.typertGateway.invoke({
    namespace: 'pairing', method, args, access: ctx.connection.trustedAccess,
  })
  const status = await call('enable') as RemoteAccessStatus
  expect(status.state).toBe('ready')
  const origin = status.origin!
  const invite = await call('createInvitation', { request: { sessionIds: [shared], scopes: ['session:read', 'session:send', 'session:stop'] } }) as PairingInvitation
  const certificate = new X509Certificate(await readFile(join(certRoot, 'localhost-cert.pem')))
  const fixtureSpki = createHash('sha256').update(certificate.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')
  browser = await chromium.launch({ args: ['--ignore-certificate-errors-spki-list=' + fixtureSpki] })
  const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, locale: 'en-US' })
  const page = await browserContext.newPage()
  const evidence = join(repository, '.artifacts/native-migration')
  await mkdir(evidence, { recursive: true })
  const errors: string[] = []
  const failedRequests: string[] = []
  page.on('requestfailed', request => failedRequests.push(new URL(request.url()).pathname + ': ' + String(request.failure()?.errorText)))
  onTestFailed(async () => {
    if (!page.isClosed()) await page.screenshot({ path: join(evidence, 'stage4-phone-failure.png') })
    await writeFile(join(evidence, 'stage4-phone-failure.json'), JSON.stringify({ pathname: new URL(page.url()).pathname, errors, failedRequests }, null, 2))
  })
  const requests: string[] = []
  const websocketUrls: string[] = []
  let revokedSocket: Promise<void> | undefined
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', (request) => { requests.push(new URL(request.url()).pathname) })
  page.on('websocket', (socket) => {
    websocketUrls.push(socket.url())
    revokedSocket = new Promise<void>((resolve) => { socket.on('close', () => { resolve() }) })
  })
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).pathname).toBe('/pair')
  await page.locator('#invitation').fill(invite.invitationId)
  await page.locator('#code').fill(invite.code)
  await page.locator('#name').fill('Phone browser acceptance')
  await page.locator('#submit').click()
  await page.getByRole('combobox', { name: 'Authorized sessions' }).waitFor()
  await expect.poll(() => page.getByRole('combobox').locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toEqual(['', shared])
  await page.getByRole('combobox').selectOption(shared)
  const input = page.locator('[data-composer-input]').first()
  const firstSettled = host.whenTurnSettled()
  await input.fill(prompt)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  expect(await firstSettled).toBe(shared)
  await page.getByText(prompt, { exact: true }).waitFor()
  await page.getByText(reply, { exact: true }).waitFor()
  await page.screenshot({ path: join(evidence, 'stage4-phone-prompt-reply.png') })
  const cancelled = host.whenTurnSettled()
  await input.fill(cancelPrompt)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect.poll(() => existsSync(hanging), { timeout: 15_000 }).toBe(true)
  await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
  expect(await cancelled).toBe(shared)
  const completedEvents = await readPersistedEvents(host, shared)
  expect(completedEvents.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('aborted')
  const userMessages = completedEvents.filter(event => event.type === 'user/message')
  for (const text of [prompt, cancelPrompt]) {
    expect(userMessages.filter(event => event.data.content.some(part => part.type === 'text' && part.text === text))).toHaveLength(1)
  }
  expect(JSON.stringify(completedEvents.filter(event => event.type === 'assistant/message'))).toContain(reply)
  await expect.poll(() => page.locator('[data-streaming="true"]').count()).toBe(0)
  expect(ctx.sessions.get(hidden)!.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
  expect(requests.filter(path => path.includes('/settings/') || path.includes('/pluginManager/'))).toEqual([])
  expect(websocketUrls.every(url => new URL(url).protocol === 'wss:' && new URL(url).searchParams.get('pairingVersion') === '1')).toBe(true)
  expect(websocketUrls.length).toBeGreaterThan(0)
  await page.screenshot({ path: join(evidence, 'stage4-phone-paired-session.png') })
  const refused = await page.evaluate(async () => {
    const response = await fetch('/api/settings/describe', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-pairing-version': '1' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'paired-forbidden-settings', method: 'settings/describe', payload: { args: {} } }),
    })
    return { status: response.status, text: await response.text() }
  })
  expect(refused.text).not.toContain('namespaces')
  expect(refused.status).toBe(200)
  expect(JSON.parse(refused.text) as unknown).toMatchObject({ result: { ok: false } })
  const persisted = await readPersistedEvents(host, shared)
  expect(persisted.some(event => event.type === 'user/message')).toBe(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox', { name: 'Authorized sessions' }).waitFor()
  await page.getByRole('combobox').selectOption(shared)
  await page.getByText('Only this real Session is shared with the phone.', { exact: true }).waitFor()
  const devices = (await call('describe') as RemoteAccessStatus).devices
  expect(devices).toHaveLength(1)
  const closing = revokedSocket
  await call('revokeDevice', { request: { deviceId: devices[0]!.deviceId } })
  await closing
  const revoked = await page.evaluate(async () => (await fetch('/pair/session')).status)
  expect(revoked).toBe(401)
  await page.reload({ waitUntil: 'domcontentloaded' })
  expect(new URL(page.url()).pathname).toBe('/pair')
  expect(await page.getByRole('combobox').count()).toBe(0)
  expect(errors).toEqual([])
  await writeFile(join(evidence, 'stage4-phone-browser-acceptance.json'), JSON.stringify({
    viewport: { width: 390, height: 844 }, protocol: 'HTTPS/WSS', sharedSession: shared,
    excludedSession: hidden, prompted: true, modelReplyVisible: true, cancelled: true, revoked: true, settingsDenied: true, errors,
  }, null, 2) + String.fromCharCode(10))
  await call('disable')
  const credentials = await readFile(join(host.harnessHome, '.credentials.yaml'), 'utf8')
  expect(credentials).not.toContain(invite.code)
}, 180_000)
