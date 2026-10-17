/** Validated deployment configuration for a Director, Cell, or combined development node. */
import { z } from 'zod'
import { RegionSchema } from './mobile-protocol.ts'

export const RelayConfigSchema = z.object({
  role: z.enum(['combined', 'director', 'cell']).default('combined'),
  host: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  port: z.number().int().min(0).max(65535).default(8088),
  publicUrl: z.string().url().default('http://127.0.0.1:8088'),
  mobileAssetsDir: z.string().min(1).optional(),
  directorUrl: z.string().url().optional(),
  regionId: z.string().min(1).max(128).default('local'),
  stateFile: z.string().min(1),
  regions: z.array(RegionSchema).default([]),
  allowInsecureNetwork: z.boolean().default(false),
  enrollmentToken: z.string().min(32).optional(),
  maxHosts: z.number().int().positive().default(1000),
  maxConnectionsPerHost: z.number().int().positive().default(8),
  maxPayloadBytes: z.number().int().positive().default(1024 * 1024),
  maxBufferedBytes: z.number().int().positive().default(2 * 1024 * 1024),
  heartbeatMs: z.number().int().positive().default(15000),
  handshakeMs: z.number().int().positive().default(10000),
  leaseMs: z.number().int().positive().default(5 * 60 * 1000),
  inviteMs: z.number().int().positive().default(5 * 60 * 1000),
  maxAdmissionsPerMinute: z.number().int().positive().default(120),
  maxControlQueue: z.number().int().positive().default(256),
  maxControlMessagesPerMinute: z.number().int().positive().default(600),
  maxProofs: z.number().int().positive().default(4096),
}).strict()
export type RelayConfig = z.infer<typeof RelayConfigSchema>

/** Require encrypted remote origins unless this deployment explicitly permits development LAN HTTP. */
export function validateOrigin(value: string, allowInsecureNetwork: boolean): string {
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('endpoint_must_be_http_origin')
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback && !allowInsecureNetwork) throw new Error('remote_endpoint_requires_https')
  return url.origin
}
