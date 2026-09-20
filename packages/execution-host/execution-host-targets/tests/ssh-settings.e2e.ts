/** Chromium Settings saves and connects through authenticated Remote and real isolated OpenSSH. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createHarness } from './harness.ts'
import { launchWebScaffold } from '../../../../apps/web/tests/scaffold.ts'
import { newEnglishPage, waitForApplicationFrame } from '../../../../apps/web/tests/support.ts'

it('saves, connects, inspects, disconnects and deletes an SSH target from real browser Settings', async () => {
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
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Execution hosts', exact: true }).click()
    await page.getByRole('button', { name: 'Add host', exact: true }).click()
    await page.getByLabel('Host label', { exact: true }).fill('Loopback protocol acceptance')
    await page.getByLabel('SSH alias', { exact: true }).fill(worker.alias)
    await page.getByRole('button', { name: 'Save host', exact: true }).click()
    await page.getByText('Host saved.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByText('Ready · root inspected', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Inspect directory', exact: true }).click()
    await page.getByText('browser-ssh.txt', { exact: true }).waitFor()
    expect(worker.commands).toEqual(['dsh --profile execution-host'])
    expect(worker.authentication).toContain('publickey:worker:true:true')
    const screenshot = fileURLToPath(new URL('../../../../.artifacts/native-migration/stage4-ssh-settings.png', import.meta.url))
    await mkdir(join(screenshot, '..'), { recursive: true })
    await page.screenshot({ path: screenshot, fullPage: true })
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await page.getByText('Host disconnected.', { exact: true }).waitFor()
    await worker.exited
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete host', exact: true }).click()
    await page.getByText('No SSH execution hosts have been saved.', { exact: true }).waitFor()
    for (const method of ['create', 'connect', 'inspectDirectory', 'disconnect', 'removeTarget']) expect(remoteMethods).toContain(method)
    expect(await readFile(join(worker.directory, 'browser-ssh.txt'), 'utf8')).toBe('browser-ssh')
    const output = fileURLToPath(new URL('../../../../.artifacts/native-migration/stage4-ssh-browser-evidence.json', import.meta.url))
    await writeFile(output, JSON.stringify({
      testedAt: new Date().toISOString(), platform: process.platform, status: 'passed',
      endpoint: 'isolated loopback ssh2.Server', transport: 'system OpenSSH with temporary P-256 credentials and strict host-key trust',
      actualBrowser: 'Chromium', remoteMethods: [...new Set(remoteMethods)],
      executedSshCommands: worker.commands, directoryEntry: 'browser-ssh.txt',
      cancellation: 'separate real Remote SSH integration test', externalRemoteHost: false,
      remoteAgentExecution: false, note: 'Management path only; no POSIX endpoint or Session authority migration asserted.',
    }, null, 2) + '\n')
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 180_000)
