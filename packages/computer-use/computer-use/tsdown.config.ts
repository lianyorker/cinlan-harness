import { defineConfig } from 'tsdown'

/** Emit the service and its dependency-free provider-name brand as separate bundles. */
export default ['index', 'brand'].map(entry => defineConfig({
  entry: 'lib/types/' + entry + '.js',
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))
