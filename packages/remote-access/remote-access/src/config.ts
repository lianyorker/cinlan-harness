/** Validated deployment settings for the opt-in HTTPS pairing listener. */
import z from '@deepseek-ai/schemastery'

/** Configurable listener, TLS paths, invitation lifetime and per-carrier budgets. */
export interface Config {
  readonly enabled?: boolean
  readonly host?: string
  readonly port?: number
  readonly advertisedOrigin?: string
  readonly tlsCertificatePath?: string
  readonly tlsPrivateKeyPath?: string
  readonly invitationLifetimeMs?: number
  readonly credentialLifetimeMs?: number
  readonly maxInvitationAttempts?: number
  readonly maxRequestBodyBytes?: number
  readonly maxConnections?: number
  readonly maxQueuedEvents?: number
  readonly maxQueuedEventBytes?: number
  readonly maxStreamsPerConnection?: number
  readonly websocketHeartbeatIntervalMs?: number
  readonly requestTimeoutMs?: number
}

/** Fully resolved listener settings, including disabled deployments without TLS configuration. */
export type ResolvedConfig = Required<Config>

/** Loader schema; configured TLS material is required before enable can listen. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false), host: z.string().default('127.0.0.1'), port: z.number().step(1).max(65535).default(7443),
  advertisedOrigin: z.string().default(''), tlsCertificatePath: z.string().default(''), tlsPrivateKeyPath: z.string().default(''),
  invitationLifetimeMs: z.number().step(1).min(1000).max(600000).default(120000),
  credentialLifetimeMs: z.number().step(1).min(1000).max(2147483647).default(604800000),
  maxInvitationAttempts: z.number().step(1).min(1).max(20).default(5),
  maxRequestBodyBytes: z.number().step(1).min(1024).max(1048576).default(262144),
  maxQueuedEvents: z.number().step(1).min(1).max(1024).default(64),
  maxQueuedEventBytes: z.number().step(1).min(1024).max(4194304).default(1048576),
  maxConnections: z.number().step(1).min(1).max(128).default(16),
  maxStreamsPerConnection: z.number().step(1).min(1).max(32).default(8),
  websocketHeartbeatIntervalMs: z.number().step(1).min(100).max(60000).default(5000),
  requestTimeoutMs: z.number().step(1).min(1000).max(60000).default(15000),
})
