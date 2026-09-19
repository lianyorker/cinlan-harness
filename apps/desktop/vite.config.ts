/** Bundle only the shared loading view and its styles for the sandboxed Desktop renderer. */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'lib/renderer',
    lib: {
      entry: fileURLToPath(new URL('./lib/types/startup-renderer-entry.js', import.meta.url)),
      formats: ['es'],
      fileName: 'loading',
      cssFileName: 'loading',
    },
  },
})
