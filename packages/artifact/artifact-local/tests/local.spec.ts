/** Local Artifact Service publication, authorization, bounds, and integrity tests. */

import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import LocalArtifactStore, { DEFAULT_MAX_BYTES, MAX_ARTIFACT_BYTES } from '@deepseek-ai/dsh-artifact-local'
import { ArtifactProducerId, ArtifactSessionId } from '@deepseek-ai/dsh-artifact'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import { metadataPath, objectPath } from '../src/store.ts'
import type { ArtifactAuthorization, ArtifactPublishRequest } from '@deepseek-ai/dsh-artifact'

const scope: ArtifactAuthorization = {
  sessionId: ArtifactSessionId('session-1'),
}
const otherScope: ArtifactAuthorization = { sessionId: ArtifactSessionId('session-2') }
const provenance = { producerId: ArtifactProducerId('producer-1'), ...scope }
const roots: string[] = []

function stubExecutionHost(ctx: Context, hostId = 'host-1'): void {
  ctx.reflect.provide('executionHost', { current: () => ({ hostId: ExecutionHostId(hostId) }) } as never)
}

function store(ctx: Context): LocalArtifactStore {
  return ctx.artifacts as LocalArtifactStore
}

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-artifact-test-'))
  roots.push(root)
  return root
}

function input(data: Uint8Array = Uint8Array.from([1, 2, 3])): ArtifactPublishRequest {
  return {
    data,
    mediaType: 'application/octet-stream',
    kind: 'evidence',
    name: '/private/capture.bin',
    provenance: { ...provenance, source: 'security.capture' },
    authorization: scope,
    retention: 'engagement',
    redaction: 'redacted',
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('LocalArtifactStore', () => {
  it('publishes atomically and reads verified bytes with opaque metadata', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root, maxBytes: 1024 })
    const ref = await ctx.artifacts.publish(input())
    expect(ref).toMatchObject({
      mediaType: 'application/octet-stream',
      kind: 'evidence',
      bytes: 3,
      sha256: createHash('sha256').update(Uint8Array.from([1, 2, 3])).digest('hex'),
      retention: 'engagement',
      redaction: 'redacted',
      name: 'capture.bin',
    })
    expect(String(ref.artifactId)).toMatch(/^artifact:[0-9a-f-]{36}$/)
    expect(JSON.stringify(ref)).not.toContain(root)
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: scope })).resolves.toEqual(ref)
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 3 }))
      .resolves.toEqual({ ref, data: Uint8Array.from([1, 2, 3]) })
  })

  it('rejects oversized publication and bounded reads', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root, maxBytes: 3 })
    await expect(ctx.artifacts.publish(input(Uint8Array.from([1, 2, 3, 4])))).rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' })
    const ref = await ctx.artifacts.publish(input())
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 2 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' })
  })

  it('denies a different authorization scope without leaking a path', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root })
    const ref = await ctx.artifacts.publish(input())
    let result: unknown
    try {
      await ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: otherScope })
    } catch (error: unknown) {
      result = error
    }
    expect(result).toMatchObject({ code: 'ARTIFACT_FORBIDDEN' })
    expect(result).toBeInstanceOf(Error)
    if (!(result instanceof Error)) throw new Error('expected artifact access failure')
    expect(result.message).not.toContain(root)
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: otherScope, maxBytes: 10 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_FORBIDDEN' })
    const readerScope = { ...scope, producerId: ArtifactProducerId('browser-consumer') } as ArtifactAuthorization
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: readerScope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_FORBIDDEN' })
  })

  it('detects tampered bytes and malformed references', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root })
    const ref = await ctx.artifacts.publish(input())
    const id = String(ref.artifactId).slice('artifact:'.length)
    await writeFile(objectPath(root, id), Uint8Array.of(9, 9, 9))
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 10 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
    await expect(ctx.artifacts.describe({ artifactId: 'bad' as never, authorization: scope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_REF' })
    await expect(readFile(metadataPath(root, id), 'utf8')).resolves.toContain('artifactId')

    await writeFile(objectPath(root, id), Uint8Array.of(9, 9))
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 10 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it('preserves cancellation and reports interrupted publication as a write failure', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root })
    const ref = await ctx.artifacts.publish(input())
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(store(ctx).read({
      artifactId: ref.artifactId,
      authorization: scope,
      maxBytes: 10,
      signal: controller.signal,
    })).rejects.toBe(reason)

    const fileRoot = join(root, 'not-a-directory')
    await writeFile(fileRoot, 'x')
    const broken = new Context()
    stubExecutionHost(broken)
    await broken.plugin(LocalArtifactStore, { root: fileRoot })
    await expect(broken.artifacts.publish(input())).rejects.toMatchObject({ code: 'ARTIFACT_WRITE_FAILED' })
  })

  it('clamps reads to the provider cap and resolves default configuration', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root, maxBytes: 3 })
    const ref = await ctx.artifacts.publish(input())
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 100 }))
      .resolves.toMatchObject({ data: Uint8Array.of(1, 2, 3) })
    await expect(store(ctx).read({
      artifactId: ref.artifactId,
      authorization: scope,
      maxBytes: Number.MAX_SAFE_INTEGER + 1,
    })).rejects.toMatchObject({ code: 'ARTIFACT_INVALID_INPUT' })

    const direct = new LocalArtifactStore(new Context(), { dshHome: root })
    expect(direct.root).toBe(join(root, 'artifacts', 'v1'))
    expect(direct.maxBytes).toBe(DEFAULT_MAX_BYTES)
  })

  it('rejects ambiguous blank paths and unsafe deployment limits at plugin load', async () => {
    for (const config of [
      { root: '   ' },
      { dshHome: '   ' },
      { root: await newRoot(), maxBytes: MAX_ARTIFACT_BYTES + 1 },
      { root: await newRoot(), unknown: true },
    ]) {
      const ctx = new Context()
      stubExecutionHost(ctx)
      await expect(ctx.plugin(LocalArtifactStore, config)).rejects.toThrow()
    }
    const directRoot = await newRoot()
    expect(() => new LocalArtifactStore(new Context(), {
      root: directRoot,
      maxBytes: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow(/positive safe integer/)
  })

  it.skipIf(process.platform === 'win32')('creates POSIX object storage with owner-only modes', async () => {
    const root = await newRoot()
    await chmod(root, 0o755)
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root })
    const ref = await ctx.artifacts.publish(input())
    const id = String(ref.artifactId).slice('artifact:'.length)
    expect((await stat(join(root, 'objects'))).mode & 0o777).toBe(0o700)
    expect((await stat(join(root, 'metadata'))).mode & 0o777).toBe(0o700)
    expect((await stat(objectPath(root, id))).mode & 0o777).toBe(0o600)
    expect((await stat(metadataPath(root, id))).mode & 0o777).toBe(0o600)
  })

  it('removes a committed object when metadata publication fails', async () => {
    const root = await newRoot()
    await writeFile(join(root, 'metadata'), 'not a directory')
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root })
    await expect(ctx.artifacts.publish(input())).rejects.toMatchObject({ code: 'ARTIFACT_WRITE_FAILED' })
    await expect(readdir(join(root, 'objects'))).resolves.toEqual([])
  })

  it('distinguishes missing and non-file metadata and objects', async () => {
    const root = await newRoot()
    const ctx = new Context()
    stubExecutionHost(ctx)
    await ctx.plugin(LocalArtifactStore, { root })
    const ref = await ctx.artifacts.publish(input())
    const id = String(ref.artifactId).slice('artifact:'.length)

    await rm(metadataPath(root, id))
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: scope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await mkdir(metadataPath(root, id))
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: scope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })

    await rm(metadataPath(root, id), { recursive: true })
    const restored = {
      ...ref,
      authorization: { ...scope, producerId: provenance.producerId, executionHostId: ExecutionHostId('host-1') },
    }
    await writeFile(metadataPath(root, id), `${JSON.stringify(restored)}\n`)
    await rm(objectPath(root, id))
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 10 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' })
    await mkdir(objectPath(root, id))
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: scope, maxBytes: 10 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

})
