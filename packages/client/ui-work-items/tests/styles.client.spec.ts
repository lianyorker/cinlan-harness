import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('resolves every Work Items design token through the shared theme', () => {
  const styles = readFileSync(new URL('../src/client/WorkItemsSection.module.css', import.meta.url), 'utf8')
  const root = fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url))
  const theme = readdirSync(root).filter(file => file.endsWith('.css')).map(file => readFileSync(join(root, file), 'utf8')).join('\n')
  const declared = new Set([...theme.matchAll(/(--dsw-[\w-]+)\s*:/g)].map(match => match[1]))
  const consumed = [...new Set(styles.match(/--dsw-[\w-]+/g))]
  expect(consumed.filter(token => !declared.has(token))).toEqual([])
})
