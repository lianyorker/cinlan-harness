import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: {
    '@cinlan/mobile-relay/protocol': fileURLToPath(new URL('../mobile-relay/src/mobile-protocol.ts', import.meta.url)),
    '@cinlan/mobile-relay/crypto': fileURLToPath(new URL('../mobile-relay/src/crypto.ts', import.meta.url)),
    '@deepseek-ai/dsh-brand': fileURLToPath(new URL('../../packages/util/brand/src/index.ts', import.meta.url)),
    '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../../packages/client/ui-primitives/src/index.ts', import.meta.url)),
    '@deepseek-ai/dsh-util-code-language': fileURLToPath(new URL('../../packages/util/code-language/src/index.ts', import.meta.url)),
    '@deepseek-ai/dsh-util-workspace-path': fileURLToPath(new URL('../../packages/util/workspace-path/src/index.ts', import.meta.url)),
    '@deepseek-ai/dsh-client-store': fileURLToPath(new URL('../../packages/client/store/src/index.ts', import.meta.url)),
  } },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces for easy phone access
    port: 5173
  }
})
