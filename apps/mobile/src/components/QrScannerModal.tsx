import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScanner } from 'html5-qrcode'
import { X, QrCode, Clipboard, AlertCircle } from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

interface QrScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScanSuccess: (decodedText: string) => void
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'
  const [manualCode, setManualCode] = useState('')
  const [cameraError, setCameraError] = useState('')
  const scannerRef = useRef<Html5QrcodeScanner | null>(null)
  const fileScannerRef = useRef<Html5Qrcode | null>(null)

  useEffect(() => {
    if (!isOpen) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {})
        scannerRef.current = null
      }
      if (fileScannerRef.current) {
        try { fileScannerRef.current.clear() } catch (_scannerClosed) { /* Scanner is already stopped. */ }
        fileScannerRef.current = null
      }
      return
    }

    setCameraError('')

    const timer = setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          'qr-reader-container',
          {
            fps: 10,
            qrbox: { width: 220, height: 220 },
            aspectRatio: 1.0,
            showTorchButtonIfSupported: true,
          },
          false,
        )

        scanner.render(
          (decodedText) => {
            scanner.clear().catch(() => {})
            scannerRef.current = null
            onScanSuccess(decodedText)
          },
          () => {},
        )

        scannerRef.current = scanner
      } catch {
        setCameraError(isZh ? '无法打开摄像头，请授权相机权限或使用手动粘贴配对码' : 'Camera inaccessible. Please grant permission or paste code.')
      }
    }, 150)

    return () => {
      clearTimeout(timer)
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {})
        scannerRef.current = null
      }
      if (fileScannerRef.current) {
        try { fileScannerRef.current.clear() } catch (_scannerClosed) { /* Scanner is already stopped. */ }
        fileScannerRef.current = null
      }
    }
  }, [isOpen, isZh, onScanSuccess])

  if (!isOpen) return null

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualCode.trim()) return
    onScanSuccess(manualCode.trim())
  }

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setManualCode(text)
        onScanSuccess(text)
      }
    } catch {}
  }

  const handleImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      setCameraError('')
      const scanner = new Html5Qrcode('qr-file-reader')
      fileScannerRef.current = scanner
      const decoded = await scanner.scanFile(file, true)
      await scanner.clear()
      fileScannerRef.current = null
      onScanSuccess(decoded)
    } catch (_fileScanFailed) {
      try { fileScannerRef.current?.clear() } catch (_scannerClosed) { /* Scanner is already stopped. */ }
      fileScannerRef.current = null
      setCameraError(isZh ? '图片中未识别到有效二维码，请重新选择清晰的二维码图片。' : 'No valid QR code found in that image.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in safe-top safe-bottom">
      <div className="theme-card border rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b theme-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-blue-600/20 text-blue-400">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold theme-text">{isZh ? '配对桌面端' : 'Pair Desktop'}</h3>
              <p className="text-[10px] theme-muted">{isZh ? '扫描桌面设置中的二维码' : 'Scan QR code in desktop settings'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl theme-muted hover:theme-text hover:bg-zinc-800/30 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scanner Viewport */}
        <div className="p-4 flex flex-col items-center">
          <div
            id="qr-reader-container"
            className="w-full rounded-2xl overflow-hidden bg-black/60 border theme-border text-xs theme-muted"
            style={{ minHeight: '260px' }}
          />

          {cameraError && (
            <div className="mt-3 p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-xl text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* Manual paste option */}
          <div className="w-full mt-4 pt-4 border-t theme-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] theme-muted font-medium">{isZh ? '或直接粘贴配对码 / PIN' : 'Or paste pairing code'}</span>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Clipboard className="w-3 h-3" />
                {isZh ? '粘贴剪贴板' : 'Paste clipboard'}
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="orca://pair?code=..."
                className="flex-1 px-3 py-2 theme-card-subtle border rounded-xl text-xs theme-text placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold"
              >
                {isZh ? '配对' : 'Pair'}
              </button>
            </form>
            <div className="pt-1">
              <input id="qr-file-input" type="file" accept="image/*" className="sr-only" onChange={(event) => { void handleImageSelected(event) }} />
              <label htmlFor="qr-file-input" className="block w-full text-center px-3 py-2 theme-card-subtle border theme-border rounded-xl text-[11px] theme-muted hover:theme-text cursor-pointer transition">
                {isZh ? '从图片读取二维码' : 'Read QR from image'}
              </label>
              <div id="qr-file-reader" className="hidden" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
