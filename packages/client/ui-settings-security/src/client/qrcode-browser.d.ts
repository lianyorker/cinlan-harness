/** Browser build of the bundled `qrcode` dependency; only the SVG projection is consumed. */
declare module 'qrcode/lib/browser.js' {
  /** Render one QR code as an SVG document string. */
  export function toString(
    text: string,
    options?: {
      readonly type?: 'svg'
      readonly margin?: number
      readonly width?: number
      readonly errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    },
  ): Promise<string>
}
