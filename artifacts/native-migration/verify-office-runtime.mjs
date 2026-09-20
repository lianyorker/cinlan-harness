/** Verify the prepared Windows payload and its relocated installation without changing user state. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installPrimaryRuntime } from '../../apps/desktop-host/src/primary-runtime.ts'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const source = join(repo, 'apps/desktop/.desktop-build/targets/win-x64/runtime/primary-runtime')
const destination = join(repo, 'apps/desktop/.desktop-build/office-acceptance/home/dsh-runtimes/dsh-primary-runtime')
const cache = join(repo, 'apps/desktop/.desktop-build/downloads')
const lock = JSON.parse(await readFile(join(repo, 'apps/desktop/scripts/primary-runtime-lock.json'), 'utf8'))
const manifest = JSON.parse(await readFile(join(source, 'runtime.json'), 'utf8'))
const target = lock.targets['win-x64']
const hashes = [target.nodeSha256, target.pythonSha256, ...target.wheels.map(wheel => wheel.sha256), ...lock.wheels.map(wheel => wheel.sha256)]
const archives = []
for (const expected of hashes) {
  const bytes = await readFile(join(cache, expected))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`Archive checksum mismatch: ${expected}`)
  archives.push({ sha256: actual, bytes: bytes.length })
}
await mkdir(dirname(destination), { recursive: true })
const paths = await installPrimaryRuntime(source, destination)
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 120_000, env: process.env }).trim()
const pythonVersion = run(paths.python, ['-I', '-c', 'import sys; print(sys.version)'])
const nodeVersion = run(paths.node, ['--version'])
const pnpmVersion = run(paths.node, [paths.pnpm, '--version'])
const smoke = run(paths.python, ['-I', '-B', join(repo, 'apps/desktop/scripts/smoke-primary-runtime.py'),
  JSON.stringify(manifest.pythonPackages), manifest.components.python,
  join(dirname(source), 'office-skills/scripts/check_office.py')])
const pipCheck = run(paths.python, ['-I', '-B', '-m', 'pip', 'check'])
async function inventory(root) {
  let files = 0, bytes = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) { const nested = await inventory(path); files += nested.files; bytes += nested.bytes }
    else if (entry.isFile()) { files += 1; bytes += (await stat(path)).size }
  }
  return { files, bytes }
}
const interpreters = {}
for (const name of ['python', 'node', 'pnpm']) {
  const bytes = await readFile(paths[name])
  interpreters[name] = { path: paths[name], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}
console.log(JSON.stringify({ target: 'win-x64', source, destination, manifest, archives,
  payload: await inventory(source), installed: await inventory(destination), interpreters,
  pythonVersion, nodeVersion, pnpmVersion, smoke, pipCheck, actualSigningVerified: false,
  visualInspectionPerformed: false, excelFormulaRecalculationPerformed: false }, null, 2))
