/** Task-only framed helper endpoint; does not implement a remote filesystem or claim POSIX support. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
let buffer = Buffer.alloc(0)
process.stdin.on('data', bytes => {
  buffer = Buffer.concat([buffer, bytes])
  while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE(0) + 4) {
    const length = buffer.readUInt32BE(0)
    const request = JSON.parse(buffer.subarray(4, length + 4)); buffer = buffer.subarray(length + 4)
    const value = request.method === 'hello' ? { protocol: 1, hash: hash(fileURLToPath(import.meta.url)),
      bootstrapHash: hash(request.params.bootstrapPath) }
      : request.method === 'sandbox'
        ? { argv: [process.execPath, '--permission', '--allow-fs-read=*', ...request.params.argv.slice(1)] } : null
    const payload = Buffer.from(JSON.stringify({ type: 'result', id: request.id, value }))
    const header = Buffer.alloc(4); header.writeUInt32BE(payload.length)
    process.stdout.write(Buffer.concat([header, payload]))
  }
})
