import { defineConfig } from 'tsdown'

export default defineConfig({
  name: '@deepseek-ai/dsh-tool-ralph',
  entry: ['lib/types/index.js', 'lib/types/settings.js'],
  outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false,
  clean: false, dts: false,
})
