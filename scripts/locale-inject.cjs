// One-shot merge-repair helper: inject missing locale keys into per-language
// dicts. Reads a JSON spec [{file, inserts: {dictName: {key: text}}}], inserts
// each key line just before the dict's `} satisfies` closer.
const fs = require('fs')
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''))
for (const { file, inserts } of spec) {
  let s = fs.readFileSync(file, 'utf8')
  for (const [dict, rows] of Object.entries(inserts)) {
    const re = new RegExp('export const ' + dict + ' = \\{([\\s\\S]*?)\\} satisfies')
    const m = s.match(re)
    if (!m) { console.log(file, dict, 'NOT FOUND'); continue }
    const existing = new Set([...m[1].matchAll(/^\s*(?:'([^']+)'|(\w+)):/gm)].map(e => e[1] || e[2]))
    const lines = Object.entries(rows)
      .filter(([k]) => !existing.has(k))
      .map(([k, v]) => {
        const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`
        const text = String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
        return `  ${key}: '${text}',`
      })
      .join('\n')
    if (lines) s = s.replace(m[0], `export const ${dict} = {${m[1]}${lines}\n} satisfies`)
  }
  fs.writeFileSync(file, s)
  console.log('patched', file)
}
