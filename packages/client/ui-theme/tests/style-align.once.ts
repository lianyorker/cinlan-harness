/** One-off: align merged cinlan stylesheets with the theme gates. */
import { readFileSync, writeFileSync } from 'node:fs'
import { packageStylesheets } from './stylesheet-scan.ts'

const FALLBACK = 'var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))'

function isFullRound(value: string): boolean {
  return value.split(/\s+/).some(part =>
    part === '50%' || part === '100%' || (part.endsWith('px') && Number.parseFloat(part) >= 99))
}

function transform(css: string): string {
  const out: string[] = []
  let i = 0
  const n = css.length
  while (i < n) {
    if (/\s/.test(css[i])) { const s = i; while (i < n && /\s/.test(css[i])) i++; out.push(css.slice(s, i)); continue }
    if (css.startsWith('/*', i)) { const st = i; i = css.indexOf('*/', i) + 2; out.push(css.slice(st, Math.min(i, n))); continue }
    if (css[i] === '@') {
      const j = css.indexOf('{', i)
      if (j === -1) { out.push(css.slice(i)); break }
      let depth = 0
      let k = j
      for (; k < n; k++) { if (css[k] === '{') depth++; else if (css[k] === '}') { depth--; if (depth === 0) break } }
      out.push(css.slice(i, k + 1))
      i = k + 1
      continue
    }
    const brace = css.indexOf('{', i)
    if (brace === -1) { out.push(css.slice(i)); break }
    const selector = css.slice(i, brace)
    let depth = 0
    let k = brace
    for (; k < n; k++) { if (css[k] === '{') depth++; else if (css[k] === '}') { depth--; if (depth === 0) break } }
    let body = css.slice(brace + 1, k)
    i = k + 1
    if (selector.includes(':focus')) {
      body = body.replace(/(outline(?:-color)?:\s*[^;\n]*?)var\(--dsw-alias-(?!state-business-primary)[\w-]+\)/g, `$1${FALLBACK}`)
    }
    const radius = body.match(/border-radius:\s*([^;]+);/)
    if (radius && isFullRound(radius[1]) && !body.includes('corner-shape')) {
      body = body.replace(/(border-radius:\s*[^;]+;)/, '$1\n  corner-shape: round;')
    }
    out.push(selector + '{' + body + '}')
  }
  return out.join('')
}

let changed = 0
for (const file of packageStylesheets()) {
  const before = readFileSync(file, 'utf8')
  const after = transform(before)
  let depth = 0
  for (const ch of after) { if (ch === '{') depth++; else if (ch === '}') depth-- }
  if (depth !== 0) { console.log(`SKIP unbalanced ${file}`); continue }
  if (after !== before) { writeFileSync(file, after); changed++ }
}
console.log(`transformed: ${String(changed)}`)
