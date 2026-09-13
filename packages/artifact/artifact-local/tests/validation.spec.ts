/** Local artifact validation and persisted-metadata rejection tests. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalArtifactStore from '@deepseek-ai/dsh-artifact-local'
import {
  ArtifactEngagementId,
  ArtifactProducerId,
  ArtifactScopeRef,
  ArtifactSessionId,
  ArtifactTaskId,
} from '@deepseek-ai/dsh-artifact'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import { metadataPath } from '../src/store.ts'
import type { ArtifactAuthorization, ArtifactPublishRequest, ArtifactRef } from '@deepseek-ai/dsh-artifact'
import { afterEach, describe, expect, it } from 'vitest'

const fullScope = {
  executionHostId: ExecutionHostId('host-1'),
  producerId: ArtifactProducerId('producer-1'),
  sessionId: ArtifactSessionId('session-1'),
  taskId: ArtifactTaskId('task-1'),
  engagementId: ArtifactEngagementId('engagement-1'),
  scopeRef: ArtifactScopeRef('scope-1'),
}
const differentScope = {
  executionHostId: ExecutionHostId('different'),
  producerId: ArtifactProducerId('different'),
  sessionId: ArtifactSessionId('different'),
  taskId: ArtifactTaskId('different'),
  engagementId: ArtifactEngagementId('different'),
  scopeRef: ArtifactScopeRef('different'),
}
const roots: string[] = []

function stubExecutionHost(ctx: Context, hostId = 'host-1'): void {
  ctx.reflect.provide('executionHost', { current: () => ({ hostId: ExecutionHostId(hostId) }) } as never)
}

function store(ctx: Context): LocalArtifactStore {
  return ctx.artifacts as LocalArtifactStore
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
/** Mutable publish input so rejection cases can corrupt individual fields. */
type MutablePublishRequest = Omit<Mutable<ArtifactPublishRequest>, 'provenance'> & {
  provenance: Mutable<ArtifactPublishRequest['provenance']>
}

const invalidPublicationCases: [string, (input: MutablePublishRequest) => void, string?][] = [
  ['non-byte data', (input) => { input.data = 'bytes' as never }],
  ['oversized data', (input) => { input.data = new Uint8Array(17) }, 'ARTIFACT_TOO_LARGE'],
  ['non-string media type', (input) => { input.mediaType = 1 as never }],
  ['malformed media type', (input) => { input.mediaType = 'plain' }],
  ['non-string opaque value', (input) => { input.kind = 1 as never }],
  ['empty opaque value', (input) => { input.kind = '' }],
  ['long opaque value', (input) => { input.kind = 'k'.repeat(256) }],
  ['controlled opaque value', (input) => { input.kind = 'bad\u0000kind' }],
  ['malformed custom kind', (input) => { input.kind = 'bad kind' }],
  ['non-record authorization', (input) => { input.authorization = null as never }],
  ['blank execution host', (input) => {
    input.authorization = { ...fullScope, executionHostId: '   ' as never } as ArtifactAuthorization
  }],
  ['blank producer', (input) => {
    input.authorization = { ...fullScope, producerId: ArtifactProducerId('   ') } as ArtifactAuthorization
  }],
  ['invalid optional scope', (input) => { input.authorization = { ...fullScope, taskId: ArtifactTaskId('') } }],
  ['invalid source token', (input) => { input.provenance = { ...input.provenance, source: 'bad source' } }],
  ['non-record provenance', (input) => { input.provenance = null as never }],
  ['invalid retention', (input) => { input.retention = 'forever' as never }],
  ['invalid redaction', (input) => { input.redaction = 'partial' as never }],
]

async function setup(): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-artifact-validation-'))
  roots.push(root)
  const ctx = new Context()
  stubExecutionHost(ctx)
  await ctx.plugin(LocalArtifactStore, { root, maxBytes: 16 })
  return { ctx, root }
}

function validInput(): MutablePublishRequest {
  return {
    data: Uint8Array.of(1),
    mediaType: 'application/octet-stream',
    kind: 'custom.kind',
    name: 'C:\\private\\artifact.bin',
    provenance: {
      producerId: fullScope.producerId,
      sessionId: fullScope.sessionId,
      taskId: fullScope.taskId,
      engagementId: fullScope.engagementId,
      scopeRef: fullScope.scopeRef,
      source: 'test.source',
    },
    authorization: fullScope,
    retention: 'task',
    redaction: 'none',
  }
}

async function expectInvalid(mutator: (input: MutablePublishRequest) => void, code = 'ARTIFACT_INVALID_INPUT'): Promise<void> {
  const { ctx } = await setup()
  const input = validInput()
  mutator(input)
  await expect(ctx.artifacts.publish(input)).rejects.toMatchObject({ code })
}

function idOf(ref: ArtifactRef): string {
  return String(ref.artifactId).slice('artifact:'.length)
}

async function stored(root: string, ref: ArtifactRef): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(metadataPath(root, idOf(ref)), 'utf8')) as Record<string, unknown>
}

async function replaceStored(root: string, ref: ArtifactRef, value: unknown): Promise<void> {
  await writeFile(metadataPath(root, idOf(ref)), `${JSON.stringify(value)}\n`)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('publication validation', () => {
  it('applies defaults and sanitizes empty display names', async () => {
    const { ctx } = await setup()
    const input = validInput()
    delete input.name
    delete input.provenance.source
    input.retention = undefined as never
    input.redaction = undefined as never
    input.kind = 'binary'
    input.authorization = {
      executionHostId: fullScope.executionHostId,
      producerId: fullScope.producerId,
    } as ArtifactAuthorization
    input.provenance = { ...input.authorization } as MutablePublishRequest['provenance']
    const unnamed = await ctx.artifacts.publish(input)
    expect(unnamed).toMatchObject({ retention: 'managed', redaction: 'unknown' })
    expect(unnamed).not.toHaveProperty('name')
    await expect(ctx.artifacts.describe({ artifactId: unnamed.artifactId, authorization: input.authorization }))
      .resolves.toEqual(unnamed)

    const blank = validInput()
    blank.name = '/private/\u0000\u001f  '
    const blankRef = await ctx.artifacts.publish(blank)
    expect(blankRef).not.toHaveProperty('name')
  })

  it('accepts the maximum safe opaque length and truncates a long display name', async () => {
    const { ctx } = await setup()
    const input = validInput()
    const scopeRef = ArtifactScopeRef('s'.repeat(255))
    input.authorization = { ...fullScope, scopeRef }
    input.provenance = { ...input.provenance, scopeRef }
    input.name = `folder/${'n'.repeat(300)}`
    const ref = await ctx.artifacts.publish(input)
    expect(ref.name).toHaveLength(255)
  })

  it.each(invalidPublicationCases)('rejects %s', async (_label, mutator, code) => {
    await expectInvalid(mutator, code)
  })

  it.each([
    'producerId',
    'executionHostId',
    'sessionId',
    'taskId',
    'engagementId',
    'scopeRef',
  ] as const)('rejects provenance mismatch for %s', async (field) => {
    await expectInvalid((input) => {
      input.provenance = { ...input.provenance, [field]: differentScope[field] }
    })
  })
})

describe('authorization validation', () => {
  it.each([
    'executionHostId',
    'producerId',
    'sessionId',
    'taskId',
    'engagementId',
    'scopeRef',
  ] as const)('requires the stored %s', async (field) => {
    const { ctx } = await setup()
    const ref = await ctx.artifacts.publish(validInput())
    const authorization = { ...fullScope, [field]: differentScope[field] } as ArtifactAuthorization
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization }))
      .rejects.toMatchObject({ code: 'ARTIFACT_FORBIDDEN' })
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization, maxBytes: 16 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_FORBIDDEN' })
  })

  it('validates lookup scopes and read bounds', async () => {
    const { ctx } = await setup()
    const ref = await ctx.artifacts.publish(validInput())
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: null as never }))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_INPUT' })
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: fullScope, maxBytes: -1 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_INPUT' })
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: fullScope, maxBytes: 1.5 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_INPUT' })
    await expect(ctx.artifacts.describe({ artifactId: 7 as never, authorization: fullScope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_REF' })
  })

  it('reads an empty artifact at an exact zero-byte bound', async () => {
    const { ctx } = await setup()
    const input = validInput()
    input.data = new Uint8Array()
    const ref = await ctx.artifacts.publish(input)
    await expect(store(ctx).read({ artifactId: ref.artifactId, authorization: fullScope, maxBytes: 0 }))
      .resolves.toEqual({ ref, data: new Uint8Array() })
  })
})

describe('stored metadata validation', () => {
  it.each([
    ['non-record metadata', (_record: Record<string, unknown>) => []],
    ['invalid artifact id', (record: Record<string, unknown>) => ({ ...record, artifactId: 'artifact:bad' })],
    ['different valid artifact id', (record: Record<string, unknown>) => {
      const artifactId = String(record.artifactId)
      return { ...record, artifactId: `${artifactId.slice(0, -1)}${artifactId.endsWith('0') ? '1' : '0'}` }
    }],
    ['string bytes', (record: Record<string, unknown>) => ({ ...record, bytes: '1' })],
    ['fractional bytes', (record: Record<string, unknown>) => ({ ...record, bytes: 1.5 })],
    ['negative bytes', (record: Record<string, unknown>) => ({ ...record, bytes: -1 })],
    ['non-string media type', (record: Record<string, unknown>) => ({ ...record, mediaType: 1 })],
    ['malformed media type', (record: Record<string, unknown>) => ({ ...record, mediaType: 'plain' })],
    ['non-string kind', (record: Record<string, unknown>) => ({ ...record, kind: 1 })],
    ['malformed kind', (record: Record<string, unknown>) => ({ ...record, kind: 'bad kind' })],
    ['non-string digest', (record: Record<string, unknown>) => ({ ...record, sha256: 1 })],
    ['malformed digest', (record: Record<string, unknown>) => ({ ...record, sha256: 'bad' })],
    ['non-string timestamp', (record: Record<string, unknown>) => ({ ...record, createdAt: 1 })],
    ['invalid timestamp', (record: Record<string, unknown>) => ({ ...record, createdAt: 'not-a-date' })],
    ['non-canonical timestamp', (record: Record<string, unknown>) => ({ ...record, createdAt: '1970-01-01T00:00:00.000+00:00' })],
    ['invalid retention', (record: Record<string, unknown>) => ({ ...record, retention: 'forever' })],
    ['invalid redaction', (record: Record<string, unknown>) => ({ ...record, redaction: 'partial' })],
    ['non-string name', (record: Record<string, unknown>) => ({ ...record, name: 1 })],
    ['invalid authorization', (record: Record<string, unknown>) => ({ ...record, authorization: null })],
    ['invalid provenance', (record: Record<string, unknown>) => ({ ...record, provenance: null })],
  ])('rejects %s', async (_label, mutate) => {
    const { ctx, root } = await setup()
    const ref = await ctx.artifacts.publish(validInput())
    await replaceStored(root, ref, mutate(await stored(root, ref)))
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: fullScope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it.each([
    'producerId',
    'executionHostId',
    'sessionId',
    'taskId',
    'engagementId',
  ] as const)('rejects stored provenance mismatch for %s', async (field) => {
    const { ctx, root } = await setup()
    const ref = await ctx.artifacts.publish(validInput())
    const record = await stored(root, ref)
    record.provenance = { ...(record.provenance as Record<string, unknown>), [field]: differentScope[field] }
    await replaceStored(root, ref, record)
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: fullScope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it('rejects invalid JSON and drops a sanitized-empty stored name', async () => {
    const { ctx, root } = await setup()
    const ref = await ctx.artifacts.publish(validInput())
    await writeFile(metadataPath(root, idOf(ref)), '{')
    await expect(ctx.artifacts.describe({ artifactId: ref.artifactId, authorization: fullScope }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })

    const replacement = await ctx.artifacts.publish(validInput())
    const record = await stored(root, replacement)
    record.name = '\u0000'
    await replaceStored(root, replacement, record)
    await expect(ctx.artifacts.describe({ artifactId: replacement.artifactId, authorization: fullScope }))
      .resolves.not.toHaveProperty('name')
  })
})
