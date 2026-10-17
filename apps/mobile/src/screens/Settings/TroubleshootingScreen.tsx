import React, { useState } from 'react'
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Activity,
  FileText,
  CheckCircle2,
  AlertCircle,
  Bell,
  WifiOff,
  Shield,
  Monitor,
  Clock,
  Globe,
  Lock,
  X,
  RefreshCw,
} from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import type { ConnectionStatus, HostConnectionSummary } from '../../types'

/** Static help articles; they describe causes, never a measured result. */
interface TroubleshootingIssue {
  readonly id: string
  readonly title: string
  readonly titleEn: string
  readonly content: string
  readonly contentEn: string
  readonly iconType: 'bell' | 'wifi-off' | 'shield' | 'monitor' | 'clock' | 'globe' | 'lock'
}

const ISSUES: readonly TroubleshootingIssue[] = [
  {
    id: 'issue-notification',
    title: '收不到通知',
    titleEn: 'No Notifications',
    iconType: 'bell',
    content: '请确认手机系统的通知权限已开启，且“勿扰模式”未屏蔽 Cinlan。通知服务尚未接通时不会发送任何消息。',
    contentEn: 'Check the system notification permission and that Do Not Disturb does not block Cinlan. No message is sent while the push service is unconnected.',
  },
  {
    id: 'issue-lan',
    title: '同局域网无法连接',
    titleEn: 'LAN Connection Fails',
    iconType: 'wifi-off',
    content: '请确认电脑与手机处于同一网段，且路由器未开启 AP 隔离（客户端隔离）或访客网络隔离。',
    contentEn: 'Confirm both devices share one subnet and the router has not enabled AP isolation or guest-network isolation.',
  },
  {
    id: 'issue-permission',
    title: '相机权限被拒绝',
    titleEn: 'Camera Permission Denied',
    iconType: 'shield',
    content: '扫码配对需要相机权限。请在系统设置中找到浏览器或本应用并允许相机访问。',
    contentEn: 'Scanning a pairing QR needs camera access; allow it for the browser or app in system settings.',
  },
  {
    id: 'issue-desktop-app',
    title: '桌面端应用未运行',
    titleEn: 'Desktop App Not Running',
    iconType: 'monitor',
    content: '请确认桌面端 Cinlan Harness 已启动并正常运行。如果桌面端退出了，请重新打开。',
    contentEn: 'Confirm Cinlan Harness desktop app is running and active on your computer.',
  },
  {
    id: 'issue-timeout',
    title: '连接超时',
    titleEn: 'Connection Timeout',
    iconType: 'clock',
    content: '部分企业或公共 Wi-Fi 开启了 AP 隔离（AP Isolation），禁止局域网设备间直接互访。',
    contentEn: 'Some Wi-Fi routers enable AP Isolation, prohibiting direct peer-to-peer LAN communication.',
  },
  {
    id: 'issue-tailscale',
    title: 'Tailscale 节点不可达',
    titleEn: 'Tailscale Host Unreachable',
    iconType: 'globe',
    content: '如果使用异地组网，请确保手机端与电脑端的 Tailscale 应用均处于 Connected 状态且属于同一 Tailnet。',
    contentEn: 'Verify both phone and computer Tailscale apps are logged in to the same Tailnet and Connected.',
  },
  {
    id: 'issue-vpn',
    title: '其他 VPN / 代理干扰',
    titleEn: 'Other VPN Interference',
    iconType: 'lock',
    content: '开启全局代理（TUN 模式）可能把 192.168.x.x 局域网私网路由转发至外部节点，导致连接失败。',
    contentEn: 'Global VPN / TUN mode proxies may misroute private 192.168.x.x LAN traffic.',
  },
]

export interface TroubleshootingScreenProps {
  readonly onBack: () => void
  /** Paired desktop connections, exactly as the transport reports them. */
  readonly hosts: readonly HostConnectionSummary[]
  /** Last connection error surfaced by the transport; empty when none. */
  readonly error: string
}

const CONNECTED_STATUSES: readonly ConnectionStatus[] = ['paired', 'reconnecting']

export const TroubleshootingScreen: React.FC<TroubleshootingScreenProps> = ({
  onBack,
  hosts,
  error,
}) => {
  const { language, showNotice } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const connected = hosts.filter((host) => CONNECTED_STATUSES.includes(host.status))

  const statusLabel = (status: ConnectionStatus): string => {
    if (isZh) {
      return {
        paired: '已连接',
        reconnecting: '重连中',
        connecting: '连接中',
        disconnected: '已断开',
        error: '连接错误',
      }[status]
    }
    return {
      paired: 'Connected',
      reconnecting: 'Reconnecting',
      connecting: 'Connecting',
      disconnected: 'Disconnected',
      error: 'Error',
    }[status]
  }

  const handleRunAgain = () => {
    // The phone speaks the relay protocol only; it has no local diagnostics probe.
    showNotice({
      title: isZh ? '网络诊断' : 'Diagnostics',
      message: isZh
        ? '移动端没有本机诊断探针，这里显示的是与桌面端的真实连接状态。'
        : 'This device has no local diagnostics probe; the rows below report the real desktop connection state.',
      type: 'warning',
    })
  }

  const renderIssueIcon = (type: TroubleshootingIssue['iconType']) => {
    switch (type) {
      case 'bell':
        return <Bell className="w-4 h-4 text-zinc-400" />
      case 'wifi-off':
        return <WifiOff className="w-4 h-4 text-zinc-400" />
      case 'shield':
        return <Shield className="w-4 h-4 text-zinc-400" />
      case 'monitor':
        return <Monitor className="w-4 h-4 text-zinc-400" />
      case 'clock':
        return <Clock className="w-4 h-4 text-zinc-400" />
      case 'globe':
        return <Globe className="w-4 h-4 text-zinc-400" />
      case 'lock':
        return <Lock className="w-4 h-4 text-zinc-400" />
      default:
        return <Activity className="w-4 h-4 text-zinc-400" />
    }
  }

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none relative transition-colors duration-200">
      {/* Top Header */}
      <header className="safe-top px-4 pt-3 pb-3 flex items-center gap-2 border-b theme-border">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 -ml-1 text-zinc-400 hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition"
          aria-label={isZh ? '返回设置' : 'Back to Settings'}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-bold tracking-tight theme-text">
          {isZh ? '故障排除' : 'Troubleshooting'}
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-5 overflow-y-auto space-y-4">
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleRunAgain}
            className="w-full py-3 px-4 rounded-2xl bg-zinc-800/80 hover:bg-zinc-700/80 active:scale-[0.99] flex items-center justify-center gap-2 text-xs font-semibold text-white transition border border-zinc-700/50 shadow-sm"
          >
            <RefreshCw className="w-4 h-4 text-zinc-300" />
            <span>{isZh ? '刷新连接状态' : 'Refresh status'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDetailOpen(true)}
            className="w-full py-3 px-4 rounded-2xl bg-zinc-800/80 hover:bg-zinc-700/80 active:scale-[0.99] flex items-center justify-center gap-2 text-xs font-semibold text-white transition border border-zinc-700/50 shadow-sm"
          >
            <FileText className="w-4 h-4 text-zinc-300" />
            <span>{isZh ? '查看连接详情' : 'View connection details'}</span>
          </button>
        </div>

        {/* Live connection state, read from the transport rather than assumed. */}
        <div className="theme-card border rounded-2xl p-4 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              {hosts.length > 0
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
              <span className="font-medium theme-text">
                {isZh ? '配对电脑' : 'Paired hosts'}
              </span>
            </div>
            <span className="theme-muted font-mono">
              {hosts.length > 0 ? `${hosts.length}` : isZh ? '未配对' : 'None'}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              {connected.length > 0
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
              <span className="font-medium theme-text">
                {isZh ? '连接状态' : 'Connection'}
              </span>
            </div>
            <span className="theme-muted font-mono">
              {connected.length > 0
                ? `${connected.length}/${hosts.length}`
                : isZh ? '未连接' : 'Offline'}
            </span>
          </div>

          {hosts.map((host) => (
            <div key={host.hostId} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {CONNECTED_STATUSES.includes(host.status)
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
                <span className="font-medium theme-text truncate">{host.name}</span>
              </div>
              <span className="theme-muted font-mono text-[11px] truncate max-w-[150px] text-right">
                {statusLabel(host.status)} · {host.transport === 'relay' ? 'Relay' : 'LAN'}
              </span>
            </div>
          ))}

          {error !== '' && (
            <div className="flex items-start gap-2.5 text-xs pt-1 border-t theme-border">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="theme-muted break-all">{error}</span>
            </div>
          )}
        </div>

        {/* Section: COMMON ISSUES */}
        <section className="space-y-2 pt-2">
          <div className="px-0.5">
            <h2 className="text-[11px] font-semibold theme-muted tracking-wider uppercase">
              {isZh ? '常见问题排查' : 'COMMON ISSUES'}
            </h2>
          </div>

          <div className="theme-card border rounded-2xl overflow-hidden divide-y divide-[var(--border-line)] shadow-sm">
            {ISSUES.map((issue) => {
              const isExpanded = expandedIssueId === issue.id

              return (
                <div key={issue.id} className="transition-colors">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedIssueId(isExpanded ? null : issue.id)
                    }
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-white/[0.02] active:bg-white/[0.04] transition"
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <span className="shrink-0">
                        {renderIssueIcon(issue.iconType)}
                      </span>
                      <span className="text-xs font-semibold theme-text truncate">
                        {isZh ? issue.title : issue.titleEn}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 theme-muted shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 theme-muted shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 text-[11px] theme-muted leading-relaxed pl-10 animate-fade-in">
                      <p>{isZh ? issue.content : issue.contentEn}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </main>

      {/* Connection detail: the exact endpoint each host is dialed at. */}
      {isDetailOpen && (
        <>
          <div
            role="presentation"
            onClick={() => setIsDetailOpen(false)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-fade-in"
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 theme-card border-t theme-border rounded-t-3xl max-h-[85vh] p-5 safe-bottom animate-slide-up shadow-2xl flex flex-col">
            <div className="w-10 h-1 bg-zinc-600/50 rounded-full mx-auto shrink-0 mb-3" />
            <div className="flex items-center justify-between pb-3 border-b theme-border shrink-0">
              <h3 className="text-sm font-bold theme-text">
                {isZh ? '连接详情' : 'Connection Details'}
              </h3>
              <button
                type="button"
                onClick={() => setIsDetailOpen(false)}
                className="p-1 theme-muted hover:theme-text rounded-full"
                aria-label={isZh ? '关闭' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto mt-3 p-3 bg-black/40 border theme-border rounded-xl font-mono text-[11px] text-zinc-300 space-y-2 leading-relaxed">
              {hosts.length === 0 && (
                <p className="text-zinc-500">
                  {isZh ? '尚未配对任何电脑。' : 'No desktop is paired yet.'}
                </p>
              )}
              {hosts.map((host) => (
                <div key={host.hostId} className="space-y-1">
                  <p className="text-zinc-100">{host.name} · {host.os}</p>
                  <p className="text-zinc-400">
                    {isZh ? '状态' : 'status'}: {statusLabel(host.status)}
                  </p>
                  <p className="text-zinc-400 break-all">
                    {isZh ? '传输' : 'transport'}: {host.transport === 'relay' ? 'relay' : 'direct LAN'}
                  </p>
                  <p className="text-zinc-400 break-all">
                    {isZh ? '端点' : 'endpoint'}: {host.endpoint}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
