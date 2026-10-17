/** Fetch pinned upstream source files without installing or launching Orca. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const commit = 'b4d5b7de7afef23f1868153f0e6918f3c56ed595'
const destination = resolve(root, 'samples/.cache/upstream')
const list = process.argv[2]
if (!list) throw new Error('usage: node orca-migration/scripts/fetch-reference.mjs <path-list>')
const paths = [...new Set((await readFile(resolve(list), 'utf8')).split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
let cursor = 0
const failures = []
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < paths.length) {
    const path = paths[cursor++]
    const target = resolve(destination, path)
    if (!target.startsWith(destination + sep)) throw new Error(`path outside sample root: ${path}`)
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/stablyai/orca/${commit}/${path}`, { signal: AbortSignal.timeout(30000) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.text()
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, body)
        failure = undefined
        break
      } catch (error) {
        failure = `${path}: ${String(error)}`
      }
    }
    if (failure) failures.push(failure)
  }
}))
console.log(`reference fetch: ${paths.length - failures.length}/${paths.length} files at ${commit}`)
for (const failure of failures) console.error(failure)
if (failures.length) process.exitCode = 1
