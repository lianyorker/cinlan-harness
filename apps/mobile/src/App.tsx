import React, { useState, useEffect } from 'react'
import { ConnectDesktopScreen } from './screens/ConnectDesktop/ConnectDesktopScreen'
import { SettingsScreen } from './screens/Settings/SettingsScreen'
import { ManualPairScreen } from './screens/ManualPair/ManualPairScreen'
import { NotificationsScreen } from './screens/Notifications/NotificationsScreen'
import { DashboardScreen } from './screens/Dashboard/DashboardScreen'
import { DesktopSessionsScreen } from './screens/DesktopSessions/DesktopSessionsScreen'
import { MobileSessionView } from './components/MobileSessionView'
import { QrScannerModal } from './components/QrScannerModal'
import { QuotaModal } from './components/QuotaModal'
import { useDesktops } from './transport/use-desktops'
import type { WorkspaceGroup } from './types'
import type { ScreenRoute } from './navigation/routes'
import { ThemeLanguageProvider } from './context/ThemeLanguageContext'

function AppRoot() {
  const [initialCode] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('pair') ?? '')
  useEffect(() => { if (initialCode) history.replaceState(null, '', window.location.pathname + window.location.search) }, [initialCode])
  // Navigation route: start on 'dashboard'
  const [currentRoute, setCurrentRoute] = useState<ScreenRoute>(initialCode ? 'manual-pair' : 'connect-desktop')
  const [previousRoute, setPreviousRoute] = useState<ScreenRoute>('connect-desktop')

  // Connection & Data state
  const connections = useDesktops()
  const isPaired = Object.keys(connections.hosts).length > 0
  const [connectionMessage, setConnectionMessage] = useState('')

  useEffect(() => {
    if (initialCode) {
      void connections.pair(initialCode).then(
        () => {
          setConnectionMessage('')
          setCurrentRoute('dashboard')
        },
        (error) => {
          connections.reportError(error)
          setCurrentRoute('manual-pair')
        },
      )
    }
  }, [initialCode])

  // Active desktop & session state
  const [activeDesktopId, setActiveDesktopId] = useState<string>('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeSessionTitle, setActiveSessionTitle] = useState<string>('')
  const activeHost = connections.hosts[activeDesktopId]
  const connectionStatus = activeHost?.status ?? 'disconnected'
  const sessionKey = activeDesktopId + ':' + activeSessionId
  const steps = connections.transcripts[sessionKey] ?? []
  const activeThought = connections.streams[sessionKey]?.thought ?? ''
  const activeContent = connections.streams[sessionKey]?.content ?? ''
  const pendingApproval = connections.approvals[activeDesktopId]?.find(item => item.sessionId === activeSessionId) ?? null
  useEffect(() => {
    const host = Object.values(connections.hosts)[0]
    if (host && !activeDesktopId) {
      setActiveDesktopId(host.saved.hostId)
      setCurrentRoute('dashboard')
    }
  }, [connections.hosts, activeDesktopId])
  useEffect(() => {
    if (connections.error) setConnectionMessage(connections.error)
  }, [connections.error])
  const workspaces: WorkspaceGroup[] = activeHost ? activeHost.desktop.workspaces.map(workspace => ({
    id: workspace.id,
    name: workspace.name,
    sessions: activeHost.desktop.sessions
      .filter(session => workspace.sessionIds.includes(session.id))
      .map(session => ({
        id: session.id,
        title: session.title,
        type: 'chat',
        isActive: session.running,
        updatedAt: session.updatedAt,
      })),
  })) : []
  if (activeHost) {
    const assigned = new Set(workspaces.flatMap(workspace => workspace.sessions.map(session => session.id)))
    const unassigned = activeHost.desktop.sessions.filter(session => !assigned.has(session.id))
    if (unassigned.length) {
      workspaces.push({
        id: '',
        name: activeHost.desktop.name,
        sessions: unassigned.map(session => ({
          id: session.id,
          title: session.title,
          type: 'chat',
          isActive: session.running,
          updatedAt: session.updatedAt,
        })),
      })
    }
  }

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [isQuotaOpen, setIsQuotaOpen] = useState(false)
  const [quotaBalance] = useState(0)
  const billingUrl = 'https://cinlan.ai/billing'

  // Modals & Navigation state
  const [autoOpenCreateInSessions, setAutoOpenCreateInSessions] = useState(false)

  const navigateTo = (route: ScreenRoute) => {
    setPreviousRoute(currentRoute)
    setCurrentRoute(route)
  }

  const goBack = () => {
    if (
      currentRoute === 'manual-pair' ||
      currentRoute === 'connect-desktop' ||
      currentRoute === 'settings'
    ) {
      setCurrentRoute('dashboard')
    } else {
      setCurrentRoute(
        previousRoute && previousRoute !== currentRoute
          ? previousRoute
          : 'dashboard',
      )
    }
  }

  const connectWithCode = (raw: string) => {
    void connections.pair(raw).then(() => { setConnectionMessage(''); setCurrentRoute('dashboard') }, connections.reportError)
  }

  const handleApprovalDecision = async (approved: boolean) => {
    if (pendingApproval) await connections.decide(activeDesktopId, pendingApproval, approved)
  }

  const handleInjectPrompt = async (text: string) => {
    const value = text.trim()
    if (value === '') return
    if (activeSessionId) await connections.prompt(activeDesktopId, activeSessionId, value)
  }

  const handleDisconnect = (hostId: string) => {
    connections.disconnect(hostId)
  }

  const handleOpenDesktop = (desktopId: string) => {
    setActiveDesktopId(desktopId)
    navigateTo('desktop-sessions')
  }

  const handleOpenSession = (sessionId: string, title?: string) => {
    setActiveSessionId(sessionId)
    if (title) setActiveSessionTitle(title)
    navigateTo('session')
    void connections.subscribe(activeDesktopId, sessionId).catch(connections.reportError)
  }

  // Render active screen
  const renderScreen = () => {
    switch (currentRoute) {
      case 'connect-desktop':
        return (
          <ConnectDesktopScreen
            onStartPairing={() => setIsScannerOpen(true)}
            onOpenManualPair={() => navigateTo('manual-pair')}
            onOpenSettings={() => navigateTo('settings')}
            onBack={isPaired ? () => navigateTo('dashboard') : undefined}
            onPairSuccess={code => connectWithCode(code)}
          />
        )

      case 'settings':
        return (
          <SettingsScreen
            onBack={goBack}
            hosts={Object.values(connections.hosts).map(host => ({
              hostId: host.saved.hostId,
              name: host.desktop.name,
              os: host.desktop.os,
              status: host.status,
              transport: host.saved.relay ? 'relay' : 'lan',
              endpoint: host.saved.directUrl ?? host.saved.relay?.cellUrl ?? '',
            }))}
            connectionError={connections.error}
          />
        )

      case 'manual-pair':
        return (
          <ManualPairScreen
            initialCode={initialCode}
            onPairSuccess={(code) => {
              connectWithCode(code)
            }}
            onBack={isPaired ? () => navigateTo('dashboard') : () => navigateTo('connect-desktop')}
            onOpenSettings={() => navigateTo('settings')}
          />
        )

      case 'notifications':
        return (
          <NotificationsScreen
            onEnableNotifications={() => navigateTo('dashboard')}
            onSkip={() => navigateTo('dashboard')}
            onBack={goBack}
          />
        )

      case 'desktop-sessions':
        return (
          <DesktopSessionsScreen
            key={activeDesktopId}
            desktopId={activeDesktopId}
            desktop={activeHost ? {
              id: activeDesktopId,
              name: activeHost.desktop.name,
              os: activeHost.desktop.os,
              isConnected: activeHost.status === 'paired' || activeHost.status === 'reconnecting',
              connectionType: activeHost.saved.relay ? 'Relay' : 'LAN',
              workspaceCount: workspaces.length,
            } : undefined}
            workspaces={workspaces}
            onCreateSession={async (workspaceId, title) => {
              const sessionId = await connections.create(activeDesktopId, workspaceId || undefined, title)
              handleOpenSession(sessionId, title)
            }}
            onBack={() => {
              setAutoOpenCreateInSessions(false)
              navigateTo('dashboard')
            }}
            onSelectSession={(sessionId, title) => {
              setAutoOpenCreateInSessions(false)
              handleOpenSession(sessionId, title)
            }}
            initialOpenCreate={autoOpenCreateInSessions}
          />
        )

      case 'session':
        return (
          <MobileSessionView
            sessionId={activeSessionId ?? 'session-1'}
            sessionTitle={activeSessionTitle}
            projectPath={
              activeHost?.desktop.workspaces.find(workspace =>
                workspace.sessionIds.some(id => String(id) === activeSessionId),
              )?.path
            }
            status={connectionStatus}
            steps={steps}
            activeThought={activeThought}
            activeContent={activeContent}
            pendingApproval={pendingApproval}
            onApprovalDecision={handleApprovalDecision}
            onInjectPrompt={handleInjectPrompt}
            onBack={() => navigateTo('desktop-sessions')}
            quotaBalance={quotaBalance}
            onOpenQuota={() => setIsQuotaOpen(true)}
          />
        )

      case 'dashboard':
      default:
        return (
          <DashboardScreen
            desktops={Object.values(connections.hosts).map(host => ({
              id: host.saved.hostId,
              name: host.desktop.name,
              os: host.desktop.os,
              isConnected: host.status === 'paired' || host.status === 'reconnecting',
              connectionType: host.saved.relay ? 'Relay' : 'LAN',
              workspaceCount: host.desktop.workspaces.length,
            }))}
            sessionsCount={Object.values(connections.hosts).reduce((count, host) => count + host.desktop.sessions.length, 0)}
            onReconnect={(hostId) => { void connections.reconnect(hostId).catch(connections.reportError) }}
            onOpenSettings={() => navigateTo('settings')}
            onPairAnother={() => navigateTo('manual-pair')}
            onNewWorkspace={() => {
              setAutoOpenCreateInSessions(true)
              navigateTo('desktop-sessions')
            }}
            onOpenDesktop={handleOpenDesktop}
            onDisconnect={handleDisconnect}
          />
        )
    }
  }

  return (
    <div className="mobile-app-root h-screen w-screen theme-bg theme-text flex flex-col overflow-hidden font-sans select-none transition-colors duration-200">
      {connectionMessage === '' ? null : (
        <div className="connection-notice" role="status">
          {connectionMessage}
        </div>
      )}

      {/* Screen View */}
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {renderScreen()}
      </div>

      {/* QR Scanner Camera Modal */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(value) => {
          setIsScannerOpen(false)
          connectWithCode(value)
        }}
      />

      {/* Quota Modal */}
      <QuotaModal
        isOpen={isQuotaOpen}
        onClose={() => setIsQuotaOpen(false)}
        balance={quotaBalance}
        quotaTotal={100000}
        quotaUsed={32400}
        billingUrl={billingUrl}
      />
    </div>
  )
}

export function App() {
  return (
    <ThemeLanguageProvider>
      <AppRoot />
    </ThemeLanguageProvider>
  )
}

export default App
