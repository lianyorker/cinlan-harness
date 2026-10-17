/** Logger implementation using pino */

import pino from 'pino'
import type { Logger, LoggerConfig } from './types.ts'

/** Create a pino logger instance */
function createPinoLogger(config: LoggerConfig): pino.Logger {
  const options: pino.LoggerOptions = {
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  // Pretty printing for development
  if (config.format === 'pretty') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: config.enableColors ?? true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          destination: config.destination ?? 1,
          mkdir: true,
        },
      },
    })
  }

  // File output
  if (config.destination) {
    return pino(options, pino.destination({ dest: config.destination, mkdir: true }))
  }

  // Default to stdout
  return pino(options)
}

/** Wrap a pino logger so child loggers share the parent's output destination. */
function wrapLogger(pinoLogger: pino.Logger): Logger {
  const logger: Logger = {
    debug(message: string, context?: Record<string, unknown>): void {
      pinoLogger.debug(context ?? {}, message)
    },

    info(message: string, context?: Record<string, unknown>): void {
      pinoLogger.info(context ?? {}, message)
    },

    warn(message: string, context?: Record<string, unknown>): void {
      pinoLogger.warn(context ?? {}, message)
    },

    error(message: string, context?: Record<string, unknown>, error?: Error): void {
      pinoLogger.error({ ...context, err: error }, message)
    },

    child(childContext: Record<string, unknown>): Logger {
      return wrapLogger(pinoLogger.child(childContext))
    },
  }

  return logger
}

/**
 * Create a logger; child loggers inherit its context, level, and output destination.
 * @param config - output level, format, and optional destination file.
 * @returns logger writing to the destination file or stdout when omitted.
 */
export function createLogger(config: LoggerConfig): Logger {
  return wrapLogger(createPinoLogger(config))
}

/**
 * Create an info-level logger with colored, pretty output to stdout.
 * @returns logger using the default output configuration.
 */
export function createDefaultLogger(): Logger {
  return createLogger({
    level: 'info',
    format: 'pretty',
    enableColors: true,
  })
}
