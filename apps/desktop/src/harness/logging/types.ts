/** Logging system types */

/** Log level enumeration */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Log output format */
export type LogFormat = 'json' | 'pretty' | 'compact'

/** Logger configuration */
export interface LoggerConfig {
  readonly level: LogLevel
  readonly format: LogFormat
  readonly destination?: string
  readonly maxFileSize?: number
  readonly maxFiles?: number
  readonly enableColors?: boolean
}

/** Log entry structure */
export interface LogEntry {
  readonly timestamp: string
  readonly level: LogLevel
  readonly message: string
  readonly context?: Record<string, unknown>
  readonly error?: Error
}

/** Logger interface */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>, error?: Error): void
  child(context: Record<string, unknown>): Logger
}

/** Default logger configuration */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  format: 'pretty',
  enableColors: true,
}
