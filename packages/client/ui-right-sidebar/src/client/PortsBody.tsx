/** Workspace and SSH port discovery and forwarding panel. */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetectedPort, PortForwardRule } from './ports-types.ts'
import {
  addPortForward,
  removePortForward,
  scanWorkspacePorts,
  useWorkspacePorts,
} from './ports-store.ts'
import css from './SidebarContributors.module.css'

export interface PortsBodyProps extends PropsRuntime<'sidebar.right.pane.tab'>, PropsLocale<'rightSidebarContributors'> {
  /** Optional custom port scanner probe for testing or specific runtime adapters. */
  readonly probe?: () => Promise<{ readonly ok: boolean; readonly ports?: readonly DetectedPort[]; readonly error?: string }>
  /** Optional handler when a port is opened. */
  readonly onOpenUrl?: (url: string) => void
}

export function PortsBody({ t, probe, onOpenUrl }: PortsBodyProps): JSX.Element {
  const state = useWorkspacePorts()
  const [localInput, setLocalInput] = useState('')
  const [remoteInput, setRemoteInput] = useState('')
  const [hostInput, setHostInput] = useState('127.0.0.1')
  const [labelInput, setLabelInput] = useState('')
  const [errorMsg, setErrorMsg] = useState<string>()

  const handleScan = useCallback(async () => {
    setErrorMsg(undefined)
    await scanWorkspacePorts(probe)
  }, [probe])

  useEffect(() => {
    void handleScan()
  }, [handleScan])

  const handleAdd = useCallback(() => {
    setErrorMsg(undefined)
    const local = parseInt(localInput.trim(), 10)
    const remote = parseInt(remoteInput.trim(), 10)
    if (Number.isNaN(local) || Number.isNaN(remote)) {
      setErrorMsg('Port numbers must be valid integers between 1 and 65535.')
      return
    }

    try {
      const labelTrimmed = labelInput.trim()
      addPortForward({
        localPort: local,
        remotePort: remote,
        remoteHost: hostInput.trim() || '127.0.0.1',
        ...(labelTrimmed ? { label: labelTrimmed } : {}),
      })
      setLocalInput('')
      setRemoteInput('')
      setLabelInput('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }, [localInput, remoteInput, hostInput, labelInput])

  const handleQuickForward = useCallback((port: DetectedPort) => {
    setErrorMsg(undefined)
    try {
      addPortForward({
        localPort: port.port,
        remotePort: port.port,
        remoteHost: port.host,
        ...(port.processName !== undefined ? { label: port.processName } : {}),
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleOpen = useCallback((portNumber: number) => {
    const url = `http://localhost:${portNumber}`
    if (onOpenUrl) {
      onOpenUrl(url)
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank')
    }
  }, [onOpenUrl])

  return (
    <section className={css.portsPanel} data-testid="right-sidebar-ports-panel">
      <div className={css.portsHeader}>
        <div>
          <h3 className={css.heading}>{t('ports.title')}</h3>
          <p className={css.muted}>{t('ports.description')}</p>
        </div>
        <button
          type="button"
          className={css.button}
          onClick={() => { void handleScan() }}
          disabled={state.status === 'scanning'}
        >
          {state.status === 'scanning' ? t('ports.scanning') : t('ports.refresh')}
        </button>
      </div>

      {state.unavailableReason ? (
        <p className={css.error} role="alert">
          {t('ports.unavailable').replace('{reason}', state.unavailableReason)}
        </p>
      ) : null}

      {errorMsg ? (
        <p className={css.error} role="alert">
          {errorMsg}
        </p>
      ) : null}

      {/* Forwarded Ports Card */}
      <div className={css.portCard}>
        <div className={css.portCardHeader}>
          <span>{t('ports.forwardedTitle').replace('{count}', String(state.forwardedPorts.length))}</span>
        </div>
        {state.forwardedPorts.length === 0 ? (
          <p className={css.muted}>{t('ports.noForwarded')}</p>
        ) : (
          <ul className={css.portList}>
            {state.forwardedPorts.map((rule: PortForwardRule) => (
              <li key={rule.id} className={css.portRow}>
                <div className={css.portInfo}>
                  <span className={css.portBadge}>{rule.localPort}</span>
                  <span className={css.portTarget}>{'→'} {rule.remoteHost}:{rule.remotePort}</span>
                  {rule.label ? <span className={css.portProcess}>({rule.label})</span> : null}
                  <span className={`${css.badge} ${rule.status === 'active' ? css.badgeSent : css.badgeDraft}`}>
                    {rule.status === 'active' ? t('ports.statusActive') : t('ports.statusStopped')}
                  </span>
                </div>
                <div className={css.commentActions}>
                  <button
                    type="button"
                    className={css.primaryButton}
                    onClick={() => { handleOpen(rule.localPort) }}
                    title={t('ports.open')}
                  >
                    {t('ports.open')}
                  </button>
                  <button
                    type="button"
                    className={css.button}
                    onClick={() => { removePortForward(rule.id) }}
                    title={t('ports.stop')}
                  >
                    {t('ports.stop')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detected Ports Card */}
      <div className={css.portCard}>
        <div className={css.portCardHeader}>
          <span>{t('ports.detectedTitle').replace('{count}', String(state.detectedPorts.length))}</span>
        </div>
        {state.detectedPorts.length === 0 ? (
          <p className={css.muted}>{t('ports.noDetected')}</p>
        ) : (
          <ul className={css.portList}>
            {state.detectedPorts.map((p: DetectedPort) => (
              <li key={`${p.host}:${p.port}`} className={css.portRow}>
                <div className={css.portInfo}>
                  <span className={css.portBadge}>{p.port}</span>
                  <span className={css.portTarget}>{p.host}</span>
                  {p.processName ? <span className={css.portProcess}>{p.processName}</span> : null}
                </div>
                <div className={css.commentActions}>
                  <button
                    type="button"
                    className={css.button}
                    onClick={() => { handleOpen(p.port) }}
                  >
                    {t('ports.open')}
                  </button>
                  <button
                    type="button"
                    className={css.primaryButton}
                    onClick={() => { handleQuickForward(p) }}
                  >
                    {t('ports.forward')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add Manual Forwarding Form */}
      <div className={css.portCard}>
        <div className={css.portCardHeader}>
          <span>{t('ports.addTitle')}</span>
        </div>
        <div className={css.portFormRow}>
          <input
            className={css.portInputSmall}
            type="number"
            min="1"
            max="65535"
            placeholder={t('ports.localPort')}
            aria-label={t('ports.localPort')}
            value={localInput}
            onChange={e => { setLocalInput(e.target.value) }}
          />
          <input
            className={css.portInputSmall}
            type="number"
            min="1"
            max="65535"
            placeholder={t('ports.remotePort')}
            aria-label={t('ports.remotePort')}
            value={remoteInput}
            onChange={e => { setRemoteInput(e.target.value) }}
          />
          <input
            className={css.portInputSmall}
            type="text"
            placeholder={t('ports.remoteHost')}
            aria-label={t('ports.remoteHost')}
            value={hostInput}
            onChange={e => { setHostInput(e.target.value) }}
          />
          <input
            className={css.portInputText}
            type="text"
            placeholder={t('ports.label')}
            aria-label={t('ports.label')}
            value={labelInput}
            onChange={e => { setLabelInput(e.target.value) }}
          />
          <button
            type="button"
            className={css.primaryButton}
            onClick={handleAdd}
          >
            {t('ports.addBtn')}
          </button>
        </div>
      </div>
    </section>
  )
}
