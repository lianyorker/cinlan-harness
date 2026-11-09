/* Temporary helper: locate brace imbalance in a TS file, skipping strings/comments/template literals. */
const fs = require('fs')
const file = process.argv[2]
const windowLo = Number(process.argv[3] ?? 0)
const windowHi = Number(process.argv[4] ?? 0)
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

let depth = 0
let state = 'code' // code | sq | dq | tpl | line | block
let esc = false
const stack = [] // line where each { opened

for (let li = 0; li < lines.length; li += 1) {
  const line = lines[li]
  for (let ci = 0; ci < line.length; ci += 1) {
    const ch = line[ci]
    const nx = line[ci + 1]
    if (esc) { esc = false; continue }
    if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (ch === '\\') { esc = true; continue }
      if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"') || (state === 'tpl' && ch === '`')) state = 'code'
      continue
    }
    if (state === 'line') { if (ch === '\n') state = 'code'; continue }
    if (state === 'block') { if (ch === '*' && nx === '/') { state = 'code'; ci += 1 } continue }
    // code
    if (ch === '/' && nx === '/') { state = 'line'; continue }
    if (ch === '/' && nx === '*') { state = 'block'; ci += 1; continue }
    if (ch === "'") { state = 'sq'; continue }
    if (ch === '"') { state = 'dq'; continue }
    if (ch === '`') { state = 'tpl'; continue }
    if (ch === '{') { depth += 1; stack.push(li + 1); continue }
    if (ch === '}') {
      depth -= 1
      const opened = stack.pop()
      if (li + 1 > lines.length - 5 || (li + 1 >= windowLo && li + 1 <= windowHi)) {
        console.log(`'}' at ${li + 1} closes '{' from ${opened}`)
      }
      if (depth < 0) { console.log(`negative depth at line ${li + 1}`); process.exit(0) }
    }
  }
  if (state === 'line') state = 'code'
}
console.log(`final depth ${depth}; unclosed '{' opened at lines: ${stack.slice(-10).join(', ')}`)
