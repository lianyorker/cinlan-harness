/** HTTP request decoding for the shared sidebar Git owner. */
import { SidebarGitError } from '@deepseek-ai/dsh-sidebar-git'
import type { SidebarGit } from '@deepseek-ai/dsh-sidebar-git'
import type { GitCommitPreview, GitMutationRequest, GitSessionRequest } from '@deepseek-ai/dsh-sidebar-git/types'
import { SidebarError, requireString } from './wire.ts'

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SidebarError('bad-request', 'Expected a JSON object')
  return value as Record<string, unknown>
}

function session(payload: unknown): GitSessionRequest {
  return { sessionId: requireString(payload, 'sessionId') as GitSessionRequest['sessionId'] }
}

function mutation(payload: unknown): GitMutationRequest {
  return { ...session(payload), repositoryRoot: requireString(payload, 'repositoryRoot') }
}

function optionalPath(payload: unknown): { path?: string } {
  return recordOf(payload).path === undefined ? {} : { path: requireString(payload, 'path') }
}

function nullableString(payload: unknown, key: string): string | null {
  return recordOf(payload)[key] === null ? null : requireString(payload, key)
}

function boolean(payload: unknown, key: string): boolean {
  const value = recordOf(payload)[key]
  if (typeof value !== 'boolean') throw new SidebarError('bad-request', key + ' must be a boolean')
  return value
}

function previewOf(payload: unknown): GitCommitPreview {
  const preview = recordOf(payload).preview
  return {
    ...session(preview), root: requireString(preview, 'root'), gitDirectory: requireString(preview, 'gitDirectory'),
    sessionCwd: requireString(preview, 'sessionCwd'), head: nullableString(preview, 'head'), branch: nullableString(preview, 'branch'),
    indexFingerprint: requireString(preview, 'indexFingerprint'), message: requireString(preview, 'message'),
    attributed: boolean(preview, 'attributed'),
  }
}

function page(payload: unknown, key: 'count' | 'skip'): { count?: number; skip?: number } {
  const value = recordOf(payload)[key]
  if (value === undefined) return {}
  if (typeof value !== 'number') throw new SidebarError('bad-request', key + ' must be a number')
  return { [key]: value }
}

/**
 * Decode the legacy HTTP carrier without accepting caller-supplied working directories.
 * @param getOwner - current concrete Git service; missing deployments report unavailable.
 * @returns route callbacks accepting decoded payloads and request cancellation signals while sharing the sidebarGit Remote executor.
 */
export function buildGitApi(
  getOwner: () => SidebarGit | undefined,
): Record<string, (payload: unknown, signal?: AbortSignal) => Promise<unknown>> {
  const invoke = async (operation: (owner: SidebarGit) => Promise<unknown>): Promise<unknown> => {
    const owner = getOwner()
    if (owner === undefined) throw new SidebarError('unavailable', 'The sidebar Git capability is unavailable', 503)
    try {
      return await operation(owner)
    } catch (error) {
      if (error instanceof SidebarGitError) {
        const status = error.code === 'unavailable' ? 503 : error.code === 'stale' || error.code === 'conflict' ? 409 : 400
        throw new SidebarError(error.code, error.message, status)
      }
      throw error
    }
  }
  return {
    'git.status': (payload, signal) => invoke(owner => owner.status(session(payload), signal)),
    'git.diff': (payload, signal) => invoke(owner => owner.diff({ ...session(payload), ...optionalPath(payload), staged: boolean(payload, 'staged') }, signal)),
    'git.stage': (payload, signal) => invoke(owner => owner.stage({ ...mutation(payload), ...optionalPath(payload) }, signal)),
    'git.unstage': (payload, signal) => invoke(owner => owner.unstage({ ...mutation(payload), ...optionalPath(payload) }, signal)),
    'git.branch': (payload, signal) => invoke(owner => owner.branches(session(payload), signal)),
    'git.checkout': (payload, signal) => invoke(owner => owner.checkout({ ...mutation(payload), branch: requireString(payload, 'branch') }, signal)),
    'git.prepareCommit': (payload, signal) => invoke(owner => owner.prepareCommit({ ...mutation(payload), message: requireString(payload, 'message') }, signal)),
    'git.commit': (payload, signal) => invoke(owner => owner.commit({ preview: previewOf(payload) }, signal)),
    'git.compare': (payload, signal) => invoke(owner => owner.compare(session(payload), signal)),
    'git.log': (payload, signal) => invoke(owner => owner.log({ ...session(payload), ...page(payload, 'count'), ...page(payload, 'skip') }, signal)),
    'git.show': (payload, signal) => invoke(owner => owner.show({ ...session(payload), ref: requireString(payload, 'rev'), path: requireString(payload, 'path') }, signal)),
    'git.commit-diff': (payload, signal) => invoke(owner => owner.commitDiff({ ...session(payload), hash: requireString(payload, 'hash') }, signal)),
    'git.discard': (payload, signal) => invoke(owner => owner.discard({ ...mutation(payload), path: requireString(payload, 'path'), head: nullableString(payload, 'head') }, signal)),
    'git.revert': (payload, signal) => invoke(owner => owner.revert({ ...mutation(payload), hash: requireString(payload, 'hash'), head: nullableString(payload, 'head') }, signal)),
    'git.cherry-pick': (payload, signal) => invoke(owner => owner.cherryPick({ ...mutation(payload), hash: requireString(payload, 'hash'), head: nullableString(payload, 'head') }, signal)),
  }
}
