import { ResourceStore } from '../../src/resource-store.ts'

const root = process.argv[2]
if (!root || !process.send) throw new Error('ResourceStore fixture requires a root and IPC')
const store = new ResourceStore(root, (error) => { console.error(error) })
await store.initialize()
let lease
process.on('message', async (message) => {
  try {
    let result
    switch (message.command) {
      case 'acquire':
        lease = await store.acquire()
        result = lease?.installation
        break
      case 'remove':
        result = await store.commit(undefined, message.revision, new AbortController().signal)
        break
      case 'release':
        await lease?.release()
        lease = undefined
        result = true
        break
      default:
        throw new Error('Unknown ResourceStore fixture command')
    }
    process.send({ id: message.id, result })
  } catch (error) {
    process.send({ id: message.id, error: String(error) })
  }
})
process.send({ ready: true })
