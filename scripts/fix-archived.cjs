const fs = require('fs')
const file = 'packages/client/ui-workspace/tests/rows.client.spec.tsx'
const diag = fs.readFileSync('tsc-out.txt', 'utf8').split(/\r?\n/)
const lines = diag
  .filter(l => l.includes('rows.client.spec.tsx') && /error TS2741|error TS2375/.test(l))
  .map(l => { const m = l.match(/\((\d+),/); return m ? +m[1] : 0 })
const text = fs.readFileSync(file, 'utf8')
const arr = text.split(/\r?\n/)
// process descending so line numbers stay valid
let inserted = 0
for (const n of [...new Set(lines)].sort((a,b) => b - a)) {
  // find first '{' from line n-1 onward (same line or next lines, within 3)
  let open = -1
  for (let i = n - 1; i < Math.min(n + 3, arr.length); i++) {
    if (arr[i].includes('{')) { open = i; break }
  }
  if (open < 0) continue
  // brace-match from first '{' on that line
  let depth = 0, close = -1
  outer: for (let i = open; i < arr.length; i++) {
    for (const ch of arr[i]) {
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { close = i; break outer } }
    }
  }
  if (close < 0) continue
  const body = arr.slice(open, close + 1).join('\n')
  if (/\barchived\s*:/.test(body)) continue
  const indent = (arr[open + 1] || '      ').match(/^\s*/)[0]
  arr.splice(open + 1, 0, `${indent}archived: false,`)
  inserted++
}
fs.writeFileSync(file, arr.join('\n'))
console.log('inserted:', inserted)
