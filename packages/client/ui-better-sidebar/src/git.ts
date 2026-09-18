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
 * @returns route callbacks sharing the same executor as the sidebarGit Remote namespace.
 */
export function buildGitApi(getOwner: () => SidebarGit | undefined): Record<string, (payload: unknown) => Promise<unknown>> {
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
    'git.status': payload => invoke(owner => owner.status(session(payload))),
    'git.diff': payload => invoke(owner => owner.diff({ ...session(payload), ...optionalPath(payload), staged: boolean(payload, 'staged') })),
    'git.stage': payload => invoke(owner => owner.stage({ ...mutation(payload), ...optionalPath(payload) })),
    'git.unstage': payload => invoke(owner => owner.unstage({ ...mutation(payload), ...optionalPath(payload) })),
    'git.branch': payload => invoke(owner => owner.branches(session(payload))),
    'git.checkout': payload => invoke(owner => owner.checkout({ ...mutation(payload), branch: requireString(payload, 'branch') })),
    'git.prepareCommit': payload => invoke(owner => owner.prepareCommit({ ...mutation(payload), message: requireString(payload, 'message') })),
    'git.commit': payload => invoke(owner => owner.commit({ preview: previewOf(payload) })),
    'git.compare': payload => invoke(owner => owner.compare(session(payload))),
    'git.log': payload => invoke(owner => owner.log({ ...session(payload), ...page(payload, 'count'), ...page(payload, 'skip') })),
    'git.show': payload => invoke(owner => owner.show({ ...session(payload), ref: requireString(payload, 'rev'), path: requireString(payload, 'path') })),
    'git.commit-diff': payload => invoke(owner => owner.commitDiff({ ...session(payload), hash: requireString(payload, 'hash') })),
    'git.discard': payload => invoke(owner => owner.discard({ ...mutation(payload), path: requireString(payload, 'path'), head: nullableString(payload, 'head') })),
    'git.revert': payload => invoke(owner => owner.revert({ ...mutation(payload), hash: requireString(payload, 'hash'), head: nullableString(payload, 'head') })),
    'git.cherry-pick': payload => invoke(owner => owner.cherryPick({ ...mutation(payload), hash: requireString(payload, 'hash'), head: nullableString(payload, 'head') })),
  }
}
