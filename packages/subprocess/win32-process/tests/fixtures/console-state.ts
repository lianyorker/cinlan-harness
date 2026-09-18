/** Reports the inherited console's visibility from a real Windows child. */
import koffi from 'koffi'

const getConsoleWindow = koffi.load('kernel32.dll').func('void * __stdcall GetConsoleWindow()')
const isWindowVisible = koffi.load('user32.dll').func('int __stdcall IsWindowVisible(void *)')
const window = getConsoleWindow() as bigint | null
const attached = window !== null && window !== 0n
process.stdout.write(JSON.stringify({ attached, visible: attached && isWindowVisible(window) !== 0 }))
