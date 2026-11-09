/** Backpressured child-process transport for synchronous native online recognition. */
import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { VoiceModelDefinition, VoiceTranscriptFrame } from '@cinlan/voice'

interface Reply {
  readonly type: 'ready' | 'partial' | 'final' | 'failure'
  readonly id?: number
  readonly text?: string
  readonly message?: string
}

/** One child process owns one loaded model stream. */
export class OnlineRecognitionProcess {
  private readonly child: ChildProcess
  private readonly exited: Promise<void>
  private closed = false
  private nextId = 0
  private pending: { readonly id: number; readonly resolve: (reply: Reply) => void; readonly reject: (error: Error) => void } | undefined
  private readonly ready: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private settled = false

  constructor(definition: VoiceModelDefinition, cacheDir: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const source = import.meta.url.endsWith('.ts')
    const entry = source
      ? new URL('./recognition-worker.ts', import.meta.url)
      : new URL('./recognition-worker.cjs', import.meta.url)
    this.child = fork(fileURLToPath(entry), [], {
      execArgv: source ? ['--import', import.meta.resolve('tsx/esm')] : [],
      env: scrubbedParentEnv(),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    })
    this.ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject })
    this.exited = new Promise<void>((resolve) => {
      this.child.once('close', () => {
        this.closed = true
        const error = new Error('Local speech recognition process exited before the stream completed.')
        this.rejectReady(error)
        this.pending?.reject(error)
        this.pending = undefined
        resolve()
      })
    })
    this.child.on('message', (value: unknown) => { this.receive(value) })
    this.child.once('error', (error) => {
      this.fail(error)
    })
    const abort = (): void => { this.child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    void this.exited.then(() => signal.removeEventListener('abort', abort))
    this.child.send({ type: 'start', architecture: definition.architecture, cacheDir }, (error) => {
      if (error !== null && error !== undefined) this.rejectReady(error)
    })
  }

  /** Wait until the child has loaded the selected model or rejects on startup failure. */
  async start(): Promise<void> {
    await this.ready
  }

  /** Send one PCM chunk and return its partial hypothesis after child acknowledgement.
   * @param samples - Resampled mono PCM samples for this chunk.
   * @returns The child's acknowledged partial transcript.
   */
  async accept(samples: Float32Array): Promise<VoiceTranscriptFrame> {
    const reply = await this.request({ type: 'audio', id: ++this.nextId, samples })
    if (reply.type !== 'partial' || reply.text === undefined) throw new Error('Local speech recognition returned an invalid partial frame.')
    return { type: 'partial', text: reply.text }
  }

  /** Flush the online recognizer and return its final transcript frame.
   * @returns The child's final transcript.
   */
  async finish(): Promise<VoiceTranscriptFrame> {
    const reply = await this.request({ type: 'finish', id: ++this.nextId })
    if (reply.type !== 'final' || reply.text === undefined) throw new Error('Local speech recognition returned an invalid final frame.')
    return { type: 'final', text: reply.text }
  }

  /** Terminate and join the child process; repeated calls are harmless. */
  async dispose(): Promise<void> {
    if (this.settled) return
    this.settled = true
    if (!this.closed) this.child.kill()
    await this.exited
  }

  private request(message: Record<string, unknown>): Promise<Reply> {
    if (this.pending !== undefined) return Promise.reject(new Error('Local speech recognition already has a pending chunk.'))
    if (this.settled || this.closed) return Promise.reject(new Error('Local speech recognition process has exited.'))
    const id = message.id as number
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject }
      this.child.send(message, (error) => {
        if (error !== null && error !== undefined) {
          this.pending = undefined
          reject(error)
        }
      })
    })
  }

  private receive(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') {
      this.fail(new Error('Local speech recognition process returned an invalid message.'))
      return
    }
    if (value.type === 'ready') {
      this.resolveReady()
      return
    }
    if (value.type === 'failure' && typeof value.message === 'string') {
      this.fail(new Error(value.message))
      return
    }
    if ((value.type !== 'partial' && value.type !== 'final')
      || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || typeof value.text !== 'string') {
      this.fail(new Error('Local speech recognition process returned an invalid message.'))
      return
    }
    const reply: Reply = { type: value.type, id: value.id, text: value.text }
    const pending = this.pending
    if (pending === undefined || pending.id !== reply.id) {
      this.fail(new Error('Local speech recognition process returned an out-of-order reply.'))
      return
    }
    this.pending = undefined
    pending.resolve(reply)
  }

  private fail(error: Error): void {
    this.rejectReady(error)
    this.pending?.reject(error)
    this.pending = undefined
    this.child.kill()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
