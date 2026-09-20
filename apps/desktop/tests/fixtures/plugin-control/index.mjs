/** Runs only from the Settings harness's isolated copied profile. */
import { appendFileSync } from 'node:fs'

export function apply(ctx, config) {
  const event = phase => appendFileSync(new URL('./lifecycle.jsonl', import.meta.url), JSON.stringify({
    phase, hostPid: process.pid, marker: config.marker,
  }) + '\n')
  ctx.provide('desktopAcceptanceMarker', config.marker)
  ctx.effect(() => {
    event('mounted')
    return () => { event('disposed') }
  }, 'desktop acceptance lifecycle')
}
