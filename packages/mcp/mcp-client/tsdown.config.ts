import { defineConfig } from 'tsdown'

/** Bundle the emitted public entries together to preserve shared runtime identities. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/registry.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
