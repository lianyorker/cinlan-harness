// Rough TS lexer: counts {}/()/[] depth, skipping strings, template literals,
// line/block comments, and regex literals (heuristic: '/' after =(:,![{;,&|?+-*~^ or 'return').
const fs = require('fs')
const path = process.argv[2]
const src = fs.readFileSync(path, 'utf8')
let i = 0, line = 1, depth = 0
const events = []
const prevSig = () => { // previous significant char before index i
  for (let j = i - 1; j >= 0; j--) { const c = src[j]; if (!/\s/.test(c)) return c }
  return ''
}
while (i < src.length) {
  const c = src[i]
  if (c === '\n') { line++; i++; continue }
  if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
  if (c === '/' && src[i + 1] === '*') { while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++ } i += 2; continue }
  if (c === "'" || c === '"' || c === '`') {
    const q = c; i++
    while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 2; else { if (src[i] === '\n') line++; i++ } }
    i++; continue
  }
  if (c === '/' && /[=(:,!\[{;&|?+*\-~^<>]/.test(prevSig())) { // regex literal
    i++
    let cls = false
    while (i < src.length && (cls || src[i] !== '/')) {
      if (src[i] === '\\') i += 2
      else if (src[i] === '[') { cls = true; i++ }
      else if (src[i] === ']') { cls = false; i++ }
      else { if (src[i] === '\n') break; i++ }
    }
    i++
    while (i < src.length && /[a-z]/.test(src[i])) i++
    continue
  }
  if (c === '{') { depth++; }
  if (c === '}') { depth--; if (depth < 0) { events.push(`depth ${depth} at line ${line}`); depth = 0 } }
  i++
}
console.log(events.join('\n'))
console.log('final depth', depth)
