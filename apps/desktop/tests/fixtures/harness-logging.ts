/** Isolated process fixture exercising pino destinations and child contexts. */
import { createLogger } from '../../src/harness/logging/logger.ts'

const destination = process.argv[2]
if (destination === undefined) throw new Error('missing log destination')
const format = process.argv[3]
if (format !== 'json' && format !== 'pretty') throw new Error('unsupported log format')

const logger = createLogger({ level: 'info', format, enableColors: false, destination })
logger.info('Harness modules initialized', { sessions: 0, tools: 0 })
const child = logger.child({ project: 'smoke-project' })
child.info('Child log', { task: 'smoke-task' })
child.child({ component: 'tools' }).warn('Nested child log')
logger.error('Logged failure', {}, new Error('smoke-error'))
