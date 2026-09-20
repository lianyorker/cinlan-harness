import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PairedSessionPolicy } from '../src/policy.ts'
const grant = { sessionIds: ['original' as SessionId], scopes: ['session:read', 'session:send', 'session:stop', 'questions:answer'] as const }

describe('paired Session authorization', () => {
  it('permits original Session text send and stop but denies foreign Sessions and Host management', () => {
    const policy = new PairedSessionPolicy(grant, 8, 8192)
    expect(() =>{  policy.authorizeInvocation('session/prompt', { args: { request: { sessionId: 'original', requestId: 'prompt-1', mode: 'queue', content: [{ type: 'text', text: 'continue' }] } } }) }).not.toThrow()
    expect(() =>{  policy.authorizeInvocation('session/cancel', { args: { request: { sessionId: 'original' } } }) }).not.toThrow()
    for (const key of ['cwd', 'preset', 'workingDirectory', 'model', 'workspaceId']) {
      expect(() =>{  policy.authorizeInvocation('session/prompt', { args: { request: { sessionId: 'original', requestId: 'prompt-1', mode: 'queue', content: [{ type: 'text', text: 'continue' }], [key]: 'ungranted' } } }) }).toThrow()
    }
    for (const endpoint of ['pairing/enable', 'credentials/list', 'settings/describe', 'session/create', 'commands/execute']) expect(() =>{  policy.authorizeInvocation(endpoint, { args: {} }) }).toThrow()
    expect(() =>{  policy.authorizeInvocation('session/cancel', { args: { request: { sessionId: 'foreign' } } }) }).toThrow()
    expect(() =>{  policy.authorizeInvocation('session/prompt', { args: { request: { sessionId: 'original', requestId: 'prompt-1', mode: 'queue', content: [{ type: 'file', receiptId: 'other-session' }] } } }) }).toThrow()
  })
  it('filters list rows, baseline maps, incrementals and unknown projections', () => {
    const policy = new PairedSessionPolicy(grant, 8, 8192)
    expect(policy.projectResult('session/list', {}, { items: [{ sessionId: 'original', parentSessionId: 'foreign' }, { sessionId: 'foreign' }] })).toEqual({ items: [{ sessionId: 'original' }] })
    expect(policy.projectStreamItem('session/control', {}, { type: 'baseline', value: { queues: { original: [], foreign: ['secret'] }, jobs: {}, projections: { original: { asOfSeq: 2, values: { title: 'Original', secretPlugin: 'secret' } }, foreign: { values: {} } } } })).toEqual({ type: 'baseline', value: { queues: { original: [] }, jobs: {}, projections: { original: { asOfSeq: 2, values: { title: 'Original' } } } } })
    expect(policy.projectStreamItem('session/control', {}, { type: 'jobs', sessionId: 'foreign', jobs: [] })).toBeUndefined()
    expect(policy.projectStreamItem('session/control', {}, { type: 'projection', sessionId: 'original', key: 'secretPlugin', value: 'secret' })).toBeUndefined()
    expect(policy.permitsEvent({ event: 'settings/document-updated', args: ['secret'] })).toBe(false)
    expect(policy.permitsEvent({ event: 'api-session/status', args: ['foreign', true] })).toBe(false)
    expect(policy.permitsEvent({ event: 'api-session/status', args: ['original', true] })).toBe(true)
  })
})
