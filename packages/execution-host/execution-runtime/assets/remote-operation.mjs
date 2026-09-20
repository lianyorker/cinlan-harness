/** One-shot authenticated installer supervisor; no installed Harness helper is needed to run it. */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, chmod } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'

const lifetime = new AbortController()
const lines = []
let waiter
let pending = ''
let received = 0
process.stdin.setEncoding('utf8')
process.stdin.on('data', data => {
  received += Buffer.byteLength(data)
  if (received > 64 * 1024) { lifetime.abort(new Error('Installer request exceeds limit')); return }
  pending += data
  let end
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1)
    if (waiter) { const resolve = waiter; waiter = undefined; resolve(line) }
    else lines.push(line)
  }
})
process.stdin.on('end', () => { lifetime.abort(new Error('Installer controller disconnected')) })
process.stdin.on('error', error => { lifetime.abort(error) })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { lifetime.abort(new Error('Installer cancelled')) })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const output = value => process.stdout.write(JSON.stringify(value) + '\n')
const inside = (root, path) => path === root || path.startsWith(root + sep)
async function nextLine() {
  lifetime.signal.throwIfAborted()
  if (lines.length) return lines.shift()
  return await new Promise((resolve, reject) => {
    const abort = () => { waiter = undefined; reject(lifetime.signal.reason) }
    lifetime.signal.addEventListener('abort', abort, { once: true })
    waiter = line => { lifetime.signal.removeEventListener('abort', abort); resolve(line) }
  })
}
async function ownedDirectory(path) {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Installation directory must be a real directory')
  if (typeof process.getuid === 'function' && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
    throw new Error('Installation directory must be private and owned by the SSH account')
  }
  if (await realpath(path) !== path) throw new Error('Installation directory must not contain symlinks')
}
async function scan(root, prefix = '') {
  const paths = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) paths.push(...await scan(root, path))
    else if (entry.isFile()) paths.push(path)
    else throw new Error('Runtime contains a non-regular file: ' + path)
  }
  return paths.sort()
}
async function verifyTree(directory, input) {
  await ownedDirectory(directory)
  const manifestPath = join(directory, 'runtime-manifest.json')
  const info = await lstat(manifestPath)
  if (!info.isFile() || info.size > input.limits.maxManifestBytes) throw new Error('Invalid runtime manifest file')
  const bytes = await readFile(manifestPath)
  if (bytes.length > input.limits.maxManifestBytes || hash(bytes) !== input.generation) throw new Error('Runtime manifest digest mismatch')
  const manifest = JSON.parse(bytes)
  if (manifest.schemaVersion !== 1 || manifest.protocol !== 1 || !Array.isArray(manifest.files)
      || manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('Runtime manifest is incompatible with this Node platform')
  if (manifest.files.length > input.limits.maxFiles) throw new Error('Too many runtime files')
  const expected = new Map()
  let total = 0
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !file.path || file.path.includes('\\') || isAbsolute(file.path)
        || file.path.split('/').some(part => part === '..' || part === '.' || !part)
        || file.path === 'runtime-manifest.json' || expected.has(file.path)) throw new Error('Invalid runtime file path')
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > input.limits.maxFileBytes
        || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('Invalid runtime file metadata')
    total += file.size
    if (total > input.limits.maxTotalBytes) throw new Error('Runtime exceeds transfer limit')
    const path = join(directory, file.path)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) throw new Error('Missing or changed runtime file: ' + file.path)
    if (hash(await readFile(path)) !== file.sha256) throw new Error('Runtime file digest mismatch: ' + file.path)
    expected.set(file.path, file)
  }
  const files = await scan(directory)
  if (JSON.stringify(files) !== JSON.stringify([...expected.keys(), 'runtime-manifest.json'].sort())) throw new Error('Runtime inventory contains missing or unlisted files')
  for (const entry of [manifest.helper, manifest.bootstrap, 'package.json']) {
    if (!expected.has(entry)) throw new Error('Runtime helper, PTC bootstrap and package manifest are required')
  }
  // Every installed package's runtime edges must resolve inside the immutable generation.
  for (const path of expected.keys()) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) continue
    const filename = join(directory, path)
    const pkg = JSON.parse(await readFile(filename, 'utf8'))
    const required = { ...pkg.dependencies, ...pkg.peerDependencies }
    for (const name of Object.keys(required)) {
      let cursor = dirname(filename)
      let found = false
      while (inside(directory, cursor)) {
        const dependency = join(cursor, 'node_modules', name, 'package.json')
        try {
          const resolved = await realpath(dependency)
          if (!inside(directory, resolved)) throw new Error('Runtime dependency escapes generation: ' + name)
          found = true; break
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
        }
        if (cursor === directory) break
        cursor = dirname(cursor)
      }
      if (!found && pkg.peerDependenciesMeta?.[name]?.optional !== true) throw new Error('Runtime dependency is missing: ' + name)
    }
  }
  return { manifest, expected }
}
function frame(value) {
  const bytes = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length)
  return Buffer.concat([header, bytes])
}
async function probe(directory, manifest, input) {
  const childEnvironment = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }
  // No NODE_OPTIONS/NODE_PATH or registry/cache paths are inherited by either deployed child.
  async function runChecked(argv, expected) {
    lifetime.signal.throwIfAborted()
    const child = spawn(argv[0], argv.slice(1), { cwd: directory, env: childEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let diagnostic = ''; let error; let killDeadline
    const abort = () => {
      child.kill(); error ??= lifetime.signal.reason
      killDeadline ??= setTimeout(() => { child.kill('SIGKILL') }, input.limits.shutdownTimeoutMs)
    }
    lifetime.signal.addEventListener('abort', abort, { once: true })
    child.once('error', cause => { error = cause })
    child.stdout.on('data', data => { output = (output + data).slice(-4096) })
    child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-4096) })
    if (lifetime.signal.aborted) abort()
    try {
      const result = await new Promise(resolve => { child.once('close', (code, signal) => { resolve({ code, signal }) }) })
      if (error || result.code !== 0 || result.signal || output !== expected) {
        throw error ?? new Error('Deployed capability probe failed: ' + diagnostic)
      }
    } finally {
      lifetime.signal.removeEventListener('abort', abort)
      if (killDeadline) clearTimeout(killDeadline)
    }
  }
  const sandboxCandidate = join(directory, '.sandbox-write-probe-' + randomUUID())
  const sandboxCode = [
    "const fs = require('node:fs');",
    "fs.readFileSync('runtime-manifest.json');",
    'try { fs.writeFileSync(' + JSON.stringify(sandboxCandidate) + ',"unexpected",{flag:"wx"}); process.exit(7); }',
    "catch(error) { if(!['EACCES','EPERM','EROFS','ERR_ACCESS_DENIED'].includes(error.code)) throw error; }",
    "process.stdout.write('runtime-sandbox-ready');",
  ].join('')
  async function childProbe(entry, ptc) {
    lifetime.signal.throwIfAborted()
    const child = spawn(process.execPath, [entry, ...(ptc ? ['65536'] : [])], {
      cwd: directory, env: { ...childEnvironment, ...(ptc ? { DSH_SUBPROCESS_CONTROL: 'pipe' } : {}) },
      stdio: ptc ? ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'overlapped'] : ['pipe', 'pipe', 'pipe'],
    })
    const closed = new Promise(resolve => { child.once('close', (code, signal) => { resolve({ code, signal }) }) })
    const channel = ptc ? child.stdio[7] : child.stdout
    const write = ptc ? child.stdio[7] : child.stdin
    let pending = Buffer.alloc(0)
    let succeeded = false
    let capabilityProbe = Promise.resolve()
    let diagnostic = ''
    let error
    let killDeadline
    const abort = () => {
      child.kill(); error ??= lifetime.signal.reason
      killDeadline ??= setTimeout(() => { child.kill('SIGKILL') }, input.limits.shutdownTimeoutMs)
    }
    lifetime.signal.addEventListener('abort', abort, { once: true })
    child.on('error', cause => { error = cause })
    child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-4096) })
    if (ptc) child.stdout.resume()
    channel.on('error', cause => { error ??= cause; child.kill() })
    channel.on('data', bytes => {
      try {
        pending = Buffer.concat([pending, bytes])
        while (pending.length >= 4) {
          const size = pending.readUInt32BE(0)
          if (!size || size > 65536) throw new Error('Runtime probe frame exceeds limit')
          if (pending.length < size + 4) break
          const message = JSON.parse(pending.subarray(4, size + 4)); pending = pending.subarray(size + 4)
          if (ptc) {
            if (message.type === 'ready') write.write(frame({ type: 'boot', data: { code: 'return 42', namespaces: [], maxOutputBytes: 4096 } }))
            else if (message.type === 'done') {
              if (message.error || JSON.stringify(message.value) !== '[42]') throw new Error('Deployed PTC evaluation failed')
              succeeded = true; write.destroy()
            } else throw new Error('Unexpected PTC probe response')
          } else if (message.type === 'result' && message.id === 'runtime-probe') {
            if (message.value?.protocol !== manifest.protocol || message.value?.hash !== input.helperHash
                || message.value?.bootstrapHash !== input.bootstrapHash) throw new Error('Deployed helper identity differs from manifest')
            if (manifest.platform === 'linux' || manifest.platform === 'darwin') {
              write.write(frame({ type: 'request', id: 'runtime-sandbox', method: 'sandbox', params: {
                argv: [process.execPath, '--eval', sandboxCode], policy: { mode: 'read-only', workspaceRoot: input.workspace },
              } }))
            } else {
              succeeded = true; write.write(frame({ type: 'request', id: 'runtime-close', method: 'close', params: {} }))
            }
          } else if (message.type === 'result' && message.id === 'runtime-sandbox') {
            const argv = message.value?.argv
            if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string')) {
              throw new Error('Deployed helper did not prepare read-only confinement')
            }
            capabilityProbe = runChecked(argv, 'runtime-sandbox-ready').then(() => {
              succeeded = true; write.write(frame({ type: 'request', id: 'runtime-close', method: 'close', params: {} }))
            }).catch(cause => { error = cause; abort() })
          } else if (message.type === 'result' && message.id === 'runtime-close') write.end()
          else throw new Error('Deployed helper initialization failed')
        }
      } catch (cause) { error = cause; child.kill() }
    })
    if (lifetime.signal.aborted) abort()
    if (!ptc) write.write(frame({ type: 'request', id: 'runtime-probe', method: 'hello', params: {
      protocol: manifest.protocol, workspace: input.workspace, leaseMs: Math.max(3000, Math.min(600000, input.limits.operationTimeoutMs)), bootstrapPath: join(directory, manifest.bootstrap),
    } }))
    try {
      const result = await closed
      await capabilityProbe
      if (error || !succeeded || result.code !== 0 || result.signal) throw error ?? new Error('Runtime probe failed: ' + diagnostic)
    } finally {
      lifetime.signal.removeEventListener('abort', abort)
      if (killDeadline) clearTimeout(killDeadline)
    }
  }
  try {
    await childProbe(join(directory, manifest.bootstrap), true)
    await childProbe(join(directory, manifest.helper), false)
    if (manifest.files.some(file => file.path === 'node_modules/node-pty/package.json')) {
      const code = [
        "const pty=require('node-pty');let output='';",
        "const terminal=pty.spawn('/bin/sh',['-c','printf runtime-pty-ready'],{cwd:process.cwd(),env:process.env,cols:80,rows:24});",
        "process.once('SIGTERM',()=>terminal.kill());terminal.onData(data=>{output+=data});",
        "terminal.onExit(result=>{if(result.exitCode!==0||output!=='runtime-pty-ready')process.exitCode=1;else process.stdout.write(output)});",
      ].join('')
      await runChecked([process.execPath, '--eval', code], 'runtime-pty-ready')
    }
  } finally { await rm(sandboxCandidate, { force: true }) }
}

let staging
let deadline
try {
  const input = JSON.parse(await nextLine())
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
  if (!(nodeMajor >= 24 || (nodeMajor === 22 && nodeMinor >= 19))) throw new Error('Remote Node version does not meet Harness engines')
  if (!['inspect', 'install'].includes(input.action) || !/^[0-9a-f]{64}$/.test(input.generation)
      || !isAbsolute(input.installRoot) || !isAbsolute(input.workspace)
      || !Number.isSafeInteger(input.limits?.operationTimeoutMs) || input.limits.operationTimeoutMs <= 0) throw new Error('Invalid installer request')
  deadline = setTimeout(() => { lifetime.abort(new Error('Remote installation timed out')) }, input.limits.operationTimeoutMs)
  const installRoot = await realpath(input.installRoot)
  if (installRoot !== input.installRoot) throw new Error('Installation root must be canonical')
  await ownedDirectory(installRoot)
  const workspace = await realpath(input.workspace)
  if (inside(workspace, installRoot) || inside(installRoot, workspace)) throw new Error('Runtime directory and workspace must not contain each other')
  const generationRoot = join(installRoot, 'generations')
  const destination = join(generationRoot, input.generation)
  const observation = { platform: process.platform, arch: process.arch, node: process.execPath, nodeVersion: process.version,
    installRoot, generation: input.generation }
  if (input.action === 'install') {
    await mkdir(generationRoot, { mode: 0o700, recursive: true }); await ownedDirectory(generationRoot)
    const stagingRoot = join(installRoot, '.staging')
    await mkdir(stagingRoot, { mode: 0o700, recursive: true }); await ownedDirectory(stagingRoot)
    staging = await mkdtemp(join(stagingRoot, 'operation-'))
    output({ type: 'stage', directory: staging, ...observation })
    if (JSON.parse(await nextLine()).action !== 'publish') throw new Error('Installation was cancelled before publication')
  }
  const directory = staging ?? destination
  let verified
  try { verified = await verifyTree(directory, input) }
  catch (error) {
    if (input.action === 'inspect' && error.code === 'ENOENT' && error.path === destination) {
      output({ type: 'result', value: { ...observation, state: 'missing' } }); process.stdin.destroy();
    } else throw error
  }
  if (verified) {
    const { manifest, expected } = verified
    const helperHash = expected.get(manifest.helper).sha256
    const bootstrapHash = expected.get(manifest.bootstrap).sha256
    lifetime.signal.throwIfAborted()
    await probe(directory, manifest, { ...input, helperHash, bootstrapHash })
    lifetime.signal.throwIfAborted()
    if (staging) {
      for (const file of manifest.files) await chmod(join(staging, file.path), file.executable ? 0o500 : 0o400)
      await chmod(join(staging, 'runtime-manifest.json'), 0o400)
      try { await rename(staging, destination); staging = undefined }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error
        await verifyTree(destination, input)
        await probe(destination, manifest, { ...input, helperHash, bootstrapHash })
      }
    }
    output({ type: 'result', value: { ...observation, state: 'installed', directory: destination, version: manifest.version,
      sourceCommit: manifest.sourceCommit, protocol: manifest.protocol, helper: join(destination, manifest.helper), helperHash,
      bootstrapPath: join(destination, manifest.bootstrap), bootstrapHash } })
  }
} catch (error) {
  output({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
} finally {
  if (deadline) clearTimeout(deadline)
  if (staging) await rm(staging, { recursive: true, force: true })
  process.stdin.destroy()
}
