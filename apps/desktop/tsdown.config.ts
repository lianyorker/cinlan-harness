import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const themeRoot = new URL('../../packages/client/ui-theme/src/styles/', import.meta.url)
const theme = ['base.css', 'design-platform.css'].map(file => readFileSync(new URL(file, themeRoot), 'utf8')).join('\n')

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    define: { __DSH_DESKTOP_THEME_CSS__: JSON.stringify(theme) },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    // Electron reads this self-contained CJS bundle from ASAR and supplies it to Worker(eval: true).
    entry: { 'startup-worker': 'lib/types/startup-worker.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { alwaysBundle: [/.*/] },
  },
  // Sandboxed preloads cannot require relative chunks; compile each entry independently.
  ...['preload', 'preload-app', 'preload-mandatory', 'preload-update-dialog'].map(entry => ({
    entry: { [entry]: `lib/types/${entry}.js` },
    outDir: 'lib',
    format: ['cjs' as const],
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  })),
])
