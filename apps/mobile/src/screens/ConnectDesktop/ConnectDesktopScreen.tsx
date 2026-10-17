import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Clipboard } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import { EnableNotificationModal } from '../../components/EnableNotificationModal'
import { QrScannerModal } from '../../components/QrScannerModal'
import { CinlanLogo } from '../../components/CinlanLogo'

type CameraPermissionState = 'checking' | 'granted' | 'denied' | 'unsupported'

interface CinlanNativeBridge {
  openAppSettings?: () => void
}

// 相机 API 仅在安全上下文（HTTPS 或 localhost）下可用；
// 手机通过局域网 HTTP IP 访问时 navigator.mediaDevices 不存在
const isCameraApiAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext !== false &&
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

// 查询相机权限：优先 Permissions API，不支持时视为未授权（由按钮触发 getUserMedia 探测）
const queryCameraPermission = async (): Promise<CameraPermissionState> => {
  if (!isCameraApiAvailable()) return 'unsupported'
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
      if (status.state === 'granted') return 'granted'
      if (status.state === 'denied') return 'denied'
    }
  } catch {}
  return 'denied'
}

export interface ConnectDesktopScreenProps {
  readonly onStartPairing: () => void
  readonly onOpenManualPair: () => void
  readonly onOpenSettings: () => void
  readonly onBack?: () => void
  readonly onPairSuccess?: (code: string) => void
  readonly onSimulateConnect?: () => void
}

export const ConnectDesktopScreen: React.FC<ConnectDesktopScreenProps> = ({
  onStartPairing,
  onOpenManualPair,
  onOpenSettings,
  onBack,
  onPairSuccess,
  onSimulateConnect,
}) => {
  const { language, showNotice, t } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [code, setCode] = useState('')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false)
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false)
  const [cameraPermission, setCameraPermission] = useState<CameraPermissionState>('checking')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const prevPermissionRef = useRef<CameraPermissionState>('checking')

  // 检测相机权限；从『未授权 → 已授权』跃迁时自动打开内置扫码器
  const refreshCameraPermission = useCallback(async () => {
    const state = await queryCameraPermission()
    if (state === 'granted' && prevPermissionRef.current !== 'granted') {
      setIsScannerOpen(true)
    }
    prevPermissionRef.current = state
    setCameraPermission(state)
  }, [])

  useEffect(() => {
    void refreshCameraPermission()
    // 用户从系统设置返回时自动重新检测
    const recheck = () => {
      if (document.visibilityState === 'visible') void refreshCameraPermission()
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [refreshCameraPermission])

  const handleOpenDrawer = () => {
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
  }

  const handleOpenSystemSettings = async () => {
    // 非安全上下文（HTTP 局域网 IP）：相机 API 不可用，提示改用 HTTPS
    if (!isCameraApiAvailable()) {
      showNotice({
        title: isZh ? '无法调用相机' : 'Camera Unavailable',
        message: isZh
          ? '浏览器仅在 HTTPS 或 localhost 下开放相机。请通过 HTTPS 访问本页，或改用配对码连接。'
          : 'Camera is only available over HTTPS or localhost. Access via HTTPS or use a pairing code.',
        type: 'warning',
      })
      return
    }
    // 原生壳（Capacitor 等）注入的桥：直接跳系统设置页
    const nativeBridge = (window as { CinlanNative?: CinlanNativeBridge }).CinlanNative
    if (typeof nativeBridge?.openAppSettings === 'function') {
      nativeBridge.openAppSettings()
      return
    }
    // Web 环境：重新发起相机授权；浏览器未永久拒绝时会弹出授权框
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((track) => track.stop())
      prevPermissionRef.current = 'denied'
      setCameraPermission('granted')
      setIsScannerOpen(true)
      showNotice({
        title: isZh ? '相机权限' : 'Camera Access',
        message: isZh ? '相机权限已成功获取！' : 'Camera permission granted!',
        type: 'success',
      })
      return
    } catch {}
    showNotice({
      title: isZh ? '系统权限设置' : 'System Permissions',
      message: isZh
        ? '请在手机“系统设置”或浏览器地址栏的“网站设置”中允许相机权限。'
        : 'Please allow camera permission in device system settings or browser site settings.',
      type: 'warning',
    })
  }

  const handleScanSuccess = (value: string) => {
    setIsScannerOpen(false)
    if (onPairSuccess) {
      onPairSuccess(value)
    } else {
      onStartPairing?.()
    }
  }

  const handleSaveAndConnect = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!hasNotificationPermission) {
      setIsNotificationModalOpen(true)
      return
    }
    finishConnection()
  }

  const finishConnection = () => {
    setIsDrawerOpen(false)
    const targetCode = code.trim()
    if (!targetCode) return
    if (onPairSuccess) {
      onPairSuccess(targetCode)
    } else if (onSimulateConnect) {
      onSimulateConnect()
    } else {
      onOpenManualPair()
    }
  }

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none relative transition-colors duration-200">
      {/* 顶部栏：仅在配对电脑时有返回，断开连接时无返回亦无设置 */}
      <header className="safe-top px-4 pt-3 pb-2 flex items-center justify-between z-10 min-h-[44px]">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="p-1 -ml-1 text-zinc-400 hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition"
            aria-label={isZh ? '返回工作区' : 'Back to Workspace'}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        ) : (
          <div className="w-6" />
        )}
        <div className="flex items-center gap-2">
          <CinlanLogo className="w-6 h-5 text-blue-400" />
          <span className="text-sm font-semibold theme-text">{t('brand.name')}</span>
        </div>
        <div className="w-6" />
      </header>

      {/* 主体：上下居中 (图 1) */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center -mt-12 z-0">
        {cameraPermission === 'checking' ? (
          <p className="text-xs theme-muted">{isZh ? '正在检查相机权限…' : 'Checking camera permission…'}</p>
        ) : cameraPermission === 'granted' ? (
          <>
            <h1 className="text-xl font-bold tracking-tight theme-text">
              {isZh ? '扫描二维码' : 'Scan QR Code'}
            </h1>
            <p className="text-xs theme-muted max-w-[280px] mt-2.5 leading-relaxed">
              {isZh
                ? '将相机对准电脑端“设置 -> 移动端”中的配对二维码。'
                : 'Point the camera at the pairing QR code in desktop settings.'}
            </p>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="mt-6 px-7 py-2.5 rounded-xl theme-btn-primary active:scale-95 font-semibold text-xs tracking-tight shadow-sm transition"
            >
              {isZh ? '打开扫码器' : 'Open Scanner'}
            </button>
          </>
        ) : cameraPermission === 'unsupported' ? (
          <>
            <h1 className="text-xl font-bold tracking-tight theme-text">
              {isZh ? '当前环境无法调用相机' : 'Camera Unavailable'}
            </h1>
            <p className="text-xs theme-muted max-w-[280px] mt-2.5 leading-relaxed">
              {isZh
                ? '浏览器仅在 HTTPS 或 localhost 下开放相机。当前页面通过 HTTP 访问，请改用 HTTPS 地址或粘贴配对码。'
                : 'Camera requires HTTPS or localhost. This page is served over HTTP — use an HTTPS URL or paste the pairing code.'}
            </p>
            <button
              type="button"
              onClick={() => void refreshCameraPermission()}
              className="mt-6 px-7 py-2.5 rounded-xl theme-btn-primary active:scale-95 font-semibold text-xs tracking-tight shadow-sm transition"
            >
              {isZh ? '重新检测' : 'Retry'}
            </button>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="mt-3 px-7 py-2.5 rounded-xl theme-card-subtle border theme-border active:scale-95 font-semibold text-xs tracking-tight transition"
            >
              {isZh ? '从图片读取二维码' : 'Read QR from image'}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold tracking-tight theme-text">
              {isZh ? '相机权限已禁用' : 'Camera Access Disabled'}
            </h1>
            <p className="text-xs theme-muted max-w-[280px] mt-2.5 leading-relaxed">
              {isZh
                ? '在设置中启用相机访问权限，或改为粘贴配对码。'
                : 'Enable camera access in Settings, or paste the pairing code instead.'}
            </p>

            {/* 打开系统设置按钮 (打开本机设置，而非应用内部设置) */}
            <button
              type="button"
              onClick={handleOpenSystemSettings}
              className="mt-6 px-7 py-2.5 rounded-xl theme-btn-primary active:scale-95 font-semibold text-xs tracking-tight shadow-sm transition"
            >
              {isZh ? '打开设置' : 'Open Settings'}
            </button>
          </>
        )}

        {/* 使用配对码连接 */}
        <button
          type="button"
          onClick={handleOpenDrawer}
          className="mt-5 flex items-center justify-center gap-2 text-xs theme-muted hover:theme-text cursor-pointer active:opacity-75 transition py-1"
        >
          <Clipboard className="w-4 h-4 theme-muted" />
          <span>{isZh ? '使用配对码连接' : 'Paste code instead'}</span>
        </button>

        {onSimulateConnect && (
          <div className="mt-8">
            <button
              type="button"
              onClick={onSimulateConnect}
              className="text-[11px] theme-muted hover:theme-text underline transition"
            >
              {isZh ? '(直接进入工作台)' : '(Enter Dashboard)'}
            </button>
          </div>
        )}
      </main>

      {/* 底部抽屉：粘贴配对码 (图 2) */}
      {isDrawerOpen && (
        <div
          role="presentation"
          onClick={handleCloseDrawer}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="paste-code-dialog-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
          >
            {/* 顶部手柄 */}
            <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

            {/* 标题与说明 */}
            <div className="space-y-1">
              <h2
                id="paste-code-dialog-title"
                className="text-base font-bold theme-text tracking-tight"
              >
                {isZh ? '粘贴配对码' : 'Paste pairing code'}
              </h2>
              <p className="text-xs theme-muted leading-relaxed">
                {isZh
                  ? '复制电脑端二维码下方显示的配对码。'
                  : 'Copy the code shown under the QR on your computer.'}
              </p>
            </div>

            {/* 输入框：固定宽与 box-border */}
            <form onSubmit={handleSaveAndConnect} className="space-y-4 pt-1">
              <div className="w-full box-border min-w-0 max-w-full">
                <input
                  type="text"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={
                    isZh
                      ? '输入或粘贴配对码...'
                      : 'Paste pairing code here...'
                  }
                  className="w-full box-border min-w-0 px-3.5 py-3 rounded-xl theme-card-subtle border theme-border text-xs font-mono theme-text placeholder-zinc-500 focus:outline-none focus:border-zinc-400 transition"
                />
              </div>

              {/* 底部操作行 */}
              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  className="px-4 py-2 text-xs font-medium theme-muted hover:theme-text active:scale-95 transition"
                >
                  {isZh ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={!code.trim()}
                  className="px-6 py-2.5 rounded-xl theme-btn-primary disabled:opacity-40 font-semibold text-xs shadow active:scale-95 transition"
                >
                  {isZh ? '保存并连接' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 内置扫码器：相机权限已授权时可用，扫描电脑端配对二维码 */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleScanSuccess}
      />

      {/* 4. 独立通知权限引导组件 */}
      <EnableNotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        onEnable={() => {
          setHasNotificationPermission(true)
          setIsNotificationModalOpen(false)
          finishConnection()
        }}
        onSkip={() => {
          setIsNotificationModalOpen(false)
          finishConnection()
        }}
      />
    </div>
  )
}
