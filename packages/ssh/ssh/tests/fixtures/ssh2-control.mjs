/** Test-only protocol peer in a real child; this is not the POSIX helper. */
import { SshRpcPeer } from '../../src/protocol.ts'
const peer = new SshRpcPeer(process.stdin, process.stdout, 4096, 8, async (method, params) => {
  if (method === 'hello') return {
    protocol: 1, hash: 'a'.repeat(64), platform: 'linux', nodeVersion: process.version,
    node: '/fixture/node', root: '/tmp/ssh2-fixture', workspace: '/fixture/workspace',
  }
  if (method === 'echo') return params
  if (method === 'heartbeat' || method === 'close') return null
  throw new Error('Unsupported fixture method ' + method)
})
peer.on('closed', () => { process.stdin.destroy() })
