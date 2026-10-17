import React, { useState } from 'react'
import { ChevronLeft, Clipboard } from 'lucide-react'
import { useAppConfig } from '../../context/ThemeLanguageContext'
import { EnableNotificationModal } from '../../components/EnableNotificationModal'
import { CinlanLogo } from '../../components/CinlanLogo'

export interface ManualPairScreenProps {
  readonly onPairSuccess: (code: string) => void
  readonly onBack: () => void
  readonly onOpenSettings?: () => void
  readonly initialCode?: string
}

export const ManualPairScreen: React.FC<ManualPairScreenProps> = ({
  onPairSuccess,
  onBack,
  initialCode = '',
}) => {
  const { language, showNotice, t } = useAppConfig()
  const isZh = language === 'zh-CN'

  // Code state
  const [code, setCode] = useState(initialCode)
  // Drawer state (Figure 2)
  const [isDrawerOpen, setIsDrawerOpen] = useState(initialCode !== '')
  // Notification permission state & modal
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false)
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false)
  const [pendingCodeToConnect, setPendingCodeToConnect] = useState<string | null>(null)

  const handleOpenDrawer = () => {
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
  }

  const handleOpenSystemSettings = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        for (const track of stream.getTracks()) track.stop()
        showNotice({
          title: isZh ? '相机权限' : 'Camera Access',
          message: isZh ? '相机权限已成功获取！' : 'Camera permission granted!',
          type: 'success',
        })
        return
      }
    } catch (_cameraDenied) { /* The notice below reports permission failure. */ }
    showNotice({
      title: isZh ? '系统权限设置' : 'System Permissions',
      message: isZh
        ? '请在手机“系统设置”或浏览器地址栏的“网站设置”中允许相机权限。'
        : 'Please allow camera permission in device system settings or browser site settings.',
      type: 'warning',
    })
  }

  const handleSaveAndConnect = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const targetCode = code.trim()
    if (!targetCode) return

    // 4. 判断用户是否已打开通知，未打开才弹窗显示启用通知组件
    // 已开启则直接配对连接
    setIsDrawerOpen(false)
    onPairSuccess(targetCode)
  }

  const handleNotificationEnable = () => {
    setHasNotificationPermission(true)
    setIsNotificationModalOpen(false)
    const targetCode = pendingCodeToConnect || code.trim()
    setIsDrawerOpen(false)
    onPairSuccess(targetCode)
  }

  const handleNotificationSkip = () => {
    setIsNotificationModalOpen(false)
    const targetCode = pendingCodeToConnect || code.trim()
    setIsDrawerOpen(false)
    onPairSuccess(targetCode)
  }

  return (
    <div className="flex flex-col min-h-screen theme-bg theme-text select-none relative transition-colors duration-200">
      {/* 顶部返回栏 */}
      <header className="safe-top px-4 pt-3 pb-2 flex items-center justify-between z-10">
        <button
          type="button"
          onClick={onBack}
          className="p-1 -ml-1 text-zinc-400 hover:theme-text rounded-full hover:bg-zinc-800/40 active:scale-95 transition"
          aria-label={isZh ? '返回工作区' : 'Back to Workspace'}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <CinlanLogo className="w-6 h-5 text-blue-400" />
          <span className="text-sm font-semibold theme-text">{t('brand.name')}</span>
        </div>
        <div className="w-6" />
      </header>

      {/* 主体：上下居中 (图 1) */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center -mt-12 z-0">
        <h1 className="text-xl font-bold tracking-tight theme-text">
          {isZh ? '相机权限已禁用' : 'Camera Access Disabled'}
        </h1>
        <p className="text-xs theme-muted max-w-[280px] mt-2.5 leading-relaxed">
          {isZh
            ? '在设置中启用相机访问权限，或改为粘贴配对码。'
            : 'Enable camera access in Settings, or paste the pairing code instead.'}
        </p>

        {/* 打开系统设置按钮 (打开本机系统设置，而非应用内部设置) */}
        <button
          type="button"
          onClick={handleOpenSystemSettings}
          className="mt-6 px-7 py-2.5 rounded-xl theme-btn-primary active:scale-95 font-semibold text-xs tracking-tight shadow-sm transition"
        >
          {isZh ? '打开设置' : 'Open Settings'}
        </button>

        {/* 改为粘贴配对码 / 使用配对码连接 */}
        <button
          type="button"
          onClick={handleOpenDrawer}
          className="mt-5 flex items-center justify-center gap-2 text-xs theme-muted hover:theme-text cursor-pointer active:opacity-75 transition py-1"
        >
          <Clipboard className="w-4 h-4 theme-muted" />
          <span>{isZh ? '使用配对码连接' : 'Paste code instead'}</span>
        </button>
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
            aria-labelledby="paste-pairing-code-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom animate-slide-up"
          >
            {/* 顶部手柄 */}
            <div className="w-10 h-1 rounded-full theme-drag-handle mx-auto" />

            {/* 标题与说明 */}
            <div className="space-y-1">
              <h2
                id="paste-pairing-code-title"
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

            {/* 配对码输入区域：确保固定宽与 box-border，杜绝输入时缩水抖动 */}
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

              {/* 底部操作行：取消 + 保存并连接 */}
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

      {/* 4. 独立通知权限引导组件 */}
      <EnableNotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        onEnable={handleNotificationEnable}
        onSkip={handleNotificationSkip}
      />
    </div>
  )
}
