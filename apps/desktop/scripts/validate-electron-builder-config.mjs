/** Reject invalid installer options before building Desktop resources. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { validateSchema } from 'app-builder-lib/out/util/config/schemaValidator.js'

const require = createRequire(import.meta.url)
const schema = JSON.parse(readFileSync(require.resolve('app-builder-lib/scheme.json'), 'utf8'))

/**
 * Validate all platform sections using the installed electron-builder schema.
 * @param {unknown} config - Configuration returned by the Desktop factory.
 * @returns {void}
 * @throws {Error} When the installed schema rejects a configuration field.
 */
export function validateDesktopElectronBuilderConfig(config) {
  validateSchema(schema, config, { name: 'electron-builder' })
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const { default: config } = await import('../electron-builder.config.mjs')
  validateDesktopElectronBuilderConfig(config)
  console.log('desktop package: electron-builder configuration validated')
}
