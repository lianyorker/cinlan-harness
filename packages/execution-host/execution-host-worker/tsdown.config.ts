import { defineConfig } from 'tsdown'

/** Emit every public worker entry and keep their shared protocol implementation in published chunks. */
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    protocol: 'lib/types/protocol.js',
    types: 'lib/types/types.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { chunkFileNames: 'chunks/[name]-[hash].js' },
  dts: false,
  clean: false,
})
