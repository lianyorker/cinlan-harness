/** Independent source-mode owner process. No Agent, model, or external endpoint is composed. */
import { AutomationOwnership } from '../../src/ownership.ts'
const directory = process.argv[2]
if (directory === undefined) throw new Error('directory required')
const ownership = await AutomationOwnership.acquire(directory)
process.send?.({ kind: ownership === null ? 'busy' : 'owned' })
process.on('message', (message: unknown) => {
  if (message === 'release') {
    ownership?.close()
    process.send?.({ kind: 'released' })
    process.disconnect()
  }
})
