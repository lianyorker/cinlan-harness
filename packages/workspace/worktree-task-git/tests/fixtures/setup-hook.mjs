/** Operating-system fixture for task setup argv, output, and process-tree settlement. */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const [mode, ...args] = process.argv.slice(2)
switch (mode) {
  case 'record':
    appendFileSync('setup-results.jsonl', JSON.stringify({ cwd: process.cwd(), args }) + '\n')
    break
  case 'external-record':
    appendFileSync(args[0], JSON.stringify({ cwd: process.cwd(), args: args.slice(1) }) + '\n')
    break
  case 'fail-once': {
    const failed = existsSync(args[0])
    appendFileSync(args[0], 'attempt\n')
    if (!failed) { process.stderr.write('cleanup refused\n'); process.exitCode = 7 }
    break
  }
  case 'fail':
    process.stderr.write('setup refused\n')
    process.exitCode = 7
    break
  case 'stdout-overflow':
    writeFileSync(process.stdout.fd, 'x'.repeat(8192))
    break
  case 'stderr-overflow':
    writeFileSync(process.stderr.fd, 'x'.repeat(8192))
    break
  case 'wait': {
    const descendant = spawn(process.execPath, [fileURLToPath(import.meta.url), 'descendant', ...args, String(process.pid)], {
      stdio: 'ignore',
    })
    descendant.once('error', error => { throw error })
    process.on('SIGTERM', () => {
      if (descendant.exitCode !== null || descendant.signalCode !== null) process.exit(0)
      descendant.once('exit', () => { process.exit(0) })
    })
    setInterval(() => {}, 1000)
    break
  }
  case 'descendant': {
    const [readyPath, parentPid] = args
    if (readyPath === undefined || parentPid === undefined) throw new Error('Missing readiness path or parent pid')
    process.on('SIGTERM', () => { process.exit(0) })
    setInterval(() => {}, 1000)
    writeFileSync(readyPath + '.tmp', JSON.stringify({ parentPid: Number(parentPid), childPid: process.pid }))
    renameSync(readyPath + '.tmp', readyPath)
    break
  }
  default:
    throw new Error('Unknown setup fixture mode: ' + String(mode))
}
