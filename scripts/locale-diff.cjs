/* Temporary helper: diff locale dictionary entries between a git ref and HEAD,
 * per-dict (splits on `export const <name> = {`). */
const fs = require('fs')
const cp = require('child_process')

const [ref, file, keyFilter] = process.argv.slice(2)
const dictRx = /^export const (\w+) = \{/
const entryRx = /^\s*'([^']+)':\s*'(.*)',?\s*$/

function parse(text) {
  const dicts = new Map()
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const d = line.match(dictRx)
    if (d !== null) { current = d[1]; dicts.set(current, new Map()); continue }
    if (current === null) continue
    if (line.startsWith('}')) { current = null; continue }
    const m = line.match(entryRx)
    if (m !== null) dicts.get(current).set(m[1], m[2])
  }
  return dicts
}

const canonical = parse(cp.execSync(`git show ${ref}:${file}`, { encoding: 'utf8' }))
const head = parse(fs.readFileSync(file, 'utf8'))
const filter = new RegExp(keyFilter, 'i')
let diffs = 0

for (const [lang, entries] of canonical) {
  const hEntries = head.get(lang)
  for (const [k, v] of entries) {
    if (!filter.test(k)) continue
    const hv = hEntries === undefined ? undefined : hEntries.get(k)
    if (hv === undefined) { console.log(`MISSING ${lang}.${k} = ${v}`); diffs += 1 }
    else if (hv !== v) { console.log(`DIFF ${lang}.${k}\n  C: ${v}\n  H: ${hv}`); diffs += 1 }
  }
}
for (const [lang, entries] of head) {
  const cEntries = canonical.get(lang)
  for (const [k, v] of entries) {
    if (!filter.test(k)) continue
    if (cEntries === undefined || !cEntries.has(k)) {
      console.log(`EXTRA ${lang}.${k} = ${v}`); diffs += 1
    }
  }
}
console.log(`--- ${diffs} diffs | dicts: C ${[...canonical.keys()]}, H ${[...head.keys()]} ---`)
