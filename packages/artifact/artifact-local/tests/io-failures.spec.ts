/** Deterministic filesystem-failure coverage for local artifact mechanics. */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactId, ArtifactProducerId } from '@deepseek-ai/dsh-artifact'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import { describeArtifactFile, MAX_ARTIFACT_BYTES, publishArtifactFile, readArtifactFile } from '../src/store.ts'
import type { ArtifactAuthorization, ArtifactPublishRequest } from '@deepseek-ai/dsh-artifact'

const io = vi.hoisted(() => ({
  chmod: vi.fn(),
  link: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  unlink: vi.fn(),
}))

vi.mock('node:fs/promises', () => io)

const uuid = '00000000-0000-4000-8000-000000000001'
const artifactId = ArtifactId(`artifact:${uuid}`)
const authorization: ArtifactAuthorization & {
  readonly executionHostId: ExecutionHostId
  readonly producerId: ArtifactProducerId
} = {
  executionHostId: ExecutionHostId('host-1'),
  producerId: ArtifactProducerId('producer-1'),
}
const byte = Uint8Array.of(1)
const record = {
  artifactId,
  mediaType: 'application/octet-stream',
  kind: 'binary',
  bytes: 1,
  sha256: createHash('sha256').update(byte).digest('hex'),
  createdAt: new Date(0).toISOString(),
  provenance: { ...authorization },
  authorization,
  retention: 'managed',
  redaction: 'unknown',
}

function publication(): ArtifactPublishRequest {
  return {
    data: byte,
    mediaType: 'application/octet-stream',
    kind: 'binary',
    provenance: { ...authorization },
    authorization,
    retention: 'managed',
    redaction: 'unknown',
  }
}

function fileInfo(size = 1, dev = 1, ino = 1): { isFile(): true; size: number; dev: number; ino: number } {
  return { isFile: () => true, size, dev, ino }
}

function nonFileInfo(): { isFile(): false; size: number; dev: number; ino: number } {
  return { isFile: () => false, size: 0, dev: 1, ino: 1 }
}

function successfulMetadataReadHandle(): {
  stat: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  const data = Buffer.from(`${JSON.stringify(record)}\n`)
  return {
    stat: vi.fn().mockResolvedValue(fileInfo(data.byteLength)),
    read: vi.fn().mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = Math.min(length, Math.max(0, data.byteLength - position))
      data.copy(buffer, offset, position, position + bytesRead)
      return { bytesRead }
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function successfulWriteHandle(): {
  writeFile: ReturnType<typeof vi.fn>
  sync: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  return {
    writeFile: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.chmod.mockResolvedValue(undefined)
  io.link.mockResolvedValue(undefined)
  io.lstat.mockResolvedValue(fileInfo())
  io.mkdir.mockResolvedValue(undefined)
  io.open.mockImplementation(async (path: string) => {
    if (path.includes('metadata')) return successfulMetadataReadHandle()
    throw new Error(`unexpected open: ${path}`)
  })
  io.unlink.mockResolvedValue(undefined)
})

describe('publication cleanup failures', () => {
  it.each([-1, 1.5, MAX_ARTIFACT_BYTES + 1])('rejects invalid provider limit %s before touching storage', async (maxBytes) => {
    await expect(publishArtifactFile('root', publication(), maxBytes, ExecutionHostId('host-1')))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_INPUT' })
    expect(io.open).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform !== 'win32')('inherits the configured Windows DACL without treating mode bits as ACL enforcement', async () => {
    io.open
      .mockResolvedValueOnce(successfulWriteHandle())
      .mockResolvedValueOnce(successfulWriteHandle())
    await expect(publishArtifactFile('root', publication(), 1, ExecutionHostId('host-1'))).resolves.toMatchObject({ bytes: 1 })
    expect(io.chmod).not.toHaveBeenCalled()
  })

  it('cleans the staging path when exclusive open fails before a handle exists', async () => {
    const openError = new Error('open failed')
    io.open.mockRejectedValue(openError)
    await expect(publishArtifactFile('root', publication(), 1, ExecutionHostId('host-1'))).rejects.toMatchObject({
      code: 'ARTIFACT_WRITE_FAILED',
      cause: openError,
    })
    expect(io.unlink).toHaveBeenCalledOnce()
  })

  it('closes an open staging file and suppresses secondary cleanup failures', async () => {
    const writeError = new Error('write failed')
    io.open.mockResolvedValue({
      writeFile: vi.fn().mockRejectedValue(writeError),
      sync: vi.fn(),
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    })
    io.unlink.mockRejectedValue(new Error('unlink failed'))

    await expect(publishArtifactFile('root', publication(), 1, ExecutionHostId('host-1'))).rejects.toMatchObject({
      code: 'ARTIFACT_WRITE_FAILED',
      cause: writeError,
    })
  })

  it('preserves the metadata failure when rollback cannot remove the object', async () => {
    const metadataError = new Error('metadata write failed')
    io.open
      .mockResolvedValueOnce(successfulWriteHandle())
      .mockResolvedValueOnce({
        writeFile: vi.fn().mockRejectedValue(metadataError),
        sync: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      })
    io.unlink
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback failed'))

    await expect(publishArtifactFile('root', publication(), 1, ExecutionHostId('host-1'))).rejects.toMatchObject({
      code: 'ARTIFACT_WRITE_FAILED',
      cause: metadataError,
    })
  })
})

describe('read failures', () => {
  it.each([-1, 1.5])('rejects invalid direct read bound %s before touching storage', async (maxBytes) => {
    await expect(readArtifactFile('root', { artifactId, authorization, maxBytes }))
      .rejects.toMatchObject({ code: 'ARTIFACT_INVALID_INPUT' })
    expect(io.open).not.toHaveBeenCalled()
  })

  it('maps a metadata I/O failure without exposing its path', async () => {
    const cause = Object.assign(new Error('denied'), { code: 'EACCES' })
    io.lstat.mockRejectedValue(cause)
    await expect(describeArtifactFile('private-root', { artifactId, authorization })).rejects.toMatchObject({
      code: 'ARTIFACT_READ_FAILED',
      cause,
    })
  })

  it('rejects metadata replaced after its no-follow observation', async () => {
    for (const replacement of [fileInfo(1, 1, 2), fileInfo(1, 2, 1)]) {
      const opened = successfulMetadataReadHandle()
      opened.stat.mockResolvedValue(replacement)
      io.open.mockResolvedValueOnce(opened)
      await expect(describeArtifactFile('root', { artifactId, authorization }))
        .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
      expect(opened.read).not.toHaveBeenCalled()
      expect(opened.close).toHaveBeenCalledOnce()
    }
  })

  it('rejects non-files opened after observation and POSIX no-follow failures', async () => {
    const opened = successfulMetadataReadHandle()
    opened.stat.mockResolvedValue(nonFileInfo())
    io.open.mockResolvedValueOnce(opened)
    await expect(describeArtifactFile('root', { artifactId, authorization }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })

    const loop = Object.assign(new Error('link replaced'), { code: 'ELOOP' })
    io.open.mockRejectedValueOnce(loop)
    await expect(describeArtifactFile('root', { artifactId, authorization }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it('preserves verified metadata when closing its stable handle fails', async () => {
    const opened = successfulMetadataReadHandle()
    opened.close.mockRejectedValue(new Error('close failed'))
    io.open.mockResolvedValue(opened)
    await expect(describeArtifactFile('root', { artifactId, authorization }))
      .resolves.toMatchObject({ artifactId })
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid observed file size %s', async (size) => {
    const opened = successfulMetadataReadHandle()
    opened.stat.mockResolvedValue(fileInfo(size))
    io.open.mockResolvedValueOnce(opened)
    await expect(describeArtifactFile('root', { artifactId, authorization }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it('rejects metadata above its fixed parsing bound', async () => {
    const opened = successfulMetadataReadHandle()
    opened.stat.mockResolvedValue(fileInfo(64 * 1024))
    io.open.mockResolvedValueOnce(opened)
    await expect(describeArtifactFile('root', { artifactId, authorization }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
    expect(opened.read).not.toHaveBeenCalled()
  })

  it('rejects an object that stops yielding bytes before its reported size', async () => {
    const handle = {
      stat: vi.fn().mockResolvedValue(fileInfo()),
      read: vi.fn().mockResolvedValue({ bytesRead: 0 }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    io.open.mockResolvedValueOnce(successfulMetadataReadHandle()).mockResolvedValueOnce(handle)
    await expect(readArtifactFile('root', { artifactId, authorization, maxBytes: 1 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_CORRUPT' })
  })

  it('rejects an object that grows after its size check', async () => {
    const handle = {
      stat: vi.fn().mockResolvedValue(fileInfo()),
      read: vi.fn()
        .mockImplementationOnce(async (buffer: Buffer) => {
          buffer[0] = 1
          return { bytesRead: 1 }
        })
        .mockResolvedValueOnce({ bytesRead: 1 }),
      close: vi.fn().mockResolvedValue(undefined),
    }
    io.open.mockResolvedValueOnce(successfulMetadataReadHandle()).mockResolvedValueOnce(handle)
    await expect(readArtifactFile('root', { artifactId, authorization, maxBytes: 1 }))
      .rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' })
  })

  it('rejects an object larger than Node can allocate even under a larger caller bound', async () => {
    const size = MAX_ARTIFACT_BYTES + 1
    const handle = {
      stat: vi.fn().mockResolvedValue(fileInfo(size)),
      read: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    io.open.mockResolvedValueOnce(successfulMetadataReadHandle()).mockResolvedValueOnce(handle)
    await expect(readArtifactFile('root', { artifactId, authorization, maxBytes: size }))
      .rejects.toMatchObject({ code: 'ARTIFACT_TOO_LARGE' })
    expect(handle.read).not.toHaveBeenCalled()
  })

  it('maps object I/O failures and suppresses a close failure', async () => {
    const cause = Object.assign(new Error('read denied'), { code: 'EACCES' })
    const handle = {
      stat: vi.fn().mockRejectedValue(cause),
      read: vi.fn(),
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    }
    io.open.mockResolvedValueOnce(successfulMetadataReadHandle()).mockResolvedValueOnce(handle)
    await expect(readArtifactFile('root', { artifactId, authorization, maxBytes: 1 })).rejects.toMatchObject({
      code: 'ARTIFACT_READ_FAILED',
      cause,
    })
  })

  it('preserves verified bytes when closing the object handle fails', async () => {
    const handle = {
      stat: vi.fn().mockResolvedValue(fileInfo()),
      read: vi.fn()
        .mockImplementationOnce(async (buffer: Buffer) => {
          buffer[0] = 1
          return { bytesRead: 1 }
        })
        .mockResolvedValueOnce({ bytesRead: 0 }),
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    }
    io.open.mockResolvedValueOnce(successfulMetadataReadHandle()).mockResolvedValueOnce(handle)
    const result = await readArtifactFile('root', { artifactId, authorization, maxBytes: 1 })
    expect(result.ref.artifactId).toBe(artifactId)
    expect(result.data).toEqual(byte)
  })
})
