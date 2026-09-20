/** React-free terminal attachments and agent snapshots over supervised Remote streams. */
import { RemoteStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { TerminalCallbacks } from '../types.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SidebarAgentTerminalSnapshot, SidebarTerminalAttachmentId,
  SidebarTerminalFrame,
  SidebarTerminalProcessId, SidebarTerminalReleaseRequest, SidebarTerminalSessionId, SidebarTerminalTabId,
} from '@deepseek-ai/dsh-sidebar-terminals/types'

type SidebarTerminalRemote = TypertClientRemote['sidebarTerminals']
type ReleaseMode = SidebarTerminalReleaseRequest['mode']
type AgentList = readonly SidebarAgentTerminalSnapshot[]

interface OwnedStream { close(): Promise<void> }

/**
 * Create one plugin-owned terminal transport using Connection's existing retry supervision.
 * @param remote - generated sidebarTerminals namespace with RemoteResult unary answers.
 * @param connection - observable Connection generation used by RemoteStream.
 * @returns narrow callbacks; the plugin must await dispose when its effect retires.
 */
export function createTerminalTransport(
  remote: SidebarTerminalRemote,
  connection: Pick<ConnectionHandle, 'generation'>,
): TerminalCallbacks {
  const streams = new Set<OwnedStream>()
  const requests = new Set<Promise<unknown>>()
  const uiProcesses = new Map<string, SidebarTerminalProcessId>()
  let disposed = false
  let disposing: Promise<void> | undefined

  const requireOwner = (): void => {
    if (disposed) throw new Error('Terminal transport disposed')
  }
  const track = <T>(pending: Promise<T>): Promise<T> => {
    requests.add(pending)
    void pending.then(() => requests.delete(pending), () => requests.delete(pending))
    return pending
  }
  const answer = <T>(result: Promise<RemoteResult<T>>): Promise<T> => track(result.then((value) => {
    if (!value.ok) throw value.error
    return value.value
  }))

  const connectTerminal: TerminalCallbacks['connectTerminal'] = (request, onFrame, onError) => {
    requireOwner()
    let attachmentId: SidebarTerminalAttachmentId | undefined
    let processId: SidebarTerminalProcessId | undefined
    const target = request.target
    const uiKey = target.kind === 'ui' ? uiProcessKey(target.sessionId, target.tabId) : undefined
    const state = { stopped: false }
    const isStopped = (): boolean => state.stopped
    let release: Promise<unknown> = Promise.resolve()
    let closing: Promise<void> | undefined
    const stream = new RemoteStream<SidebarTerminalFrame>(connection, {
      name: 'Sidebar terminal',
      open: (signal) => {
        if (isStopped()) throw new Error('Sidebar terminal released')
        attachmentId = undefined
        return remote.open(request, signal)
      },
      ended: accepted => accepted
        ? new RemoteStreamCarrierError('Sidebar terminal ended without exit')
        : new Error('Sidebar terminal ended before ready'),
    })
    const close = (mode: ReleaseMode): Promise<void> => {
      if (closing !== undefined) return closing
      state.stopped = true
      // Parking must reach the provider before abort triggers its disconnect disposition.
      const id = attachmentId
      release = id === undefined
        ? Promise.resolve()
        : Promise.resolve().then(() => answer(remote.release({ attachmentId: id, mode })))
      closing = (async () => {
        try { await release } finally {
          await stream.dispose()
          await done
          streams.delete(owner)
        }
      })()
      return closing
    }
    const owner: OwnedStream = { close: () => close('disconnect') }
    streams.add(owner)
    const done = (async () => {
      let generation = 0
      try {
        for await (const item of stream) {
          if (isStopped()) { await release; break }
          const frame = item.value
          if (item.generation !== generation) {
            if (frame.type !== 'ready') throw new Error('Sidebar terminal emitted output before ready')
            generation = item.generation
          } else if (frame.type === 'ready') {
            throw new Error('Sidebar terminal emitted duplicate ready')
          }
          if (frame.type === 'ready') {
            attachmentId = frame.attachmentId
            processId = frame.processId
            if (uiKey !== undefined) uiProcesses.set(uiKey, processId)
          } else {
            if (frame.attachmentId !== attachmentId) throw new Error('Sidebar terminal attachment changed without ready')
            if (frame.type === 'exit' && uiKey !== undefined && uiProcesses.get(uiKey) === processId) {
              uiProcesses.delete(uiKey)
            }
          }
          await untilAborted(onFrame(frame), stream.signal)
          if (isStopped()) { await release; break }
          switch (frame.type) {
            case 'ready':
              item.accept()
              await answer(remote.ack({ attachmentId: frame.attachmentId, sequence: 0 }))
              break
            case 'data':
              await answer(remote.ack({ attachmentId: frame.attachmentId, sequence: frame.sequence }))
              break
            case 'exit':
              attachmentId = undefined
              return
            /* v8 ignore next 2 -- Exhaustiveness guard for SidebarTerminalFrame's closed union. */
            default:
              assertNever(frame)
          }
        }
      } catch (error) {
        if (!isStopped()) {
          try { onError(error) } catch {
            // A failed error sink has no second recipient; it must not leak a background rejection.
          }
        }
      } finally {
        await stream.dispose()
        if (!isStopped()) {
          attachmentId = undefined
          streams.delete(owner)
        }
      }
    })()
    return close
  }

  const watchAgentTerminals: TerminalCallbacks['watchAgentTerminals'] = (sessionId, onList) => {
    requireOwner()
    const state = { stopped: false }
    const isStopped = (): boolean => state.stopped
    let closing: Promise<void> | undefined
    const stream = new RemoteStream<AgentList>(connection, {
      name: 'Sidebar agent terminals',
      open: signal => remote.watch(sessionId, signal),
      ended: accepted => accepted
        ? new RemoteStreamCarrierError('Sidebar agent terminal watch ended')
        : new Error('Sidebar agent terminal watch ended before snapshot'),
    })
    const owner: OwnedStream = {
      close: () => {
        if (closing !== undefined) return closing
        state.stopped = true
        closing = (async () => {
          await stream.dispose()
          await done
          streams.delete(owner)
        })()
        return closing
      },
    }
    streams.add(owner)
    const done = (async () => {
      try {
        for await (const item of stream) {
          if (isStopped()) break
          publishList(onList, item.value)
          item.accept()
        }
      } catch {
        // Watches have no error callback; capability and attachment calls report unavailability.
      } finally {
        await stream.dispose()
        if (!isStopped()) streams.delete(owner)
      }
    })()
    return () => { void owner.close() }
  }

  return {
    connectTerminal,
    watchAgentTerminals,
    async terminalInput(attachmentId, data) {
      requireOwner()
      await answer(remote.input({ attachmentId, data }))
    },
    async terminalResize(attachmentId, cols, rows) {
      requireOwner()
      await answer(remote.resize({ attachmentId, cols, rows }))
    },
    async terminalCapability() {
      requireOwner()
      return answer(remote.capability())
    },
    async terminalShells() {
      requireOwner()
      return answer(remote.shells())
    },
    async terminalCloseAgent(uuid) {
      requireOwner()
      await answer(remote.closeAgent(uuid))
    },
    async terminalCloseUi(sessionId, tabId) {
      requireOwner()
      const key = uiProcessKey(sessionId, tabId)
      const cached = uiProcesses.get(key)
      // Renderer unmount may release first; do not replace a known token with a newer Host generation.
      uiProcesses.delete(key)
      await track((async () => {
        const processId = cached ?? await answer(remote.inspectUi({ sessionId, tabId }))
        if (processId === null) return
        await answer(remote.closeUi({ sessionId, tabId, processId }))
      })())
    },
    async terminalListUi(sessionId) {
      requireOwner()
      return answer(remote.listUi(sessionId))
    },
    async terminalRenameUi(request) {
      requireOwner()
      return answer(remote.renameUi(request))
    },
    dispose() {
      if (disposing !== undefined) return disposing
      disposed = true
      uiProcesses.clear()
      disposing = (async () => {
        const results = await Promise.allSettled([...streams].map(stream => stream.close()))
        await Promise.allSettled([...requests])
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
        if (failures.length > 0) throw new AggregateError(failures, 'Terminal transport release failed')
      })()
      return disposing
    },
  }
}

function uiProcessKey(sessionId: SidebarTerminalSessionId, tabId: SidebarTerminalTabId): string {
  return JSON.stringify([sessionId, tabId])
}

function publishList(listener: (list: AgentList) => void, list: AgentList): void {
  try { listener(list) } catch {
    // A failed list callback must not terminate the watch or leak a background rejection.
  }
}

function untilAborted(pending: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = (): void => { reject(new Error('Terminal sink aborted', { cause: signal.reason })) }
    signal.addEventListener('abort', aborted, { once: true })
    void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', aborted) })
  })
}

/* v8 ignore next 3 -- Exhaustiveness assertion cannot run for the typed Host frame union. */
function assertNever(value: never): never {
  throw new Error('Unexpected terminal frame: ' + String(value))
}
