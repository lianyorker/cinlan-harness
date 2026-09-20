/** Controlled stand-in for the external ADB executable; never invokes a device or shell. */
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const args = process.argv.slice(2)
const root = process.cwd()
const state = JSON.parse(await readFile(join(root, 'fixture-state.json'), 'utf8'))
await appendFile(join(root, 'calls.jsonl'), JSON.stringify(args) + '\n')
if (state.hang) {
  await writeFile(join(root, 'ready'), 'ready')
  await new Promise(() => {})
}
if (args[0] === 'version') {
  console.log('Android Debug Bridge version 1.0.41\nVersion 37.0.0-fixture')
} else if (args[0] === 'devices' && args[1] === '-l') {
  console.log('List of devices attached\n' + state.devices.map(d => d.serial + '\t' + d.state + ' model:Fixture transport_id:' + d.transportId).join('\n'))
} else {
  if (args[0] !== '-t' || !state.devices.some(d => d.transportId === args[1] && d.state === 'device')) process.exit(2)
  const command = args.slice(2)
  const device = state.devices.find(d => d.transportId === args[1])
  if (command.join(' ') === 'exec-out cat /proc/sys/kernel/random/boot_id') console.log(device.bootId)
  else if (command[0] === 'shell' && command[1] === 'uiautomator') console.log('UI hierarchy dumped to: ' + command.at(-1))
  else if (command[0] === 'exec-out' && command[1] === 'cat' && command[2]?.startsWith('/data/local/tmp/dsh-ui-')) console.log('<?xml version="1.0"?><hierarchy rotation="' + (state.rotation ?? 0) + '"><node text="Controlled Android fixture" class="android.widget.Button" bounds="[0,0][1,1]"/></hierarchy>')
  else if (command.join(' ') === 'shell wm size') console.log('Physical size: 1x1')
  else if (command.join(' ') === 'shell dumpsys activity activities') console.log('mResumedActivity: ActivityRecord{fixture u0 example.fixture/.MainActivity t1}')
  else if (command.join(' ') === 'exec-out screencap -p') process.stdout.write(Buffer.from(state.png, 'base64'))
  else if (command[0] === 'shell' && (command[1] === 'rm' || command[1] === 'input')) process.stdout.write('')
  else process.exit(3)
}
