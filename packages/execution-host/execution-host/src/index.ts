/** Execution Host service definition for authorized process identity. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ExecutionHostId as ExecutionHostIdValue, ExecutionHostInfo } from './types.ts'
export type { ExecutionHostInfo } from './types.ts'

/** Opaque identifier for one execution host. */
export type ExecutionHostId = ExecutionHostIdValue

/**
 * Brand an execution host identifier.
 * @param value - Serialized execution host identifier.
 * @returns The branded execution host identifier.
 */
export function ExecutionHostId(value: string): ExecutionHostId {
  return value as ExecutionHostId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    executionHost: ExecutionHostService
  }
}

/**
 * Execution host identity service: provides stable host identity for
 * artifact provenance and assessment authorization.
 */
export abstract class ExecutionHostService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'executionHost')
  }

  /**
   * Get the current execution host identity.
   * @returns current host metadata.
   */
  abstract current(): ExecutionHostInfo
}

export default ExecutionHostService
