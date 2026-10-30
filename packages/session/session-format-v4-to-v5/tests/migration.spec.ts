import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog, createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'
import { releasedV4SessionFormatCodec, sessionFormatV4ToV5, releasedV5SessionFormatCodec, restoreReleasedV5Artifact } from '../src/index.ts'

const base: SessionFormatHeader = { version: 4, id: 'parent', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const fact: SessionFormatEvent = { type: 'feedback/record', seq: 0, time: 2, data: { text: 'retained' } }
const end = (seq: number): SessionFormatEvent => ({ type: 'session/end-seed', seq, time: 3, data: { inherited: true } })
const delivery = (version: number, sessionId = 'parent', throughSeq = 0): SessionFormatEvent => ({
  type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 3, data: { sessionFormatVersion: version, sessionId, throughSeq },
})

function restore(events: readonly SessionFormatEvent[], header = base) {
  const physical = releasedV4SessionFormatCodec.encodeHeader(header, 0)
  const reader = sessionFormatCatalog.createRestore(physical, { recovery: 'strict', validation: 'current' })
  for (const event of events) reader.decodeRow(releasedV4SessionFormatCodec.encodeEvent(event))
  return reader.finish()
}

describe('V4-to-V5 preservation through the installed catalog', () => {
  it('restores V4 with identical event JSON and a new header, without mutating the source', () => {
    const opaque: SessionFormatEvent = { type: 'vendor/audit', seq: 1, time: 3, ignorable: true,
      data: { version: 4, source: { kind: 'plugin' }, nested: { sessionFormatVersion: 5 } } }
    const events = [fact, opaque]
    const before = JSON.stringify({ header: base, events })
    const restored = restore(events)
    expect(restored.header).toEqual({ ...base, version: 5 })
    expect(restored.events).toEqual(events)
    expect(restored.inheritedEventCount).toBe(0)
    expect(JSON.stringify({ header: base, events })).toBe(before)
    expect(restore(events)).toEqual(restored)
  })

  it.each(['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'])('retains %s attribution and exact model-visible text', (form) => {
    const data = { role: 'user', id: 'message', source: { kind: 'automation', form,
      ...(form === 'notice' ? { summary: 'Observed' } : {}), ...(form === 'snapshot' ? { sections: [{ name: 'test', text: 'exact' }] } : {}) },
    content: [{ type: 'text', text: 'exact model input' }] }
    const event: SessionFormatEvent = { type: 'user/message', seq: 0, time: 2, surfaceOp: 'append', data }
    expect(restore([event]).events).toEqual([event])
  })

  it('derives an unknown inherited cut and preserves parent attribution', () => {
    const header = { ...base, isSeeded: true, parentSession: 'ancestor', delegationDepth: 1 }
    const events = [fact, delivery(4, 'ancestor'), end(2), { ...fact, seq: 3 }]
    const restored = restore(events, header)
    expect(restored.inheritedEventCount).toBe(2)
    expect(restored.events).toEqual(events)
    expect(() => restore([fact], header)).toThrow(/end-seed|inherited/)
  })

  it('keeps historical V4 delivery bytes and does not activate their watermark as V5', () => {
    const events = [fact, delivery(4)]
    expect(restore(events).events).toEqual(events)
    expect(() => restore([fact, delivery(4, 'foreign')])).toThrow(/wrong Session/)
    expect(() => restore([fact, delivery(4, 'parent', 1)])).toThrow(/throughSeq/)
  })

  it.each([false, true])('refuses a source V4 marker already claiming V5, ignorable=%s', (ignorable) => {
    const marker = { ...delivery(5), ...(ignorable ? { ignorable: true } : {}) }
    const before = JSON.stringify(marker)
    expect(() => restore([fact, marker])).toThrow(/claims target format v5/)
    expect(JSON.stringify(marker)).toBe(before)
  })

  it('keeps independently created stage state and inspects compact runs', () => {
    const seeded = { ...base, isSeeded: true }
    const first = sessionFormatV4ToV5.createStage({ sourceHeader: seeded, targetHeader: { ...seeded, version: 5 }, sourceKind: 'decoded', sourceInheritedEventCount: undefined })
    const second = sessionFormatV4ToV5.createStage({ sourceHeader: base, targetHeader: { ...base, version: 5 }, sourceKind: 'decoded', sourceInheritedEventCount: 0 })
    const a = new SessionFormatEventCollector(), b = new SessionFormatEventCollector()
    first.transformRun({ runType: 'fixture', firstSeq: 0, eventCount: 2, *expand() { yield fact; yield end(1) } }, a)
    second.transformEvent(fact, b)
    expect(first.finish(a)).toBe(1)
    expect(second.finish(b)).toBe(0)
    expect(a.values).toEqual([fact, end(1)])
    expect(b.values[0]).toBe(fact)
  })

  it('rejects unknown required events and invalid headers, while preserving unknown ignorable data', () => {
    expect(() => restore([{ ...fact, type: 'vendor/required' }])).toThrow(/unknown event/)
    expect(() => sessionFormatV4ToV5.migrateHeader({ ...base, version: 5 })).toThrow(/v4/)
    expect(() => releasedV5SessionFormatCodec.decodeHeader({ type: 'session', ...base })).toThrow(/v5/)
    expect(() => restore([fact, { ...fact, seq: 3 }])).toThrow(/dense|sequence|seq/)
  })

  it('round trips native V5 framing and activates only V5 delivery validation', () => {
    const header = { ...base, version: 5 }
    const known = new Set(['feedback/record', 'session-log-deepseek/delivery-accepted'])
    const artifact = { header, events: [fact, delivery(4, 'foreign', 1000), { ...delivery(5), seq: 2 }], inheritedEventCount: 0 }
    expect(restoreReleasedV5Artifact(artifact, known)).toBe(artifact)
    expect(() => restoreReleasedV5Artifact({ ...artifact, events: [fact, delivery(5, 'foreign')] }, known)).toThrow(/wrong Session/)
    expect(() => restoreReleasedV5Artifact({ ...artifact, events: [fact, delivery(5, 'parent', 1)] }, known)).toThrow(/throughSeq/)
    const physical = releasedV5SessionFormatCodec.encodeHeader(header, 0)
    const decoder = releasedV5SessionFormatCodec.createDecoder(physical, 'strict')
    const output = new SessionFormatEventCollector()
    decoder.decodeRow(releasedV5SessionFormatCodec.encodeEvent(fact), output)
    expect(decoder.finish(output)).toBe(0)
    expect(decoder.header).toEqual(header)
    expect(output.values).toEqual([fact])
  })

  it('migrates V3 through both adjacent edges with explicit empty child evidence', () => {
    const reader = createSessionFormatCatalogWithChildren([]).createRestore({ type: 'session', ...base, version: 3 }, { recovery: 'strict', validation: 'current' })
    reader.decodeRow(fact)
    const result = reader.finish()
    expect(result.header.version).toBe(5)
    expect(result.events).toEqual([fact])
  })
})
