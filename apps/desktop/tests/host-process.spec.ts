import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopHostProcess, DesktopHostUncleanExitError } from '../src/host-process.ts'

const roots: string[] = []

const HOST_WIRE = `
import { createReadStream, createWriteStream } from 'node:fs'
const requestPipe = createReadStream('', { fd: 3, autoClose: false })
const responsePipe = createWriteStream('', { fd: 4, autoClose: false })
const MAGIC = 0x44534833
const HEADER = 13
function responseFrame(type, streamId, payload = Buffer.alloc(0)) {
  const frame = Buffer.allocUnsafe(HEADER + payload.length)
  frame.writeUInt32BE(MAGIC, 0)
  frame.writeUInt8(type, 4)
  frame.writeUInt32BE(streamId, 5)
  frame.writeUInt32BE(payload.length, 9)
  payload.copy(frame, HEADER)
  return frame
}
function responseStart(streamId, options = {}) {
  const value = { status: options.status ?? 200, headers: options.headers ?? [], hasBody: options.hasBody ?? true }
  responsePipe.write(responseFrame(1, streamId, Buffer.from(JSON.stringify(value))))
}
function responseData(streamId, data) {
  responsePipe.write(responseFrame(2, streamId, Buffer.from(data)))
}
function responseEnd(streamId) { responsePipe.write(responseFrame(3, streamId)) }
function responseError(streamId, message) {
  responsePipe.write(responseFrame(4, streamId, Buffer.from(JSON.stringify({ message }))))
}
let requestBuffer = Buffer.alloc(0)
requestPipe.on('data', chunk => {
  requestBuffer = requestBuffer.length === 0 ? chunk : Buffer.concat([requestBuffer, chunk])
  while (requestBuffer.length >= HEADER) {
    if (requestBuffer.readUInt32BE(0) !== MAGIC) throw new Error('invalid request marker')
    const type = requestBuffer.readUInt8(4)
    const streamId = requestBuffer.readUInt32BE(5)
    const length = requestBuffer.readUInt32BE(9)
    if (requestBuffer.length < HEADER + length) return
    const payload = requestBuffer.subarray(HEADER, HEADER + length)
    requestBuffer = requestBuffer.subarray(HEADER + length)
    onRequestFrame({ type, streamId, payload })
  }
})
process.on('message', message => {
  if (message.type === 'shutdown') {
    requestPipe.destroy()
    responsePipe.end(() => {
      responsePipe.once('close', () => {
        process.exitCode = globalThis.shutdownExitCode ?? 0
        if (globalThis.skipShutdownAck) process.disconnect()
        else process.send({ type: 'shutdown-complete' }, error => { if (error !== null) process.exitCode = 1; process.disconnect() })
      })
      responsePipe.destroy()
    })
  }
})
`

function projectWithHost(source: string): string {
  const project = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-test-'))
  roots.push(project)
  const packageRoot = join(project, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), `${HOST_WIRE}\n${source}`)
  return project
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop host process', () => {
  it('correlates task controls and propagates service errors', async () => {
    const host = new DesktopHostProcess(process.execPath, projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'controls' })
function onRequestFrame() {}
let pending
process.on('message', message => {
  if (message.type !== 'update-tasks') return
  if (message.action === 'inspect') pending = message
  if (message.action === 'lock') {
    process.send({ type: 'update-tasks', requestId: message.requestId, active: true })
    process.send({ type: 'update-tasks', requestId: pending.requestId, active: false })
  }
  if (message.action === 'unlock') process.send({ type: 'update-tasks', requestId: message.requestId, active: true, error: 'services unavailable' })
})
`))
    try {
      await expect(host.updateTasks('inspect')).rejects.toThrow('unavailable')
      await host.start()
      await expect(Promise.all([host.updateTasks('inspect'), host.updateTasks('lock')])).resolves.toEqual([false, true])
      await expect(host.updateTasks('unlock')).rejects.toThrow('services unavailable')
      await expect(host.stop(true)).resolves.toBeUndefined()
      await expect(host.updateTasks('inspect')).rejects.toThrow('unavailable')
    } finally { await host.stop() }
  })

  it.each(['missing acknowledgement', 'nonzero exit'])('confirms an unclean %s even after ordinary stop', async (reason) => {
    const host = new DesktopHostProcess(process.execPath, projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'unclean' })
function onRequestFrame() {}
globalThis.skipShutdownAck = ${String(reason === 'missing acknowledgement')}
globalThis.shutdownExitCode = ${reason === 'nonzero exit' ? '2' : '0'}
`))
    try {
      await host.start()
      const ordinary = host.stop()
      await expect(host.stop(true)).rejects.toBeInstanceOf(DesktopHostUncleanExitError)
      await ordinary
      await expect(host.stop(true)).rejects.toBeInstanceOf(DesktopHostUncleanExitError)
    } finally { await host.stop() }
  })

  it('reports runtime failure once and rejects pending inspection', async () => {
    const failures: Error[] = []
    const host = new DesktopHostProcess(process.execPath, projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'failure' })
function onRequestFrame() {}
process.on('message', message => {
  if (message.type === 'update-tasks') {
    process.send({ type: 'fatal', message: 'runtime failed' })
    process.send({ type: 'fatal', message: 'second failure' })
  }
})
`), undefined, false, (error) => { failures.push(error) })
    try {
      await host.start()
      await expect(host.updateTasks('inspect')).rejects.toThrow('runtime failed')
      await host.stop()
      expect(failures).toHaveLength(1)
    } finally { await host.stop() }
  })

  it('owns a starting Host until shutdown rejects readiness and the process exits', async () => {
    const project = projectWithHost(`
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
writeFileSync(join(process.cwd(), 'starting-pid'), String(process.pid))
process.on('exit', () => { writeFileSync(join(process.cwd(), 'host-exited'), 'closed') })
function onRequestFrame() {}
`)
    const host = new DesktopHostProcess(process.execPath, project)
    const starting = expect(host.start()).rejects.toThrow(/stopping/u)
    try {
      await expect.poll(() => existsSync(join(project, 'starting-pid'))).toBe(true)
      const pid = Number(readFileSync(join(project, 'starting-pid'), 'utf8'))
      const stopping = host.stop()
      expect(host.stop()).toBe(stopping)
      await Promise.all([starting, stopping])
      expect(readFileSync(join(project, 'host-exited'), 'utf8')).toBe('closed')
      expect(() => process.kill(pid, 0)).toThrow()
      await expect(host.start()).rejects.toThrow(/stopping/u)
    } finally {
      await host.stop()
    }
  })

  it('settles failed executable startup and teardown after the spawn error closes', async () => {
    const project = projectWithHost('function onRequestFrame() {}')
    const host = new DesktopHostProcess(join(project, 'missing-node'), project)
    try {
      await expect(host.start()).rejects.toThrow(/ENOENT/u)
    } finally {
      await host.stop()
    }
  })

  it.each([
    { inspectPort: undefined, allowLinkedProfile: true },
    { inspectPort: 0, allowLinkedProfile: true },
    { inspectPort: undefined, allowLinkedProfile: false },
    { inspectPort: 0, allowLinkedProfile: false },
  ])('keeps linked-profile permission independent of inspector $inspectPort ($allowLinkedProfile)', async ({ inspectPort, allowLinkedProfile }) => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'launch-options' })
function onRequestFrame(frame) {
  if (frame.type !== 1) return
  responseStart(frame.streamId)
  responseData(frame.streamId, JSON.stringify({ argv: process.argv.slice(3), execArgv: process.execArgv }))
  responseEnd(frame.streamId)
}
`)
    const primaryRuntime = join(project, 'resources with spaces', 'primary-runtime')
    const host = new DesktopHostProcess(process.execPath, project, inspectPort, allowLinkedProfile, undefined, primaryRuntime)
    try {
      const response = await host.fetch(new Request('dsh-app://app/launch-options'))
      expect(await response.json()).toEqual({
        argv: ['--primary-runtime', primaryRuntime, ...(allowLinkedProfile ? ['--allow-linked-profile'] : [])],
        execArgv: inspectPort === undefined ? [] : ['--inspect=127.0.0.1:0'],
      })
    } finally {
      await host.stop()
    }
  })

  it('carries raw request and response bytes and shuts the child down cleanly', async () => {
    const project = projectWithHost(`
const bodies = new Map()
process.send({ type: 'ready', protocolVersion: 4, dshVersion: process.env.NODE_OPTIONS ?? 'clean' })
function onRequestFrame(frame) {
  if (frame.type === 1) {
    const request = JSON.parse(frame.payload)
    bodies.set(frame.streamId, Buffer.alloc(0))
    if (!request.hasBody) answer(frame.streamId)
  } else if (frame.type === 2) {
    bodies.set(frame.streamId, Buffer.concat([bodies.get(frame.streamId), frame.payload]))
  } else if (frame.type === 3) {
    answer(frame.streamId)
  }
}
function answer(streamId) {
  responseStart(streamId, { headers: [['content-type', 'text/plain']] })
  responseData(streamId, Buffer.concat([Buffer.from('desktop:'), bodies.get(streamId)]))
  responseEnd(streamId)
}
`)
    const previous = process.env.NODE_OPTIONS
    process.env.NODE_OPTIONS = '--require /path/that-must-not-reach-the-child'
    const host = new DesktopHostProcess(process.execPath, project)
    try {
      await expect(host.start()).resolves.toMatchObject({ dshVersion: 'clean' })
      const response = await host.fetch(new Request('dsh-app://app/example', { method: 'POST', body: 'request' }))
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('desktop:request')
      await expect(host.stop()).resolves.toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = previous
      await host.stop().catch(() => undefined)
    }
  })

  it('streams a large binary response in bounded raw frames', async () => {
    const size = 2 * 1024 * 1024
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'large-response' })
function onRequestFrame(frame) {
  if (frame.type !== 1) return
  responseStart(frame.streamId)
  const bytes = Buffer.alloc(${String(64 * 1024)}, 97)
  for (let offset = 0; offset < ${String(size)}; offset += bytes.length) responseData(frame.streamId, bytes)
  responseEnd(frame.streamId)
}
`)
    const host = new DesktopHostProcess(process.execPath, project)
    try {
      const response = await host.fetch(new Request('dsh-app://app/large'))
      const body = new Uint8Array(await response.arrayBuffer())
      expect(body).toHaveLength(size)
      expect(body[0]).toBe(97)
      expect(body.at(-1)).toBe(97)
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('stops an unfinished upload when the Host completes its response early', async () => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'early-response' })
function onRequestFrame(frame) {
  if (frame.type !== 2) return
  responseStart(frame.streamId)
  responseData(frame.streamId, 'accepted')
  responseEnd(frame.streamId)
}
`)
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from('first')) },
      cancel() { canceled = true },
    })
    const host = new DesktopHostProcess(process.execPath, project)
    try {
      const request = new Request('dsh-app://app/early', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })
      const response = await host.fetch(request)
      await expect(response.text()).resolves.toBe('accepted')
      await expect.poll(() => canceled).toBe(true)
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('ignores a response end that arrives after the renderer cancels its stream', async () => {
    const project = projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'cancel-race' })
const urls = new Map()
function onRequestFrame(frame) {
  if (frame.type === 1) {
    const request = JSON.parse(frame.payload)
    urls.set(frame.streamId, request.url)
    responseStart(frame.streamId)
    if (request.url.endsWith('/after')) {
      responseData(frame.streamId, 'alive')
      responseEnd(frame.streamId)
    }
  } else if (frame.type === 4 && urls.get(frame.streamId).endsWith('/cancel')) {
    responseEnd(frame.streamId)
  }
}
`)
    const host = new DesktopHostProcess(process.execPath, project)
    try {
      const canceled = await host.fetch(new Request('dsh-app://app/cancel'))
      await canceled.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 25))
      const after = await host.fetch(new Request('dsh-app://app/after'))
      await expect(after.text()).resolves.toBe('alive')
    } finally {
      await host.stop().catch(() => undefined)
    }
  })

  it('rejects invalid response framing and a clean exit before readiness', async () => {
    const invalid = new DesktopHostProcess(process.execPath, projectWithHost(`
process.send({ type: 'ready', protocolVersion: 4, dshVersion: 'invalid-frame' })
function onRequestFrame(frame) {
  if (frame.type === 1) responsePipe.write(Buffer.alloc(13))
}
`))
    await invalid.start()
    await expect(invalid.fetch(new Request('dsh-app://app/invalid'))).rejects.toThrow(/invalid Host response frame marker/u)
    await invalid.stop().catch(() => undefined)

    const earlyExit = new DesktopHostProcess(process.execPath, projectWithHost(`
function onRequestFrame() {}
process.exit(0)
`))
    await expect(earlyExit.start()).rejects.toThrow(/response pipe ended/u)
  })
})
