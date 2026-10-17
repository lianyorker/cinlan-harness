/** React ownership of multiple desktop connections without shared Session or approval state. */
import { useEffect, useRef, useState } from 'react'
import { ApprovalSchema, DesktopSchema, type Approval, type Desktop } from '@cinlan/mobile-relay/protocol'
import { z } from 'zod'
import { MobileClient, decodeOffer, loadHosts, saveHosts, type HostStatus, type SavedHost } from './client'
import { applySessionFrame, applyStreamFrame, type MobileStream } from './session'
import type { TrajectoryStep } from '../types'
import { loadMobilePreferences } from './preferences'

export interface ConnectedDesktop { saved: SavedHost; desktop: Desktop; status: HostStatus }

/** Keep independently reconnecting Hosts and route every command through its exact hostId. */
export function useDesktops() {
  const clients = useRef(new Map<string, MobileClient>())
  const saved = useRef<SavedHost[]>([])
  const alive = useRef(false)
  const [hosts, setHosts] = useState<Record<string, ConnectedDesktop>>({})
  const [transcripts, setTranscripts] = useState<Record<string, TrajectoryStep[]>>({})
  const [approvals, setApprovals] = useState<Record<string, Approval[]>>({})
  const [error, setError] = useState('')
  const [pairing, setPairing] = useState(false)
  const pairingBusy = useRef(false)
  const [streams, setStreams] = useState<Record<string, MobileStream>>({})
  const subscriptions = useRef(new Map<string, string>())
  const createClient = (source: SavedHost | ReturnType<typeof decodeOffer>): MobileClient => {
    const hostId = source.hostId
    let client: MobileClient
    client = new MobileClient(source, (status) => {
      if (!alive.current || clients.current.get(hostId) !== client) return
      setHosts(previous => previous[hostId] ? { ...previous, [hostId]: { ...previous[hostId], status } } : previous)
      if (status === 'disconnected' || status === 'error') {
        setApprovals(previous => ({ ...previous, [hostId]: [] }))
        setStreams(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(hostId + ':'))))
      }
      if (status === 'paired') {
        const sessionId = subscriptions.current.get(hostId)
        if (sessionId) void client.request({ method: 'subscribe', params: { sessionId } }).catch(reportError)
      }
    }, (event) => {
      if (!alive.current || clients.current.get(hostId) !== client) return
      if (event.event === 'desktop') {
        const desktop = DesktopSchema.parse(event.value)
        if (desktop.hostId !== hostId) throw new Error('desktop_identity_mismatch')
        setHosts(previous => previous[hostId] ? { ...previous, [hostId]: { ...previous[hostId], desktop } } : previous)
      } else if (event.event === 'session' && event.sessionId) {
        const key = hostId + ':' + event.sessionId
        setTranscripts(previous => ({ ...previous, [key]: applySessionFrame(previous[key] ?? [], event.value) }))
        setStreams(previous => ({ ...previous, [key]: applyStreamFrame(previous[key], event.value) }))
      } else if (event.event === 'approval') {
        const approval = ApprovalSchema.parse(event.value)
        setApprovals(previous => ({ ...previous, [hostId]: [...(previous[hostId] ?? []).filter(item => item.approvalId !== approval.approvalId), approval] }))
      } else if (event.event === 'approval-settled') {
        const settled = z.object({ approvalId: z.string() }).strict().parse(event.value)
        setApprovals(previous => ({ ...previous, [hostId]: (previous[hostId] ?? []).filter(item => item.approvalId !== settled.approvalId) }))
      }
    }, (record, desktop) => {
      if (!alive.current || clients.current.get(hostId) !== client || desktop.hostId !== hostId) { client.close(); return }
      const next = [...saved.current.filter(item => item.hostId !== hostId), record]
      saveHosts(next)
      saved.current = next
      setHosts(previous => ({ ...previous, [hostId]: { saved: record, desktop, status: 'paired' } }))
    })
    return client
  }
  const reportError = (reason: unknown): void => { if (alive.current) setError(reason instanceof Error ? reason.message : 'request_failed') }
  useEffect(() => {
    alive.current = true
    try {
      saved.current = loadHosts()
      for (const record of saved.current) {
        const client = createClient(record)
        clients.current.set(record.hostId, client)
        setHosts(previous => ({ ...previous, [record.hostId]: { saved: record, status: 'connecting', desktop: { hostId: record.hostId, name: record.name, os: '', sessions: [], workspaces: [] } } }))
        void client.connect().catch((reason) => {
          if (reason instanceof Error && ['desktop_unavailable', 'desktop_unreachable', 'connection_timeout', 'desktop_disconnected'].includes(reason.message)) return
          reportError(reason)
        })
      }
    } catch (reason) { reportError(reason) }
    return () => { alive.current = false; for (const client of clients.current.values()) client.close(); clients.current.clear() }
  }, [])
  const pair = async (raw: string): Promise<void> => {
    if (pairingBusy.current) throw new Error('pairing_in_progress')
    pairingBusy.current = true
    setPairing(true); setError('')
    let candidate: MobileClient | undefined
    let previousClient: MobileClient | undefined
    let hostId: string | undefined
    try {
      const offer = decodeOffer(raw)
      hostId = offer.hostId
      const previous = saved.current.find(item => item.hostId === offer.hostId)
      if (previous && previous.publicKey !== offer.publicKey) throw new Error('desktop_identity_changed')
      candidate = createClient(offer)
      previousClient = clients.current.get(offer.hostId)
      clients.current.set(offer.hostId, candidate)
      await candidate.connect()
      previousClient?.close()
    } catch (reason) {
      candidate?.close()
      if (hostId && clients.current.get(hostId) === candidate) {
        if (previousClient) clients.current.set(hostId, previousClient)
        else clients.current.delete(hostId)
      }
      reportError(reason); throw reason
    }
    finally { pairingBusy.current = false; if (alive.current) setPairing(false) }
  }
  const requireClient = (hostId: string): MobileClient => {
    const client = clients.current.get(hostId)
    if (!client) throw new Error('desktop_not_connected')
    return client
  }
  return {
    hosts, transcripts, approvals, streams, error, pairing, pair,
    async subscribe(hostId: string, sessionId: string) { subscriptions.current.set(hostId, sessionId); await requireClient(hostId).request({ method: 'subscribe', params: { sessionId } }) },
    async prompt(hostId: string, sessionId: string, text: string) { await requireClient(hostId).request({ method: 'prompt', params: { sessionId, text, mode: loadMobilePreferences().busySend, requestId: 'mobile-' + Date.now() + '-' + Math.random().toString(36).slice(2) } }) },
    async decide(hostId: string, approval: Approval, approved: boolean) { await requireClient(hostId).request({ method: 'approval', params: { approvalId: approval.approvalId, sessionId: approval.sessionId, decision: approved ? 'allowed-once' : 'rejected' } }) },
    async create(hostId: string, workspaceId?: string, title?: string) {
      const result = z.object({ sessionId: z.string(), titleError: z.string().optional() }).passthrough().parse(await requireClient(hostId).request({ method: 'create', params: { ...(workspaceId ? { workspaceId } : {}), ...(title ? { title } : {}) } }))
      if (result.titleError) reportError(new Error(result.titleError))
      return result.sessionId
    },
    disconnect(hostId: string) { requireClient(hostId).close(); setApprovals(previous => ({ ...previous, [hostId]: [] })); setHosts(previous => previous[hostId] ? { ...previous, [hostId]: { ...previous[hostId], status: 'disconnected' } } : previous) },
    async reconnect(hostId: string) { clients.current.get(hostId)?.close(); const record = saved.current.find(item => item.hostId === hostId); if (!record) return; const client = createClient(record); clients.current.set(hostId, client); await client.connect() },
    reportError,
  }
}
