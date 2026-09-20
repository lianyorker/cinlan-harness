/** Localized recovery guidance for Host failures; wire diagnostics remain verbatim. */
import type { HostDiagnostic, HostsTranslate } from './types.ts'

const ERROR_KEYS = {
  'execution-host/local-access-required': 'runtime.errorLocalAccess',
  'execution-host/runtime-unavailable': 'runtime.errorUnavailable',
  'execution-runtime/release-unavailable': 'runtime.errorRelease',
  'execution-runtime/invalid-config': 'runtime.errorConfig',
  'execution-runtime/connection-failed': 'runtime.errorConnection',
  'execution-runtime/verification-failed': 'runtime.errorVerification',
  'execution-runtime/target-changed': 'runtime.changed',
  'execution-runtime/cancelled': 'runtime.cancelled',
  'execution-host/invalid-request': 'errorInvalidRequest',
  'execution-host/limit-reached': 'errorLimit',
  'execution-host/closed': 'errorClosed',
  'execution-host/conflict': 'errorConflict',
  'execution-host/not-found': 'errorNotFound',
  'execution-host/roots-unconfigured': 'errorRoots',
  'execution-host/ssh-unavailable': 'errorSsh',
  'execution-host/authentication-required': 'errorAuthentication',
  'execution-host/host-key-mismatch': 'errorHostKey',
  'execution-host/unreachable': 'errorUnreachable',
  'execution-host/incompatible': 'errorIncompatible',
  'execution-host/cancelled': 'errorCancelled',
  'execution-host/timeout': 'errorTimeout',
  'execution-host/connection-lost': 'errorConnectionLost',
  'execution-host/outcome-unconfirmed': 'errorUnconfirmed',
  'execution-host/inspection-failed': 'errorInspection',
} as const

/**
 * Retain displayable diagnostic fields from a rejected callback.
 * @param error - callback failure, including generated Remote errors.
 * @returns serializable code and message; unknown failures use localized fallback copy.
 */
export function hostDiagnostic(error: unknown): HostDiagnostic {
  return {
    code: typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '',
    message: typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : '',
  }
}

/**
 * Select recovery copy by stable code, with a fallback for extensible errors.
 * @param error - retained Host diagnostic.
 * @param t - current settings translator.
 * @returns localized recovery guidance.
 */
export function diagnosticLabel(error: HostDiagnostic, t: HostsTranslate): string {
  const code = error.code.includes('/') ? error.code : 'execution-host/' + error.code
  return t(Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code as keyof typeof ERROR_KEYS] : 'errorUnknown')
}
