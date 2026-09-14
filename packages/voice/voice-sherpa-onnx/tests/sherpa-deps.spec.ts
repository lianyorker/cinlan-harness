/* oxlint-disable typescript/no-extraneous-class, typescript/no-unsafe-assignment */
/** sherpa-onnx-node lazy-load tests, mirroring pty-deps.spec.ts. */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeSherpaOnnxCause,
  loadSherpaOnnx,
  resetSherpaOnnxCache,
  sherpaOnnxLoadCause,
} from '../src/sherpa-deps.ts'

const failingRequire = (): never => { throw new Error('Cannot find package sherpa-onnx-node') }

describe('loadSherpaOnnx', () => {
  beforeEach(() => { resetSherpaOnnxCache() })

  it('returns null and records the cause when require throws', () => {
    expect(loadSherpaOnnx(failingRequire)).toBeNull()
    expect((sherpaOnnxLoadCause() as Error).message).toBe('Cannot find package sherpa-onnx-node')
  })

  it('caches the first outcome', () => {
    expect(loadSherpaOnnx(failingRequire)).toBeNull()
    expect(loadSherpaOnnx(() => ({ OnlineRecognizer: class { readonly marker = true } }))).toBeNull()
    resetSherpaOnnxCache()
    expect(loadSherpaOnnx(() => ({ OnlineRecognizer: class { readonly marker = true } }))).not.toBeNull()
  })

  it('resolves a successful load', () => {
    const fakeModule = { OnlineRecognizer: class { readonly marker = true } }
    expect(loadSherpaOnnx(() => fakeModule)).toBe(fakeModule)
    expect(sherpaOnnxLoadCause()).toBeUndefined()
  })
})

describe('describeSherpaOnnxCause', () => {
  it('describes an Error by its message', () => {
    expect(describeSherpaOnnxCause(new Error('boom'))).toBe('boom')
  })

  it('stringifies a non-Error cause', () => {
    expect(describeSherpaOnnxCause('plain string')).toBe('plain string')
  })
})
