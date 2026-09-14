/** Package-owned invariant companion for the sherpa-onnx voice Provider. @module @deepseek-ai/dsh-voice-sherpa-onnx/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-voice-sherpa-onnx'

/** Cordis companion plugin name. */
export const name = 'voice-sherpa-onnx-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']

/** No runtime invariant: engine, model, and route registration are synchronously owner-enforced. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
