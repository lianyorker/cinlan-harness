/** dsh-profile application entry for independently deployable Cinlan relay roles. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Command } from 'commander'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { startRelay } from './runtime.ts'
import type { RelayConfig } from './config.ts'

export const name = 'cinlan-mobile-relay'
export const inject = ['cmdlineArgs']

/** Launch from dsh --profile mobile-relay; the profile owns all servers. */
export async function apply(ctx: Context, config: Partial<RelayConfig> = {}): Promise<void> {
  const program = new Command().name('dsh --profile mobile-relay').option('--config <file>', 'Cinlan Director/Cell JSON configuration')
  let selected: Partial<RelayConfig> = config
  program.action(() => {
    const file: unknown = program.opts().config
    if (typeof file === 'string') selected = JSON.parse(readFileSync(resolve(file), 'utf8'))
  })
  parseCmdline(ctx, program)
  const server = await startRelay({ stateFile: resolve('.cinlan-mobile-relay/state.json'), ...selected })
  ctx.effect(() => () => server.close(), 'cinlan-mobile-relay: servers')
  ctx.logger.info('Cinlan mobile relay listening at ' + server.url)
}
