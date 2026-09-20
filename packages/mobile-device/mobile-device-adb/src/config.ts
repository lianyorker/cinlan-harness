/** Explicit deployment configuration for native Android command ownership. */
import { isAbsolute, join, resolve, basename } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Native Android execution bounds and existing executable selection. */
export interface Config {
  /** Provider id selected by the Mobile Device service. */
  readonly providerId?: string
  /** Existing adb executable or PATH name; an empty value uses the saved SDK path then PATH. */
  readonly command?: string
  /** Working directory for subprocesses. */
  readonly cwd?: string
  /** Per-command deadline including resolution. */
  readonly commandTimeoutMs?: number
  /** Process-range shutdown grace. */
  readonly graceMs?: number
  /** Independent deadline for removing an owned device-side XML file. */
  readonly cleanupTimeoutMs?: number
  /** Maximum stdout bytes for hierarchy, inventory, and diagnostic reads. */
  readonly maxOutputBytes?: number
  /** Maximum retained stderr bytes. */
  readonly maxStderrBytes?: number
  /** Maximum PNG screenshot bytes. */
  readonly maxImageBytes?: number
  /** Maximum decoded screenshot pixels. */
  readonly maxImagePixels?: number
  /** Maximum input text bytes. */
  readonly maxTextBytes?: number
  /** Swipe duration passed to Android input. */
  readonly swipeDurationMs?: number
}
/** Fully resolved execution choices; command selection may depend on live SDK settings. */
export type ResolvedConfig = Required<Config>
/** Loader validates all execution bounds before provider registration. */
export const Config: z<Config> = z.object({
  providerId: z.string().default('adb'), command: z.string().default(''), cwd: z.string().default(process.cwd()),
  commandTimeoutMs: z.number().default(30_000), graceMs: z.number().default(3_000), cleanupTimeoutMs: z.number().default(5_000),
  maxOutputBytes: z.number().default(1024 * 1024), maxStderrBytes: z.number().default(64 * 1024),
  maxImageBytes: z.number().default(16 * 1024 * 1024), maxImagePixels: z.number().default(16 * 1024 * 1024),
  maxTextBytes: z.number().default(4096), swipeDurationMs: z.number().default(400),
})
/** Resolve validated deployment defaults.
 * @param input - User Loader configuration.
 * @returns Explicit values used by each command.
 */
export function resolveConfig(input: Config = {}): ResolvedConfig {
  const config = Config(input) as ResolvedConfig
  const allowed = new Set(Object.keys(Config({})))
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error('mobile-device-adb: unsupported config field')
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS)) {
      throw new Error('mobile-device-adb: execution bounds must be positive safe integers within timer limits')
    }
    if (typeof value === 'string' && (value.trim() !== value || /[\r\n\0]/.test(value))) throw new Error('mobile-device-adb: invalid configuration string')
    if (key === 'providerId' && value === '') throw new Error('mobile-device-adb: providerId is required')
  }
  if (!config.cwd) throw new Error('mobile-device-adb: cwd is required')
  return { ...config, cwd: resolve(config.cwd) }
}
/** Select an existing executable without scanning user application data.
 * @param command - Explicit deployment executable; takes precedence.
 * @param sdkPath - Saved SDK root, platform-tools directory, or adb executable.
 * @returns Executable path or the bare PATH command adb.
 */
export function adbCommand(command: string, sdkPath: string): string {
  if (command) return command
  if (!sdkPath) return 'adb'
  if (!isAbsolute(sdkPath) || sdkPath.trim() !== sdkPath || /[\r\n\0]/.test(sdkPath)) throw new Error('Android SDK path must be absolute')
  const file = process.platform === 'win32' ? 'adb.exe' : 'adb'
  if (basename(sdkPath).toLowerCase() === file) return sdkPath
  return basename(sdkPath).toLowerCase() === 'platform-tools' ? join(sdkPath, file) : join(sdkPath, 'platform-tools', file)
}
