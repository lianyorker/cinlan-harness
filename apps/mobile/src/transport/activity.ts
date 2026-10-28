/** Online activity derived from the authenticated desktop's existing events. */
import type { Approval, Desktop, HostId, MobileSessionId } from '@cinlan/mobile-relay/protocol'

/** An observed idle transition or a newly received pending approval, not a task result. */
export interface MobileActivity {
  readonly hostId: HostId
  readonly sessionId: MobileSessionId
  readonly kind: 'idle' | 'approval'
}

/** Track one client's baseline and pending approvals without retaining transcript content. */
export class DesktopActivity {
  private desktop: Desktop | undefined
  private readonly approvals = new Set<string>()

  /** Set a connection baseline without replaying changes missed while disconnected. */
  baseline(desktop: Desktop | undefined): void { this.desktop = desktop }

  /** Return running-to-idle transitions present in consecutive live desktop snapshots. */
  update(desktop: Desktop): MobileActivity[] {
    const previous = this.desktop
    this.desktop = desktop
    if (!previous || previous.hostId !== desktop.hostId) return []
    const running = new Set(previous.sessions.filter(session => session.running).map(session => session.id))
    return desktop.sessions.filter(session => !session.running && running.has(session.id))
      .map(session => ({ hostId: desktop.hostId, sessionId: session.id, kind: 'idle' }))
  }

  /** Deduplicate pending approval events during this client's lifetime, including automatic reconnect. */
  approval(hostId: HostId, approval: Approval): MobileActivity | null {
    if (this.approvals.has(approval.approvalId)) return null
    this.approvals.add(approval.approvalId)
    return { hostId, sessionId: approval.sessionId, kind: 'approval' }
  }

  /** Release a settled approval's deduplication entry. */
  settle(approvalId: string): void { this.approvals.delete(approvalId) }
}

/** Read the phone's online-only notification preferences; unreadable storage disables notices. */
export function loadNotificationPreferences(): { enabled: boolean; suppressFocused: boolean; configured: boolean } {
  try {
    const enabled = localStorage.getItem('cinlan-mobile:notifications-enabled')
    return { enabled: enabled !== 'false', configured: enabled !== null,
      suppressFocused: localStorage.getItem('cinlan-mobile:notifications-focused') === 'true' }
  } catch (_unreadableStorage) {
    return { enabled: false, suppressFocused: false, configured: false }
  }
}
