/** Inspect the security settings page without disclosing the authenticated URL. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '../../apps/web/node_modules/playwright/index.mjs'

const log = await readFile(join(process.env.TEMP, 'cinlan-ui-repair-web.out.log'), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+/u)?.[0]
if (!url) throw new Error('Authenticated startup URL missing')
const review = process.argv.includes('--review')
const browser = review
  ? await chromium.connectOverCDP('http://127.0.0.1:9222')
  : await chromium.launch()
try {
  const page = review
    ? (browser.contexts()[0].pages()[0] ?? await browser.contexts()[0].newPage())
    : await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
  if (review) await page.bringToFront()
  await page.setViewportSize({ width: 1440, height: 852 })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const nav = page.getByRole('navigation', { name: '设置导航', exact: true })
  await nav.waitFor()
  const entries = await nav.getByRole('button').allTextContents()
  const security = nav.getByRole('button', { name: '逆向分析', exact: true })
  if (await security.count()) {
    await security.click()
    await page.getByRole('heading', { name: '逆向分析', level: 1, exact: true }).waitFor()
    await page.locator('[data-capability="rea"][aria-busy="false"]').waitFor({ timeout: 60_000 })
  }
  const settings = page.getByRole('region', { name: '设置', exact: true })
  const measure = () => page.locator('[data-capability="rea"]').evaluate(element => {
    const styles = getComputedStyle(element)
    const list = element.querySelector('ul')
    const button = element.querySelector('button')
    const rect = element.getBoundingClientRect()
    const card = element.querySelector('[class*="card"]').getBoundingClientRect()
    const control = button.getBoundingClientRect()
    return { x: rect.x, width: rect.width, height: rect.height, overflow: element.scrollWidth > element.clientWidth,
      font: styles.fontFamily, lineHeight: styles.lineHeight, color: styles.color,
      columns: list ? getComputedStyle(list).gridTemplateColumns : null,
      card: { x: card.x, y: card.y, width: card.width, height: card.height },
      control: { width: control.width, height: control.height },
      summaries: [...element.querySelectorAll('summary')].map(node => ({ text: node.textContent, open: node.parentElement.open })),
    }
  })
  const result = { entries, text: await settings.innerText(), errors, wide: await measure() }
  const contrasts = () => page.locator('[data-capability="rea"]').evaluate(element => {
    const rgba = value => (value.match(/[\d.]+/gu) ?? []).map(Number)
    const background = node => {
      let base = [255, 255, 255]
      for (const ancestor of [node, ...function* () { for (let parent = node.parentElement; parent; parent = parent.parentElement) yield parent }()].reverse()) {
        const color = rgba(getComputedStyle(ancestor).backgroundColor)
        const alpha = color[3] ?? 1
        base = base.map((channel, index) => color[index] * alpha + channel * (1 - alpha))
      }
      return base
    }
    const luminance = channels => channels.map(channel => channel / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
    return [...element.querySelectorAll('p, dt, summary, [data-tone], li > span')].map(node => {
      const bg = background(node)
      const fg = rgba(getComputedStyle(node).color)
      const alpha = fg[3] ?? 1
      const front = luminance(bg.map((channel, index) => fg[index] * alpha + channel * (1 - alpha)))
      const back = luminance(bg)
      return { text: node.textContent, ratio: (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05) }
    })
  })
  result.lightContrast = await contrasts()
  await page.screenshot({ path: 'reports/security-settings-latest.png' })
  if (!review) {
    const runtime = page.getByText('运行时与数据目录', { exact: true })
    await runtime.focus()
    await page.keyboard.press('Enter')
    result.runtimeExpanded = await runtime.evaluate(node => node.parentElement.open)
    await runtime.press('Enter')
    const tools = page.locator('#rea-tools > summary')
    await tools.focus()
    await page.keyboard.press('Enter')
    result.toolsExpanded = await tools.evaluate(node => node.parentElement.open)
    const details = page.getByText('检测详情', { exact: true })
    await details.focus()
    await page.keyboard.press('Enter')
    result.diagnosticsExpanded = await details.evaluate(node => node.parentElement.open)
    await page.screenshot({ path: 'reports/rea-settings-diagnostics.png' })
    await details.press('Enter')
    await tools.press('Enter')
    await page.emulateMedia({ colorScheme: 'dark' })
    result.darkContrast = await contrasts()
    await page.screenshot({ path: 'reports/rea-settings-dark.png' })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 390, height: 844 })
    result.narrow = await measure()
    result.narrowPageOverflow = await settings.evaluate(element => element.scrollWidth > element.clientWidth)
    await page.screenshot({ path: 'reports/rea-settings-narrow.png' })
    await page.setViewportSize({ width: 1440, height: 852 })
    await nav.getByRole('button', { name: 'Agent 预设', exact: true }).click()
    const card = page.locator('[data-agent-preset-id="security-research"]')
    await card.getByRole('button', { name: '查看配置: 安全研究', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    result.presetReadOnly = { viewer: await dialog.locator('pre').count(), editors: await dialog.locator('textarea, input, [contenteditable="true"]').count() }
    await page.keyboard.press('Escape')
    await security.click()
    await page.locator('[data-capability="rea"][aria-busy="false"]').waitFor({ timeout: 60_000 })
  }
  const rechecked = page.locator('[data-capability="rea"]').evaluate(element => new Promise(resolve => {
    let loadingSeen = false
    const observer = new MutationObserver(() => {
      const loading = element.getAttribute('aria-busy') === 'true'
      loadingSeen ||= loading
      if (loadingSeen && !loading) { observer.disconnect(); resolve(true) }
    })
    observer.observe(element, { attributes: true, attributeFilter: ['aria-busy'] })
    element.querySelector('button').click()
  }))
  result.rechecked = await rechecked
  await writeFile(review ? 'reports/rea-settings-review.json' : 'reports/security-settings-latest.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  if (errors.length || result.wide.overflow || result.narrow?.overflow || result.narrowPageOverflow || result.diagnosticsExpanded === false
    || result.runtimeExpanded === false || result.toolsExpanded === false
    || [...result.lightContrast, ...result.darkContrast ?? []].some(value => value.ratio < 4.5)) {
    throw new Error('Settings browser verification failed')
  }
} finally {
  await browser.close()
}
