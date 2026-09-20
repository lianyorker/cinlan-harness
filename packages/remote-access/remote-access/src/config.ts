/** Validated deployment settings for the opt-in HTTPS pairing listener. */
import z from '@deepseek-ai/schemastery'

/** Configurable listener, TLS paths, invitation lifetime and per-carrier budgets. */
export interface Config {
  /** Start the HTTPS pairing listener when the Host loads this plugin. */
  readonly enabled?: boolean
  /** Local address on which the pairing listener accepts connections. */
  readonly host?: string
  /** TCP port used by the HTTPS pairing listener. */
  readonly port?: number
  /** HTTPS origin embedded in invitations and required from paired clients. */
  readonly advertisedOrigin?: string
  /** Host path to the PEM certificate presented by the HTTPS listener. */
  readonly tlsCertificatePath?: string
  /** Host path to the PEM private key used by the HTTPS listener. */
  readonly tlsPrivateKeyPath?: string
  /** Lifetime in milliseconds of an unused pairing invitation. */
  readonly invitationLifetimeMs?: number
  /** Lifetime in milliseconds of an issued paired-device credential. */
  readonly credentialLifetimeMs?: number
  /** Maximum failed attempts allowed for one pairing invitation. */
  readonly maxInvitationAttempts?: number
  /** Maximum bytes accepted in one pairing HTTP request body or WebSocket message. */
  readonly maxRequestBodyBytes?: number
  /** Maximum simultaneously admitted paired TCP connections and tracked requests. */
  readonly maxConnections?: number
  /** Maximum queued outgoing events retained for one connection. */
  readonly maxQueuedEvents?: number
  /** Maximum total bytes retained in one outgoing event queue. */
  readonly maxQueuedEventBytes?: number
  /** Maximum retained logical streams, including pending opening and delivery; excess opens terminate the connection. */
  readonly maxStreamsPerConnection?: number
  /** Interval in milliseconds between WebSocket heartbeat checks. */
  readonly websocketHeartbeatIntervalMs?: number
  /** Maximum milliseconds allowed for an incoming pairing HTTP request. */
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
