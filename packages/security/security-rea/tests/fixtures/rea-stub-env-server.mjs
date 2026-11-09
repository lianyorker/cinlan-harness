/**
 * Startup probe fixture: records the spawned server's env, then hangs like
 * rea-stub-hang-server.mjs so SecurityRea's startup timeout still applies.
 * The launch env lands in REA_ENV_PROBE_OUT before any MCP traffic (DSH_*
 * names are scrubbed from the child environment, so the probe uses REA_*).
 */
import { writeFileSync } from 'node:fs'

writeFileSync(process.env.REA_ENV_PROBE_OUT, process.env.REA_MCP_OUTPUT_SCHEMA_PROFILE ?? '')

process.stdin.on('data', () => {})
process.stdin.resume()
