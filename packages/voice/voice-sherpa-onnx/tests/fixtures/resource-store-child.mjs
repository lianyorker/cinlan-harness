import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { VoiceResourceStore } from '../../src/resource-store.ts'

const root = process.argv[2]
if (!root || !process.send) throw new Error('Voice store fixture requires a root and IPC')
const store = new VoiceResourceStore(root, { lockTimeoutMs: 10_000, lockRetryMs: 10 })
const signal = new AbortController().signal
let lease
let lock
process.on('message', async message => {
  try {
    let result
    switch (message.command) {
      case 'inspect': result = await store.inspect(message.definition, signal); break
      case 'commit': result = await store.commit(message.definition, message.stagingDir, message.revision, signal); break
      case 'remove': result = await store.remove(message.definition, message.revision, signal); break
      case 'acquire':
        lease = await store.acquire(message.definition, signal)
        result = { cacheDir: lease.cacheDir, definition: lease.definition }
        break
      case 'release': await lease.release(); lease = undefined; result = true; break
      case 'hold-lock':
        await store.inspect(message.definition, signal)
        lock = join(root, '.resources', message.definition.id, 'pointer.json.lock')
        await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' })
        result = true
        break
      case 'unlock': await unlink(lock); lock = undefined; result = true; break
      case 'exit':
        if (lease) await lease.release()
        if (lock) await unlink(lock)
        process.send({ id: message.id, result: true }, () => process.disconnect())
        return
      default: throw new Error('Unknown voice store fixture command')
    }
    process.send({ id: message.id, result })
  } catch (error) { process.send({ id: message.id, error: String(error) }) }
})
process.send({ ready: true })
