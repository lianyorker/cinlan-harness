/** Chromium Settings saves, connects, disconnects and deletes through authenticated Remote and real isolated OpenSSH. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createHarness } from './harness.ts'
import { launchWebScaffold } from '../../../../apps/web/tests/scaffold.ts'
import { newEnglishPage, openSettings, waitForApplicationFrame } from '../../../../apps/web/tests/support.ts'

it('saves, connects, disconnects and deletes an SSH target from real browser Settings', async () => {
  const ssh = await createHarness()
  const worker = await ssh.worker('browser-ssh', { process: true })
  const overlay = join(ssh.root, 'targets.patch.yml')
  await writeFile(overlay, JSON.stringify([{ id: 'execution-host-targets', config: {
    sshExecutable: 'ssh', sshConfigFile: ssh.configPath,
  } }]))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(ssh.root, 'home') })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    const remoteMethods: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/executionHosts/')) remoteMethods.push(path.slice('/api/executionHosts/'.length))
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
    await openSettings(page, 'en')
    await page.getByRole('button', { name: 'SSH hosts', exact: true }).click()
    await page.getByRole('heading', { name: 'SSH remote hosts', exact: true }).waitFor()
    const targets = page.locator('[data-settings-anchor="hosts"]')
    await targets.getByText('No SSH targets configured.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add target', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Add SSH host', exact: true })
    await form.getByLabel('Label', { exact: true }).fill('Loopback protocol acceptance')
    await form.getByLabel('Host or alias *', { exact: true }).fill(worker.alias)
    // The saved record's port refines the alias, so the form must state the port
    // this fixture actually listens on.
    await form.getByLabel('Port', { exact: true }).fill(String(worker.port))
    await form.getByRole('button', { name: 'Add Target', exact: true }).click()
    await page.getByText('Target saved.', { exact: true }).waitFor()
    const card = page.locator('[aria-label="Loopback protocol acceptance"]')
    await card.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByText('Connected · root inspected', { exact: true }).waitFor({ timeout: 60_000 })
    expect(worker.commands).toEqual(['dsh --profile execution-host'])
    expect(worker.authentication).toContain('publickey:worker:true:true')
    const screenshot = fileURLToPath(new URL('../../../../.artifacts/native-migration/stage4-ssh-settings.png', import.meta.url))
    await mkdir(join(screenshot, '..'), { recursive: true })
    await page.screenshot({ path: screenshot, fullPage: true })
    await card.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await page.getByText('Target disconnected.', { exact: true }).waitFor()
    await worker.exited
    await card.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog', { name: 'Delete target?', exact: true })
      .getByRole('button', { name: 'Delete target', exact: true }).click()
    await targets.getByText('No SSH targets configured.', { exact: true }).waitFor()
    for (const method of ['create', 'connect', 'disconnect', 'removeTarget']) expect(remoteMethods).toContain(method)
    const output = fileURLToPath(new URL('../../../../.artifacts/native-migration/stage4-ssh-browser-evidence.json', import.meta.url))
    await writeFile(output, JSON.stringify({
      testedAt: new Date().toISOString(), platform: process.platform, status: 'passed',
      endpoint: 'isolated loopback ssh2.Server', transport: 'system OpenSSH with temporary P-256 credentials and strict host-key trust',
      actualBrowser: 'Chromium', remoteMethods: [...new Set(remoteMethods)],
      executedSshCommands: worker.commands,
      cancellation: 'separate real Remote SSH integration test', externalRemoteHost: false,
      remoteAgentExecution: false, note: 'Management path only; no POSIX endpoint or Session authority migration asserted.',
    }, null, 2) + '\n')
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 180_000)
