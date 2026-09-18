/**
 * Workspace-safe file mutations for the sidebar (the upload route today).
 *
 * Every write is lexically confined to the session workspace: the upload
 * directory is resolved absolute and must sit inside the session cwd, the
 * relative path is sanitized (absolute paths, '.', '..' and empty segments
 * are refused), and the final target must stay inside both. Containment is
 * lexical (no symlink resolution) — a symlinked directory inside the cwd can
 * redirect writes outside, matching the trust model of the other /sidebar/*
 * routes. Bytes stream from the request body to a uniquely named temp sibling
 * and are renamed into place, so a failed, aborted, or oversized upload never
 * leaves a partial file at the target path. Cancellation is checked before rename;
 * once rename starts, a committed target is not rolled back.
 */
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isWithin, requireAbsolute } from './fs-tree.ts'
import { SidebarError } from './wire.ts'

/** Whether a failed rename means that the Windows target appeared first. */
function isRenameConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'EEXIST' || code === 'EPERM'
}

/**
 * Move one completed upload into place. POSIX rename replaces an existing file;
 * Windows requires removing that file first, and concurrent uploaders may race
 * through that replacement, so each conflict retries the same operation.
 *
 * @param temporaryPath - uniquely named completed upload.
 * @param target - final workspace path.
 */
async function commitUpload(temporaryPath: string, target: string): Promise<void> {
  if (process.platform !== 'win32') {
    await rename(temporaryPath, target)
    return
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rename(temporaryPath, target)
      return
    } catch (error) {
      if (!isRenameConflict(error) || attempt === 3) throw error
      await rm(target, { force: true })
    }
  }
}

/** Inputs of one upload: the session scope plus the request body stream. */
export interface WorkspaceUploadInput {
  /** The session workspace root; target and directory must stay inside it. */
  cwd: string
  /** Absolute upload directory chosen by the client (inside `cwd`). */
  dir: string
  /** Relative path below `dir` (absolute paths, '.', '..' and empty segments refused). */
  relativePath: string
  /** The request body stream (raw bytes). */
  chunks: AsyncIterable<string | Uint8Array>
  /** Byte cap; an oversized upload is refused without touching the target. */
  limit: number
  /** Abort before commit; cancellation after rename starts does not roll back a completed file. */
  signal?: AbortSignal
}

/**
 * Stream `chunks` into a uniquely named temp sibling, then commit it to
 * `dir/relativePath`. POSIX uses an atomic replacement; Windows removes an
 * existing target before retrying the rename because its filesystem does not
 * replace open files through rename. The parent directory is created on demand
 * (recursive), and each concurrent upload owns its own temp file; one completed
 * upload wins without cross-talk or a leftover temp file.
 *
 * @throws SidebarError with a wire code for containment, shape, and size
 * failures; the temp file is always removed on failure.
 */
export async function writeWorkspaceUpload(input: WorkspaceUploadInput): Promise<{ path: string; size: number }> {
  const { cwd, dir, relativePath, chunks, limit, signal } = input
  signal?.throwIfAborted()
  const base = requireAbsolute(dir)
  if (!isWithin(cwd, base)) {
    throw new SidebarError('forbidden', 'upload directory escapes the session workspace', 403)
  }
  if (relativePath === '' || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    throw new SidebarError('bad-request', 'relativePath must stay below the upload directory', 400)
  }
  const segments = relativePath.split(/[\\/]/)
  if (segments.some(part => part === '' || part === '.' || part === '..')) {
    throw new SidebarError('bad-request', 'relativePath must stay below the upload directory', 400)
  }
  const target = join(base, ...segments)
  if (!isWithin(cwd, target) || !isWithin(base, target)) {
    throw new SidebarError('forbidden', 'target escapes the session workspace', 403)
  }
  const tmp = join(dirname(target), `.${basename(target)}.dsh-upload-${randomUUID()}.tmp`)
  await mkdir(dirname(target), { recursive: true })
  const stream = createWriteStream(tmp, { flags: 'wx' })
  // Resolves once the stream fully closes; created up front so a stream that
  // already closed (successful end, later failure) cannot leave the wait hanging.
  const closed = new Promise<void>((resolve) => {
    stream.once('close', () => { resolve() })
  })
  let size = 0
  let streamError: Error | undefined
  // A permanent 'error' listener keeps a failing disk from crashing the host:
  // every await below surfaces the failure through the promise chain instead.
  stream.on('error', (error) => { streamError = error })
  try {
    for await (const chunk of chunks) {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > limit) throw new SidebarError('too-large', `upload exceeds the ${limit} byte limit`, 413)
      if (!stream.write(buffer)) await once(stream, 'drain')
      if (streamError !== undefined) throw streamError
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    })
    if (streamError !== undefined) throw streamError
    signal?.throwIfAborted()
    await commitUpload(tmp, target)
    const info = await stat(target)
    return { path: target, size: info.size }
  } catch (error) {
    // Wait for the stream to fully close before unlinking (Windows locks open
    // files), then remove our own uniquely named temp file.
    stream.destroy()
    await closed.catch(() => {})
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}
