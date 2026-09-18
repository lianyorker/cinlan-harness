import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const state = JSON.parse(readFileSync(new URL('./state.json', import.meta.url), 'utf8'))
appendFileSync(state.journal, JSON.stringify({ executable: process.execPath, entry: process.argv[1], cwd: process.cwd() }) + '\n')
writeFileSync(state.ready, 'ready')
if (state.pending) {
  setInterval(() => {}, 1000)
} else {
  process.stdout.write(state.output ?? 'Android Debug Bridge version 1.0.41\n')
  process.exitCode = state.exitCode ?? 0
}
