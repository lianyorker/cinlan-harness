/** Check the shell dependency selection before preparing Desktop release resources. */
import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8'))

/**
 * Reject pnpm output that selects other projects or omits direct shell dependencies.
 * @param {unknown} tree - Parsed production dependency listing from pnpm.
 * @returns {void}
 * @throws {Error} When the listing does not select the Desktop package and its required roots.
 */
export function assertDesktopDependencySelection(tree) {
  const root = Array.isArray(tree) && tree.length === 1 ? tree[0] : undefined
  if (root?.name !== manifest.name || typeof root.path !== 'string' || relative(APP_ROOT, root.path) !== '') {
    throw new Error(`desktop package: dependency listing must select only ${manifest.name} at ${APP_ROOT}`)
  }
  const missing = Object.keys(manifest.dependencies).filter(name => root.dependencies?.[name] === undefined)
  if (missing.length > 0) {
    throw new Error(`desktop package: dependency listing is missing ${missing.join(', ')}`)
  }
}

function main() {
  const pnpmEntry = process.env.npm_execpath
  if (pnpmEntry === undefined || pnpmEntry === '') {
    throw new Error('desktop package: invoke dependency validation through a pnpm package command')
  }
  const { root } = resolveDesktopTargetBuildPaths()
  mkdirSync(root, { recursive: true })
  const outputPath = join(root, 'electron-builder-dependencies.json')
  console.log(`desktop package: checking shell dependency selection; output: ${outputPath}`)
  const output = openSync(outputPath, 'w', 0o600)
  let result
  try {
    result = spawnSync(process.execPath, [pnpmEntry, 'list', '--prod', '--json', '--depth', 'Infinity', '--silent', '--loglevel=error'], {
      cwd: APP_ROOT,
      env: process.env,
      stdio: ['ignore', output, 'inherit'],
    })
  } finally {
    closeSync(output)
  }
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`desktop package: dependency listing exited with ${String(result.status ?? result.signal)}; see ${outputPath}`)
  }
  assertDesktopDependencySelection(JSON.parse(readFileSync(outputPath, 'utf8')))
  console.log(`desktop package: shell dependency selection validated for ${manifest.name}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
