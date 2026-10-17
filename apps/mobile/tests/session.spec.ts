/** Wire projection regressions, including reconnect and surface replacement. */
import { expect, it } from 'vitest'
import { applySessionFrame, applyStreamFrame } from '../src/transport/session'

const event = (seq: number, type: string, data: unknown, surfaceOp: unknown = 'append') => ({ type: 'event', event: { seq, time: seq, type, data, surfaceOp } })
it('folds logged prompts, tool results, duplicate events and replacements', () => {
  const prompt = event(1, 'user/message', { content: [{ type: 'text', text: 'actual prompt' }] })
  const call = event(2, 'tool/call', { callId: 'call', name: 'shell', arguments: '{"command":"pwd"}' })
  const result = event(3, 'tool/result', { message: { toolCallId: 'call', content: [{ type: 'text', text: '/workspace' }] } })
  let steps = applySessionFrame([], { type: 'snapshot', records: [prompt, call, result] })
  expect(steps[1]?.toolCalls?.[0]?.state).toBe('completed')
  expect(applySessionFrame(steps, prompt)).toBe(steps)
  steps = applySessionFrame(steps, event(4, 'user/message', { content: [{ type: 'text', text: 'condensed' }] }, { op: 'replace', startSeq: 1, endSeq: 3 }))
  expect(steps.map(step => step.content)).toEqual(['condensed'])
  expect(steps).toMatchSnapshot()
})
it('reconstructs a live baseline and refuses gaps or chunks from another attempt', () => {
  let stream = applyStreamFrame(undefined, { type: 'snapshot', assistantStream: { revision: 5, activeAttempt: { attemptId: 'attempt', nextIndex: 2, stream: [{ type: 'text-chunks', texts: ['baseline'] }] } } })
  const frame = (revision: number, index: number, attemptId = 'attempt') => ({ type: 'assistant-stream', frame: { type: 'chunk', revision, index, attemptId, chunk: { type: 'text-delta', text: ' more' } } })
  stream = applyStreamFrame(stream, frame(6, 2))
  expect(stream.content).toBe('baseline more')
  expect(applyStreamFrame(stream, frame(8, 3)).content).toBe('')
  expect(applyStreamFrame(stream, frame(7, 3, 'wrong')).content).toBe('')
  expect(applyStreamFrame(stream, { type: 'snapshot', records: [] }).content).toBe('')
})

it('projects assistant message content when a compact stream is absent', () => {
  const message = event(7, 'assistant/message', { content: [{ type: 'text', text: 'persisted answer' }] })
  expect(applySessionFrame([], message).map(step => step.content)).toEqual(['persisted answer'])
})

it('projects Web message envelopes and excludes non-user runtime context', () => {
  const runtime = event(8, 'user/message', { message: { id: 'runtime', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'runtime context' }] } })
  const prompt = event(9, 'user/message', { message: { id: 'prompt', source: { kind: 'user' }, content: [{ type: 'text', text: '哈哈' }] } })
  const answer = event(10, 'assistant/message', { message: { id: 'answer', source: { kind: 'assistant' }, content: [{ type: 'text', text: '收到' }] } })
  const steps = applySessionFrame([], { type: 'snapshot', records: [runtime, prompt, answer] })
  expect(steps.map(step => [step.role, step.content])).toEqual([['user', '哈哈'], ['assistant', '收到']])
})
