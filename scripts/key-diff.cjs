// Compare dictionary keys in a locales file: list keys present in the base dict
// but missing from each named sibling dict.
const fs = require('fs')
const [file, base, ...dicts] = process.argv.slice(2)
const src = fs.readFileSync(file, 'utf8')
const dictKeys = (name) => {
  const m = new RegExp(`export const ${name}(?:: [^=]+)? = \\{([\\s\\S]*?)\\n\\}`).exec(src)
  if (!m) return null
  return new Set([...m[1].matchAll(/^\s*'?([A-Za-z]+)'?\s*:/gm)].map(x => x[1]))
}
const baseKeys = [...dictKeys(base)]
for (const d of dicts) {
  const keys = dictKeys(d)
  if (!keys) { console.log(d, 'NOT FOUND'); continue }
  const missing = baseKeys.filter(k => !keys.has(k))
  const extra = [...keys].filter(k => !baseKeys.includes(k))
  console.log(d, 'missing:', missing.join(',') || 'none', '| extra:', extra.join(',') || 'none')
}
