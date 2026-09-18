/** External JSON CLI fixture; never starts a device backend. */
import { appendFileSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const state = JSON.parse(readFileSync('fixture-state.json', 'utf8'))
let input = ''
for await (const chunk of process.stdin) input += chunk.toString()
appendFileSync('calls.jsonl', JSON.stringify({
  argv: ['emulator', ...args], input,
  local: ['ORCA_PAIRING_CODE', 'ORCA_REMOTE_PAIRING', 'ORCA_ENVIRONMENT'].every(name => process.env[name] === undefined),
}) + '\n')

if (state.hang === true) {
  setInterval(() => {}, 60_000)
} else {
  const deviceId = args[args.indexOf('--device') + 1]
  const selected = state.devices.find(device => device.id === deviceId)
  const failure = args[0] === 'observe'
    ? state.observeFailure ?? (selected === undefined ? 'device_not_found' : undefined)
    : undefined
  const result = args[0] === 'devices' ? state.devices : args[0] === 'observe' ? {
    protocolVersion: 1, device: selected, deviceGeneration: 'fixture-generation',
    observationId: 'fixture-observation', coordinateSpace: 'normalized',
    tree: 'button Continue on ' + deviceId, screenshotStatus: { state: 'skipped' },
  } : { ok: true }
  const envelope = {
    id: 'fixture', ok: failure === undefined,
    ...(failure === undefined ? { result } : { error: { code: failure, message: 'fixture selected device failed' } }),
    _meta: { runtimeId: 'fixture-runtime' },
  }
  process.stdout.write(JSON.stringify(envelope))
  process.exitCode = failure === undefined ? 0 : 1
}
