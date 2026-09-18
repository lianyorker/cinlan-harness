/**
 * Opt-in settings check through start:desktop or --packaged <executable>; requires a desktop session.
 * Add --existing-profile <absolute detached profile snapshot> to prove replacement of stale same-version packages.
 * Add --close-during-startup with --packaged to exercise Exit during installation and verify transaction cleanup.
 * The fixture must contain only the default managed profile, with no symlinks, junctions, patches, or extra bundles;
 * only its runtime is copied into the isolated test home, and its source is never launched or modified.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '../../..')
const pnpm = join(root, 'apps/desktop/node_modules/pnpm/bin/pnpm.mjs')
const { values } = parseArgs({ options: {
  packaged: { type: 'string' }, 'existing-profile': { type: 'string' }, 'close-during-startup': { type: 'boolean', default: false },
  'fail-profile': { type: 'boolean', default: false },
}, allowPositionals: false })
const packaged = values.packaged
const existingProfile = values['existing-profile']
const closeDuringStartup = values['close-during-startup']
const failProfile = values['fail-profile']
if (closeDuringStartup) assert.ok(packaged !== undefined, '--close-during-startup requires --packaged')
if (failProfile) {
  assert.ok(packaged !== undefined, '--fail-profile requires --packaged')
  assert.ok(existingProfile === undefined && !closeDuringStartup, '--fail-profile cannot be combined with other fixture modes')
}
if (packaged !== undefined) assert.ok(isAbsolute(packaged), '--packaged requires an absolute executable path')
if (existingProfile !== undefined) {
  assert.ok(packaged !== undefined, '--existing-profile requires --packaged')
  assert.ok(isAbsolute(existingProfile), '--existing-profile requires an absolute detached profile path')
}
// The Web test owner supplies the existing browser driver; this check starts no browser binary.
const { chromium } = createRequire(new URL('../../web/package.json', import.meta.url))('playwright')
// The shell page appears before offline installation; these budgets cover application readiness.
// A detached profile replacement also materializes the copied profile before rebuilding the target.
const startupTimeout = packaged === undefined
  ? 120_000
  : existingProfile === undefined ? 300_000 : 600_000

async function until(observe, label, timeout = 30_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await observe()
    if (value) return value
    await delay(100)
  }
  throw new Error('Timed out waiting for ' + label)
}

async function readWhenPresent(path) {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

async function evaluateMain(url, expression) {
  const socket = new WebSocket(url)
  try {
    await once(socket, 'open', { signal: AbortSignal.timeout(10_000) })
    const response = once(socket, 'message', { signal: AbortSignal.timeout(10_000) })
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    const [event] = await response
    const message = JSON.parse(event.data)
    assert.equal(message.id, 1)
    assert.equal(message.error, undefined)
    assert.equal(message.result.exceptionDetails, undefined)
    return message.result.result.value
  } finally {
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(10_000) })
    socket.close()
    await closed
  }
}

function isShutdownStreamUnavailable(entry, report) {
  return report.beforeQuitAt !== undefined
    && report.cleanup.exit?.code === 0 && report.cleanup.exit.signal === null && report.forcedTermination !== true
    && entry.phase === 'shutdown'
    && entry.message === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
    && entry.location.url === 'dsh-app://app/.dsh/remote-stream'
    && report.networkResponses.some(response => response.phase === 'shutdown' && response.status === 503
      && response.request.phase === 'shutdown' && response.request.time >= report.beforeQuitAt
      && response.request.startTime >= Date.parse(report.beforeQuitAt)
      && response.time <= entry.time && response.request.url === entry.location.url
      && response.request.method === 'POST' && response.request.resourceType === 'fetch')
}

async function portClosed(port) {
  return await new Promise((resolvePort, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolvePort(false) })
    socket.once('error', error => {
      if (error.code === 'ECONNREFUSED') resolvePort(true)
      else reject(error)
    })
  })
}

async function removeDevelopmentRoot(path) {
  // Project dependencies are junctions on Windows; unlink each before removing real directories.
  async function unlinkDependencies(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name)
      if (entry.isSymbolicLink()) await unlink(child)
      else if (entry.isDirectory()) await unlinkDependencies(child)
    }
  }
  await unlinkDependencies(path)
  await rm(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}

const settingsPackage = '@deepseek-ai/dsh-client-ui-settings-general'
const settingsBundle = join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')
const managedProfileEntries = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'desktop-release.json', 'desktop-packages.json', 'desktop-packages', 'node_modules']
const initialSettings = 'locale:\n  preference: zh\nui-onboarding:\n  welcomeNoticeVersion: "2026-08-13.1"\n'
const invalidReleaseFixture = 'BAD_JSON!\n'
const sharedSessionSentinel = 'isolated desktop same-version upgrade: retain shared session-directory bytes\n'
const profileReuseSentinel = 'isolated desktop same-version upgrade: retain the reconciled profile on restart\n'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function fileFingerprint(path) {
  const body = await readFile(path)
  return { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
}

async function profileFingerprint(profile) {
  return {
    release: await readJson(join(profile, 'desktop-release.json')),
    packageSet: await fileFingerprint(join(profile, 'desktop-packages.json')),
    settingsBundle: await fileFingerprint(join(profile, settingsBundle)),
    dshVersion: (await readJson(join(profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))).version,
    hostVersion: (await readJson(join(profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'))).version,
  }
}

async function packagedSettingsFingerprint(directory, descriptor) {
  const record = descriptor.packages.find(candidate => candidate.name === settingsPackage)
  assert.ok(record, 'package set must include the settings UI')
  assert.match(record.file, /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/, 'settings tarball must be a local filename')
  const archive = join(directory, 'desktop-packages', record.file)
  const tarball = await readFile(archive)
  assert.equal(tarball.length, record.bytes)
  assert.equal('sha512-' + createHash('sha512').update(tarball).digest('base64'), record.integrity)
  const { list } = createRequire(new URL('../package.json', import.meta.url))('tar')
  const entries = []
  await list({ file: archive, strict: true, onReadEntry(entry) {
    if (entry.path !== 'package/lib/client.js') return
    const fingerprint = { type: entry.type, bytes: 0, sha256: undefined }
    const hash = createHash('sha256')
    entries.push(fingerprint)
    entry.on('data', chunk => { fingerprint.bytes += chunk.length; hash.update(chunk) })
    entry.on('end', () => { fingerprint.sha256 = hash.digest('hex') })
  } })
  assert.equal(entries.length, 1, 'settings tarball must contain one client bundle')
  assert.ok(entries[0].type === 'File' || entries[0].type === 'OldFile')
  assert.equal(typeof entries[0].sha256, 'string')
  return { bytes: entries[0].bytes, sha256: entries[0].sha256 }
}

async function prepareExistingProfile() {
  const details = await lstat(existingProfile)
  assert.ok(details.isDirectory() && !details.isSymbolicLink(), 'existing profile must be an ordinary detached directory')
  const manifest = await readJson(join(existingProfile, 'package.json'))
  assert.equal(manifest.name, '@deepseek-ai/dsh-desktop-runtime')
  assert.equal(manifest.private, true)
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], 'fixture must have only default bundles')
  for (const entry of await readdir(existingProfile)) {
    assert.ok(managedProfileEntries.includes(entry) || entry === 'desktop.cordis.yml', 'unsupported existing-profile entry: ' + entry)
  }
  const before = await profileFingerprint(existingProfile)
  const seed = process.platform === 'darwin'
    ? join(dirname(packaged), '..', 'Resources', 'seed')
    : join(dirname(packaged), 'resources', 'seed')
  const targetRelease = await readJson(join(seed, 'desktop-release.json'))
  const oldDescriptor = await readJson(join(existingProfile, 'desktop-packages.json'))
  const targetDescriptor = await readJson(join(seed, 'desktop-packages.json'))
  assert.equal(before.release.version, targetRelease.version, 'fixture and package must use the same version')
  assert.equal(before.dshVersion, targetRelease.version)
  assert.equal(before.hostVersion, targetRelease.version)
  assert.notDeepEqual(oldDescriptor, targetDescriptor, 'fixture package content must differ from the new seed')
  const targetSettings = await packagedSettingsFingerprint(seed, targetDescriptor)
  assert.deepEqual(before.settingsBundle, await packagedSettingsFingerprint(existingProfile, oldDescriptor), 'old installed UI must match its old tarball')
  assert.notDeepEqual(before.settingsBundle, targetSettings, 'fixture must exercise a changed settings UI bundle')
  report.existingProfile = { source: existingProfile, before, targetRelease, targetPackageSet: await fileFingerprint(join(seed, 'desktop-packages.json')), targetSettings }
  const destination = join(harnessHome, 'profiles', 'desktop')
  await mkdir(destination, { recursive: true })
  for (const entry of managedProfileEntries) {
    await cp(join(existingProfile, entry), join(destination, entry), {
      recursive: true, force: false, errorOnExist: true,
      filter: async path => {
        const entryDetails = await lstat(path)
        assert.ok(!entryDetails.isSymbolicLink(), 'fixture symlinks or junctions must be materialized before copying: ' + path)
        assert.ok(entryDetails.isFile() || entryDetails.isDirectory(), 'fixture contains an unsupported filesystem entry: ' + path)
        return true
      },
    })
  }
  assert.deepEqual(await profileFingerprint(destination), before)
  assert.deepEqual(await profileFingerprint(existingProfile), before, 'source fixture changed while being copied')
  await mkdir(join(harnessHome, 'sessions'))
  // A root-level marker is ignored by Session discovery and contains no user or credential data.
  await writeFile(join(harnessHome, 'sessions', '.desktop-settings-upgrade-sentinel'), sharedSessionSentinel, { flag: 'wx' })
  report.checks.push('detached old same-version profile copied without links into the isolated home')
}

async function verifyExistingProfileUpgrade() {
  const evidence = report.existingProfile
  const profile = join(harnessHome, 'profiles', 'desktop')
  const after = await profileFingerprint(profile)
  assert.deepEqual(after.release, evidence.targetRelease)
  assert.deepEqual(after.packageSet, evidence.targetPackageSet, 'same-version startup must install the new package set')
  assert.deepEqual(after.settingsBundle, evidence.targetSettings, 'installed settings UI must match the new packaged tarball')
  assert.equal(after.dshVersion, evidence.before.dshVersion)
  assert.equal(after.hostVersion, evidence.before.hostVersion)
  assert.deepEqual(await profileFingerprint(join(harnessHome, 'desktop', 'rollback', 'profile')), evidence.before, 'rollback must preserve the old runtime')
  assert.equal(await readFile(join(harnessHome, 'settings.yaml'), 'utf8'), initialSettings, 'upgrade must preserve the existing shared settings bytes')
  assert.equal(await readFile(join(harnessHome, 'sessions', '.desktop-settings-upgrade-sentinel'), 'utf8'), sharedSessionSentinel)
  evidence.after = after
  evidence.sharedSettingsPreserved = true
  evidence.sharedSessionDirectorySentinelPreserved = true
  await writeFile(join(profile, '.desktop-settings-reuse-sentinel'), profileReuseSentinel, { flag: 'wx' })
  report.checks.push('same-version upgrade replaces stale UI with seed content, retains rollback, and preserves shared settings and session-directory sentinel')
}

await mkdir(join(root, '.artifacts'), { recursive: true })
const artifactDir = await mkdtemp(join(root, '.artifacts', 'desktop-settings-'))
const developmentRoot = await mkdtemp(join(tmpdir(), 'dsh-desktop-settings-'))
const harnessHome = join(developmentRoot, 'home')
const userData = join(developmentRoot, 'electron-user-data')
const logPath = join(artifactDir, 'launch.log')
const report = { command: packaged ?? 'pnpm run start:desktop', artifactDir, developmentRoot, checks: [], startups: [], pageErrors: [], consoleErrors: [], lifecycleConsoleErrors: [], clientRequests: [], phases: [], networkResponses: [], requestFailures: [] }
let phase = 'startup'
const observedAt = () => ({ phase, time: new Date().toISOString() })
const setPhase = value => { phase = value; report.phases.push(observedAt()) }
setPhase('startup')
const requests = new WeakMap()
const pendingResponseBodies = []
const requestDetails = request => ({ url: request.url(), method: request.method(), resourceType: request.resourceType() })
const observedRequest = request => ({
  ...(requests.get(request) ?? { ...requestDetails(request), phase: 'unobserved' }),
  startTime: request.timing().startTime,
})
let child
let exit
let browser
let page
let mainUrl
let rendererPort
let logFile
let failure

async function startDesktop(logPath) {
  setPhase('startup')
  child = undefined
  exit = undefined
  browser = undefined
  page = undefined
  mainUrl = undefined
  rendererPort = undefined
  logFile = undefined
  delete report.beforeQuitAt
  await rm(join(userData, 'DevToolsActivePort'), { force: true })
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/KEY|SECRET|TOKEN|PASSWORD/i.test(name) && !/^DSH_|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$/i.test(name)))
  Object.assign(environment, {
    DSH_HOME: harnessHome,
    DSH_DESKTOP_DIAGNOSTIC_FILE: join(artifactDir, 'startup-error.log'),
    ELECTRON_ENABLE_LOGGING: '1',
  })
  if (packaged === undefined) Object.assign(environment, {
    pnpm_config_verify_deps_before_run: 'false',
    DSH_DESKTOP_DEVELOPMENT_ROOT: developmentRoot,
    DSH_DESKTOP_MAIN_INSPECT_PORT: '0',
    DSH_DESKTOP_RENDERER_DEBUG_PORT: '0',
    DSH_DESKTOP_HOST_INSPECT_PORT: '0',
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
  })
  logFile = await open(logPath, 'wx')
  const launchArguments = packaged === undefined ? [pnpm, 'run', 'start:desktop']
    : ['--inspect=127.0.0.1:0', '--remote-debugging-port=0', `--user-data-dir=${userData}`]
  report.launchArguments = launchArguments
  const launchStarted = performance.now()
  const startup = { launch: report.startups.length + 1, launchedAt: new Date().toISOString(), stages: [] }
  report.startups.push(startup)
  child = spawn(packaged ?? process.execPath, launchArguments, {
    cwd: packaged === undefined ? root : developmentRoot,
    env: environment, stdio: ['ignore', logFile.fd, logFile.fd], detached: process.platform !== 'win32',
  })
  child.once('error', error => { exit = { error: error.message } })
  child.once('exit', (code, signal) => { exit = { code, signal } })
  report.launcherPid = child.pid
  console.log('Desktop settings evidence: ' + artifactDir)
  const debugging = await until(async () => {
    assert.equal(exit, undefined, 'desktop launcher exited before readiness: ' + JSON.stringify(exit))
    const active = await readWhenPresent(join(userData, 'DevToolsActivePort'))
    const log = await readFile(logPath, 'utf8')
    const match = /Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/.exec(log)
    return active && match ? { active, mainUrl: match[1] } : undefined
  }, 'Electron debugger endpoints', startupTimeout)
  mainUrl = debugging.mainUrl
  rendererPort = Number(debugging.active.split('\n')[0])
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + rendererPort, { timeout: startupTimeout })
  page = await until(() => {
    assert.equal(exit, undefined, 'desktop launcher exited before renderer readiness: ' + JSON.stringify(exit))
    return browser.contexts().flatMap(context => context.pages()).find(candidate =>
      candidate.url() === 'dsh-app://shell/startup.html' || candidate.url() === 'dsh-app://app/index.html')
  }, 'visible desktop page', 30_000)
  startup.firstPageObservedAfterMs = Math.round(performance.now() - launchStarted)
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1264, height: 775 })
  page.on('pageerror', error => report.pageErrors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    const entry = { ...observedAt(), message: text, location: message.location() }
    if ((phase === 'reload' || phase === 'shutdown')
      && (text === 'Failed to load resource: net::ERR_FAILED' || text.startsWith('[session-controller] control stream failed: RemoteError: network error\n'))) {
      report.lifecycleConsoleErrors.push(entry)
    } else report.consoleErrors.push(entry)
  })
  page.on('request', request => {
    requests.set(request, { ...observedAt(), ...requestDetails(request) })
    if (request.url().startsWith('dsh-app://app/plugins/')) report.clientRequests.push(request.url())
  })
  page.on('response', response => {
    const entry = { ...observedAt(), request: observedRequest(response.request()), status: response.status(), statusText: response.statusText(), contentType: response.headers()['content-type'] }
    report.networkResponses.push(entry)
    if (response.status() >= 400) {
      pendingResponseBodies.push(response.text().then(
        body => { entry.body = body.slice(0, 4096) },
        error => { entry.bodyError = String(error) },
      ))
    }
  })
  page.on('requestfailed', request => {
    report.requestFailures.push({ ...observedAt(), request: observedRequest(request), failure: request.failure() })
  })
  async function observeStartup() {
    if (page.url() !== 'dsh-app://shell/startup.html') return undefined
    try {
      return await page.evaluate(async () => (await window.dshStartup?.read())?.state)
    } catch (error) {
      if (page.url() === 'dsh-app://app/index.html'
        || (error instanceof Error && error.message.includes('Execution context was destroyed'))) return undefined
      throw error
    }
  }
  const initialStartup = await observeStartup()
  startup.loadingPageObserved = initialStartup !== undefined
  if (initialStartup !== undefined) {
    assert.ok(initialStartup.phase === 'starting' || (failProfile && initialStartup.phase === 'error'),
      'startup must report progress or the requested failure before the application is ready')
    startup.initialState = initialStartup
    const probeStarted = performance.now()
    startup.window = await evaluateMain(mainUrl, '(() => { const {app,BrowserWindow} = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json")("electron"); const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL() === "dsh-app://shell/startup.html"); return window && {pid:process.pid, visible:window.isVisible(), bounds:window.getBounds(), home:process.env.DSH_HOME, userData:app.getPath("userData")} })()')
    startup.mainReplyAfterMs = Math.round(performance.now() - probeStarted)
    if (startup.window !== undefined) {
      assert.equal(startup.window.visible, true, 'the loading page must be in a visible native window')
      assert.equal(startup.window.home, harnessHome)
      assert.equal(startup.window.userData, userData)
      try {
        startup.content = await page.evaluate(() => {
          const read = selector => {
            const element = document.querySelector(selector)
            const rect = element?.getBoundingClientRect()
            const style = element && getComputedStyle(element)
            return { text: element?.textContent.trim(), visible: Boolean(rect?.width && rect.height && style.visibility !== 'hidden' && style.display !== 'none') }
          }
          return { url: location.href, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, heading: read('#startup-title'), status: read('#stage-label'), exit: read('#quit') }
        })
        if (startup.content.url === 'dsh-app://shell/startup.html') {
          assert.ok(startup.content.heading.visible && startup.content.heading.text, 'loading heading must be visibly rendered')
          assert.ok(startup.content.exit.visible && startup.content.exit.text, 'Exit must be visibly rendered')
          if (!failProfile) assert.ok(startup.content.status.visible && startup.content.status.text, 'actual loading status must be visibly rendered')
          await page.screenshot({ path: join(artifactDir, `startup-${startup.launch}.png`), fullPage: true, scale: 'css' })
          await writeFile(join(artifactDir, `startup-${startup.launch}.aria.txt`), await page.locator('body').ariaSnapshot())
        }
      } catch (error) {
        if (page.url() !== 'dsh-app://app/index.html') throw error
        startup.navigatedDuringCapture = true
      }
    }
  }
  if (packaged !== undefined && startup.launch === 1) {
    assert.ok(startup.loadingPageObserved && startup.window?.visible && startup.content?.heading.visible && startup.content.exit.visible
      && (failProfile || startup.content.status.visible),
      'a packaged fresh or replacement install must render its loading page before application readiness')
  }
  if (failProfile) {
    const error = await until(async () => {
      assert.equal(exit, undefined, 'startup failure must remain visible until the user exits')
      assert.notEqual(page.url(), 'dsh-app://app/index.html', 'an invalid profile cannot open the application')
      const state = await observeStartup()
      return state?.phase === 'error' ? state : undefined
    }, 'persistent startup error page', startupTimeout)
    assert.ok(error.message.includes(invalidReleaseFixture.trim()), 'failure must identify the intentionally invalid release bytes')
    assert.equal(error.canRestart, true)
    assert.equal(error.diagnosticFile, join(artifactDir, 'startup-error.log'))
    assert.ok((await readFile(error.diagnosticFile, 'utf8')).includes(error.message))
    await page.locator('#failure').waitFor({ state: 'visible' })
    assert.equal(await page.locator('#restart').isVisible(), true)
    await page.screenshot({ path: join(artifactDir, 'startup-failure.png'), fullPage: true, scale: 'css' })
    startup.failure = error
    await page.locator('#quit').click()
    await until(() => exit, 'exit from startup error page', 30_000)
    assert.deepEqual(exit, { code: 0, signal: null })
    return
  }
  if (closeDuringStartup) {
    const installing = await until(async () => {
      assert.equal(exit, undefined, 'desktop exited before cancellation')
      const state = await observeStartup()
      if (state?.phase === 'error') throw new Error('Desktop startup failed before cancellation: ' + JSON.stringify(state))
      assert.notEqual(page.url(), 'dsh-app://app/index.html', 'installation finished before its cancellation could be exercised')
      const installerPid = Number((await readWhenPresent(join(harnessHome, 'desktop', 'lock')))?.trim())
      return state?.phase === 'starting' && state.stage === 'installing'
        && Number.isSafeInteger(installerPid) && installerPid > 0 && installerPid !== startup.window.pid
        ? { state, installerPid } : undefined
    }, 'live installation owner before closing', startupTimeout)
    startup.cancelledAt = { ...installing, observedAfterMs: Math.round(performance.now() - launchStarted) }
    await page.locator('#quit').click()
    await until(() => exit, 'safe shutdown after startup cancellation', startupTimeout)
    startup.exitedAfterMs = Math.round(performance.now() - launchStarted)
    assert.deepEqual(exit, { code: 0, signal: null })
    assert.throws(() => process.kill(installing.installerPid, 0), { code: 'ESRCH' }, 'the observed installer must exit before Electron finishes')
    startup.installerExited = true
    return
  }
  await until(async () => {
    assert.equal(exit, undefined, 'desktop exited during startup: ' + JSON.stringify(exit))
    if (page.url() === 'dsh-app://app/index.html') return true
    const state = await observeStartup()
    if (state?.phase === 'error') throw new Error('Desktop startup failed: ' + JSON.stringify(state))
    if (state !== undefined && startup.stages.at(-1)?.stage !== state.stage) {
      startup.stages.push({ stage: state.stage, observedAfterMs: Math.round(performance.now() - launchStarted) })
    }
    return false
  }, 'application navigation after startup', startupTimeout)
  startup.applicationObservedAfterMs = Math.round(performance.now() - launchStarted)
  report.main = await evaluateMain(mainUrl, '(() => { const {app} = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json")("electron"); return {pid:process.pid, versions:process.versions, home:process.env.DSH_HOME, userData:app.getPath("userData"), appPath:app.getAppPath(), isPackaged:app.isPackaged, version:app.getVersion(), execPath:process.execPath, resourcesPath:process.resourcesPath, children:process._getActiveHandles().filter(handle => handle.constructor?.name === "ChildProcess").map(handle => ({pid:handle.pid, executable:handle.spawnfile, args:handle.spawnargs}))} })()')
  assert.equal(report.main.home, harnessHome)
  assert.equal(report.main.userData, userData)
  if (packaged !== undefined) {
    const resources = join(dirname(packaged), 'resources')
    const profile = join(harnessHome, 'profiles', 'desktop')
    const json = async path => JSON.parse(await readFile(path, 'utf8'))
    assert.equal(report.main.isPackaged, true)
    assert.equal(report.main.execPath, packaged)
    assert.equal(report.main.appPath, join(resources, 'app.asar'))
    assert.equal(report.main.resourcesPath, resources)
    assert.ok(report.main.children.some(child => child.executable === join(resources, 'runtime', 'node', 'node.exe')
      && child.args[1] === join(profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
      && child.args[2] === profile))
    report.packagedRuntime = {
      runtime: await json(join(resources, 'runtime', 'versions.json')),
      seedRelease: await json(join(resources, 'seed', 'desktop-release.json')),
      installedRelease: await json(join(profile, 'desktop-release.json')),
      dshVersion: (await json(join(profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))).version,
      hostVersion: (await json(join(profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'))).version,
      profileBundles: (await json(join(profile, 'package.json'))).dsh.profile.bundles,
    }
    assert.deepEqual(report.packagedRuntime.installedRelease, report.packagedRuntime.seedRelease)
    assert.equal(report.packagedRuntime.runtime.node, report.packagedRuntime.seedRelease.nodeVersion)
    assert.equal(report.packagedRuntime.runtime.pnpm, report.packagedRuntime.seedRelease.pnpmVersion)
    assert.equal(report.packagedRuntime.dshVersion, report.main.version)
    assert.equal(report.packagedRuntime.hostVersion, report.main.version)
    assert.equal(report.packagedRuntime.seedRelease.version, report.main.version)
    report.checks.push('packaged app.asar uses bundled Node and installed same-release dsh/Host profile from the offline seed')
  }
  report.rendererUrl = page.url()
  report.rendererPort = rendererPort
  report.mainPort = Number(new URL(mainUrl).port)
  report.checks.push('isolated Harness home and Electron browser data verified in the Electron main process')
  setPhase('interaction')
}

async function stopDesktop() {
  setPhase('shutdown')
  try {
    if (mainUrl && !exit) {
      report.beforeQuitAt = await evaluateMain(mainUrl, '(() => { const {app} = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json")("electron"); let beforeQuitAt; app.once("before-quit", () => { beforeQuitAt = new Date().toISOString() }); app.quit(); return beforeQuitAt })()')
    } else if (page && !page.isClosed()) await page.close()
    if (child && !exit) await until(() => exit, 'desktop launcher graceful exit', 30_000)
  } catch (cleanupError) {
    report.cleanupError = String(cleanupError)
    failure ??= cleanupError
  } finally {
    if (child?.pid && !exit) {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit' })
        await once(killer, 'exit')
      } else process.kill(-child.pid, 'SIGKILL')
      await until(() => exit, 'owned process tree exit', 10_000)
      report.forcedTermination = true
    }
    await browser?.close()
    await Promise.all(pendingResponseBodies)
    await logFile?.close()
    if (rendererPort) await until(() => portClosed(rendererPort), 'renderer debug port release')
    if (mainUrl) await until(() => portClosed(Number(new URL(mainUrl).port)), 'main debug port release')
    report.cleanup = { exit, debugPortsClosed: true }
    report.consoleErrors = report.consoleErrors.filter(entry => {
      if (!isShutdownStreamUnavailable(entry, report)) return true
      report.lifecycleConsoleErrors.push({
        ...entry,
        reason: 'Desktop before-quit clears the backend host before awaiting its exit; this remote-stream POST began after before-quit and received 503 during clean shutdown.',
      })
      return false
    })
  }
}

async function runScenario() {
  await mkdir(harnessHome)
  await writeFile(join(harnessHome, 'settings.yaml'), initialSettings, { flag: 'wx' })
  if (existingProfile !== undefined) await prepareExistingProfile()
  if (failProfile) {
    await mkdir(join(harnessHome, 'profiles', 'desktop'), { recursive: true })
    await writeFile(join(harnessHome, 'profiles', 'desktop', 'desktop-release.json'), invalidReleaseFixture, { flag: 'wx' })
  }
  await startDesktop(logPath)
  if (failProfile) {
    assert.equal(await readWhenPresent(join(harnessHome, 'desktop', 'lock')), undefined)
    assert.equal(await readFile(join(harnessHome, 'profiles', 'desktop', 'desktop-release.json'), 'utf8'), invalidReleaseFixture)
    assert.equal(await readFile(join(harnessHome, 'settings.yaml'), 'utf8'), initialSettings)
    report.checks.push('invalid isolated profile leaves a visible error page with persisted diagnostics and restart/exit actions; Exit closes cleanly without changing the fixture')
    report.passed = true
    return
  }
  if (closeDuringStartup) {
    assert.equal(await readWhenPresent(join(harnessHome, 'desktop', 'lock')), undefined, 'cancellation releases the transaction lock')
    assert.equal(await readWhenPresent(join(harnessHome, 'desktop', 'pending.json')), undefined, 'cancellation before activation leaves no journal')
    assert.deepEqual(await readdir(join(harnessHome, 'desktop', 'staging')), [], 'cancellation removes owned staging roots')
    assert.equal(await readFile(join(harnessHome, 'settings.yaml'), 'utf8'), initialSettings)
    if (existingProfile !== undefined) {
      assert.deepEqual(await profileFingerprint(join(harnessHome, 'profiles', 'desktop')), report.existingProfile.before)
    } else {
      assert.equal(await readWhenPresent(join(harnessHome, 'profiles', 'desktop', 'package.json')), undefined)
    }
    report.checks.push('Exit during actual packaged installation waits for worker cleanup, releases the lock, removes staging, and leaves shared settings and the active profile unchanged')
    report.passed = true
    return
  }
  if (existingProfile !== undefined) await verifyExistingProfileUpgrade()
  const credentialStep = page.getByRole('dialog', { name: '添加一个 API Key 开始使用', exact: true })
  await credentialStep.getByRole('button', { name: '稍后配置', exact: true }).click()
  await credentialStep.waitFor({ state: 'hidden' })
  report.checks.push('keyless first-run credential dialog dismissed through Configure later')
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  await trigger.waitFor({ timeout: 120_000 })
  await trigger.click()
  const settings = page.getByRole('region', { name: '设置', exact: true })
  await settings.waitFor()
  await settings.getByRole('button', { name: '中文', exact: true }).waitFor()
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('#root').evaluate(element => element.inert), true)
  await settings.getByRole('button', { name: '返回应用', exact: true }).evaluate(element => {
    if (element !== document.activeElement) throw new Error('Back to app did not receive initial focus')
  })
  const navigation = settings.getByRole('navigation', { name: '设置导航', exact: true })
  report.layout = {
    navigation: await navigation.boundingBox(),
    toolbar: await settings.locator('header').boundingBox(),
    page: await settings.boundingBox(),
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, language: document.documentElement.lang })),
  }
  assert.equal(report.layout.navigation.width, 280)
  assert.ok(report.layout.toolbar.height >= 64 && report.layout.toolbar.height <= 65)
  assert.equal(await settings.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  assert.equal(await settings.getByRole('button', { name: '通用设置', exact: true }).getAttribute('aria-current'), 'page')
  await page.screenshot({ path: join(artifactDir, 'settings-zh.png'), fullPage: true, scale: 'css' })
  await writeFile(join(artifactDir, 'settings-zh.aria.txt'), await settings.ariaSnapshot())
  report.checks.push('Chinese shared settings layout: 280px navigation, 64px toolbar, full viewport, no horizontal overflow')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k')
  const search = settings.getByRole('searchbox', { name: '搜索设置...', exact: true })
  assert.equal(await search.evaluate(element => element === document.activeElement), true)
  await search.fill('外观')
  await settings.getByRole('button', { name: /个人偏好.*外观/ }).click()
  await page.waitForFunction(() => document.activeElement?.closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor') === 'appearance')
  await page.screenshot({ path: join(artifactDir, 'settings-search-focus.png'), fullPage: true, scale: 'css' })
  report.checks.push('Ctrl/Meta+K focuses search; Chinese field search opens and focuses Appearance')
  await settings.getByRole('button', { name: '中文', exact: true }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  const english = page.getByRole('region', { name: 'Settings', exact: true })
  await english.getByRole('button', { name: 'General', exact: true }).waitFor()
  await page.waitForFunction(() => document.documentElement.lang === 'en')
  await page.screenshot({ path: join(artifactDir, 'settings-en.png'), fullPage: true, scale: 'css' })
  await writeFile(join(artifactDir, 'settings-en.aria.txt'), await english.ariaSnapshot())
  await until(async () => /locale:\n\s+preference: en/.test(await readFile(join(harnessHome, 'settings.yaml'), 'utf8')), 'persisted English preference')
  await english.getByRole('searchbox', { name: 'Search settings...', exact: true }).fill('Appearance')
  await english.getByRole('button', { name: /Personal preferences.*Appearance/ }).click()
  await page.waitForFunction(() => document.activeElement?.closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor') === 'appearance')
  report.checks.push('English selected through Language menu, persisted to isolated settings.yaml, and field search focuses Appearance')
  await page.keyboard.press('Escape')
  await english.waitFor({ state: 'hidden' })
  const englishTrigger = page.getByRole('button', { name: 'Settings', exact: true })
  assert.equal(await englishTrigger.evaluate(element => element === document.activeElement), true)
  assert.equal(await page.locator('#root').evaluate(element => element.inert), false)
  await englishTrigger.click()
  await english.getByRole('button', { name: 'Back to app', exact: true }).click()
  await english.waitFor({ state: 'hidden' })
  assert.equal(await englishTrigger.evaluate(element => element === document.activeElement), true)
  setPhase('reload')
  await page.reload({ waitUntil: 'load' })
  const englishCredentialStep = page.getByRole('dialog', { name: 'Add an API key to get started', exact: true })
  await englishCredentialStep.getByRole('button', { name: 'Configure later', exact: true }).click()
  await englishCredentialStep.waitFor({ state: 'hidden' })
  await englishTrigger.waitFor({ timeout: 30_000 })
  await englishTrigger.click()
  await english.getByRole('button', { name: 'English', exact: true }).waitFor()
  setPhase('interaction')
  report.checks.push('Escape and Back close settings and restore trigger focus; reload retains English')
  if (packaged !== undefined) {
    await english.getByRole('button', { name: 'Git & Source Control', exact: true }).click()
    await english.getByRole('combobox', { name: 'Branch Prefix', exact: true }).selectOption('none')
    await until(async () => /branchPrefix: none/.test(await readFile(join(harnessHome, 'settings.yaml'), 'utf8')), 'persisted Git branch prefix')
    await english.getByRole('combobox', { name: 'Source Control Group Order', exact: true }).selectOption('staged-first')
    await until(async () => /sourceControlGroupOrder: staged-first/.test(await readFile(join(harnessHome, 'settings.yaml'), 'utf8')), 'persisted Git group order')
    await page.screenshot({ path: join(artifactDir, 'settings-git.png'), fullPage: true, scale: 'css' })
    await writeFile(join(artifactDir, 'settings-git.aria.txt'), await english.ariaSnapshot())
    report.checks.push('packaged Git settings save branch prefix and source-control group order to the isolated settings file')
    await english.getByRole('button', { name: 'Terminal', exact: true }).click()
    const terminalState = await until(async () => {
      if (await english.getByRole('spinbutton', { name: 'Font size', exact: true }).isVisible()) return 'available'
      if (await english.getByText('Integrated sidebar terminals are unavailable in this application.', { exact: true }).isVisible()) return 'unsupported-scheme'
      if (await english.getByText('The host terminal dependency is unavailable.', { exact: true }).isVisible()) return 'missing-dependencies'
      if (await english.getByText('Terminal availability could not be confirmed.', { exact: true }).isVisible()) return 'probe-failed'
    }, 'packaged terminal capability')
    report.terminal = { state: terminalState }
    if (terminalState === 'available') {
      await english.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('16')
      await english.getByRole('button', { name: 'Save preferences', exact: true }).click()
      await english.getByText('Terminal preferences saved.', { exact: true }).waitFor()
      await until(async () => /terminalFontSize: 16/.test(await readFile(join(harnessHome, 'settings.yaml'), 'utf8')), 'persisted terminal font size')
      report.checks.push('packaged terminal font preference saved through the UI')
    } else {
      assert.equal(await english.getByRole('button', { name: 'Save preferences', exact: true }).count(), 0)
      report.checks.push('packaged Terminal page reports ' + terminalState + ' and exposes no save action')
    }
    await page.screenshot({ path: join(artifactDir, 'settings-terminal.png'), fullPage: true, scale: 'css' })
    await writeFile(join(artifactDir, 'settings-terminal.aria.txt'), await english.ariaSnapshot())
    const persisted = await readFile(join(harnessHome, 'settings.yaml'), 'utf8')
    await writeFile(join(artifactDir, 'settings-before-restart.yaml'), persisted)
    report.initialLaunch = { main: report.main, rendererPort, mainPort: report.mainPort, packagedRuntime: report.packagedRuntime }
    await stopDesktop()
    report.initialLaunch.shutdown = { beforeQuitAt: report.beforeQuitAt, cleanup: report.cleanup }
    assert.equal(failure, undefined)
    assert.equal(exit?.code, 0)
    assert.equal(exit?.signal, null)
    assert.deepEqual(report.pageErrors, [])
    assert.deepEqual(report.consoleErrors, [])
    await startDesktop(join(artifactDir, 'restart.log'))
    if (existingProfile !== undefined) {
      const profile = join(harnessHome, 'profiles', 'desktop')
      assert.deepEqual(await profileFingerprint(profile), report.existingProfile.after)
      assert.equal(await readFile(join(profile, '.desktop-settings-reuse-sentinel'), 'utf8'), profileReuseSentinel, 'identical restart must reuse the reconciled runtime')
      assert.equal(await readFile(join(harnessHome, 'sessions', '.desktop-settings-upgrade-sentinel'), 'utf8'), sharedSessionSentinel)
      report.existingProfile.identicalRestartReused = true
      report.checks.push('identical packaged restart reuses the reconciled profile and retains the session-directory sentinel')
    }
    assert.notEqual(report.main.pid, report.initialLaunch.main.pid)
    const restartedCredentialStep = page.getByRole('dialog', { name: 'Add an API key to get started', exact: true })
    await restartedCredentialStep.getByRole('button', { name: 'Configure later', exact: true }).click()
    await restartedCredentialStep.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const restartedSettings = page.getByRole('region', { name: 'Settings', exact: true })
    await restartedSettings.getByRole('button', { name: 'English', exact: true }).waitFor()
    await restartedSettings.getByRole('searchbox', { name: 'Search settings...', exact: true }).fill('Appearance')
    await restartedSettings.getByRole('button', { name: /Personal preferences.*Appearance/ }).click()
    await page.waitForFunction(() => document.activeElement?.closest('[data-settings-anchor]')?.getAttribute('data-settings-anchor') === 'appearance')
    await page.screenshot({ path: join(artifactDir, 'settings-restart-en.png'), fullPage: true, scale: 'css' })
    await restartedSettings.getByRole('button', { name: 'Git & Source Control', exact: true }).click()
    assert.equal(await restartedSettings.getByRole('combobox', { name: 'Branch Prefix', exact: true }).inputValue(), 'none')
    assert.equal(await restartedSettings.getByRole('combobox', { name: 'Source Control Group Order', exact: true }).inputValue(), 'staged-first')
    await page.screenshot({ path: join(artifactDir, 'settings-restart-git.png'), fullPage: true, scale: 'css' })
    if (terminalState === 'available') {
      await restartedSettings.getByRole('button', { name: 'Terminal', exact: true }).click()
      assert.equal(await restartedSettings.getByRole('spinbutton', { name: 'Font size', exact: true }).inputValue(), '16')
    }
    assert.equal(await readFile(join(harnessHome, 'settings.yaml'), 'utf8'), persisted)
    report.checks.push('full packaged process restart preserves English, settings search, Git preferences, and the complete settings file')
    await restartedSettings.getByRole('button', { name: 'Back to app', exact: true }).click()
    await restartedSettings.waitFor({ state: 'hidden' })
    const disabledPanels = page.getByRole('button', { name: 'Select a conversation to use the sidebar', exact: true })
    assert.equal(await disabledPanels.count(), 2)
    for (const control of await disabledPanels.all()) assert.equal(await control.isDisabled(), true)
    report.terminal.execution = {
      status: 'not-run',
      reason: 'The isolated home has no Workspace or Session. Creating one requires the native Windows directory chooser, which renderer CDP input cannot operate.',
    }
    await page.screenshot({ path: join(artifactDir, 'packaged-main.png'), fullPage: true, scale: 'css' })
    await writeFile(join(artifactDir, 'packaged-main.aria.txt'), await page.locator('body').ariaSnapshot())
  }
  report.clientScripts = await page.evaluate(() => [...document.scripts].map(script => script.src).filter(Boolean))
  report.artifacts = []
  const artifactPaths = packaged === undefined
    ? ['apps/desktop/lib/main.js', 'apps/desktop-host/lib/index.js', 'apps/web/dist/index.html', 'packages/client/ui-settings-general/lib/client.js']
    : [packaged, join(report.main.resourcesPath, 'app.asar'), join(report.main.resourcesPath, 'runtime', 'node', 'node.exe'),
      join(report.main.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'), join(report.main.resourcesPath, 'seed', 'integrity.json'),
      join(harnessHome, 'profiles', 'desktop', 'desktop-release.json'),
      join(harnessHome, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'),
      join(harnessHome, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')]
  for (const path of artifactPaths) {
    const absolute = resolve(root, path)
    report.artifacts.push({ path, modified: (await stat(absolute)).mtime.toISOString(), sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') })
  }
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.consoleErrors, [])
  report.passed = true
}

try {
  await runScenario()
} catch (error) {
  failure = error
  report.passed = false
  report.error = error.stack ?? String(error)
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: join(artifactDir, 'failure.png'), fullPage: true, scale: 'css' }) }
    catch (captureError) { report.captureError = String(captureError) }
  }
} finally {
  await stopDesktop()
  if (report.existingProfile !== undefined) {
    try {
      assert.deepEqual(await profileFingerprint(existingProfile), report.existingProfile.before, 'source fixture must remain unchanged')
      report.existingProfile.sourceUnchanged = true
    } catch (sourceError) {
      report.existingProfile.sourceUnchanged = false
      failure ??= sourceError
      report.sourceError = String(sourceError)
    }
  }
  await removeDevelopmentRoot(developmentRoot)
  report.cleanup.developmentRootRemoved = true
  report.passed = report.passed === true && failure === undefined && exit?.code === 0 && exit?.signal === null
    && report.pageErrors.length === 0 && report.consoleErrors.length === 0
  report.screenshots = (await readdir(artifactDir)).filter(name => name.endsWith('.png')).map(name => join(artifactDir, name))
  await writeFile(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
if (failure) throw failure
assert.deepEqual(report.pageErrors, [])
assert.deepEqual(report.consoleErrors, [])
assert.equal(report.passed, true)
console.log(JSON.stringify({ passed: true, artifactDir, checks: report.checks, cleanup: report.cleanup }, null, 2))
