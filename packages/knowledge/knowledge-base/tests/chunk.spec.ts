import { describe, expect, it } from 'vitest'
import { chunkDocument, extractTitle } from '../src/chunk.ts'
import { segmentCjk, toMatchExpression } from '../src/search.ts'

describe('chunkDocument', () => {
  it('splits by heading and tracks the heading chain', () => {
    const chunks = chunkDocument('doc1', [
      '# 部署',
      '',
      '部署概览正文。',
      '',
      '## 配置',
      '',
      '配置正文很长，'.repeat(100),
    ].join('\n'))
    const headings = chunks.map(chunk => chunk.heading)
    expect(headings[0]).toBe('部署')
    expect(headings).toContain('部署 / 配置')
    // ordinals are contiguous from 0
    expect(chunks.map((chunk, index) => chunk.ordinal === index).every(Boolean)).toBe(true)
    // all chunks belong to the document and carry stable ids
    for (const chunk of chunks) {
      expect(chunk.docId).toBe('doc1')
      expect(chunk.chunkId).toBe(`doc1#${chunk.ordinal}`)
    }
  })

  it('bounds long chunks by splitting on sentence seams', () => {
    const sentence = 'This is one sentence. '
    const text = sentence.repeat(100)
    const chunks = chunkDocument('doc2', text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1200)
      expect(chunk.text.endsWith('.')).toBe(true)
    }
  })

  it('keeps the preamble as an unnamed section', () => {
    const chunks = chunkDocument('doc3', '前言段落。\n\n第二段。')
    expect(chunks).toHaveLength(2)
    for (const chunk of chunks) expect(chunk.heading).toBe('')
    expect(chunks[0]!.text).toContain('前言段落')
  })
})

describe('extractTitle', () => {
  it('prefers the first heading, then the first line, then the file name', () => {
    expect(extractTitle('# 标题\n\n正文', 'a/b.md')).toBe('标题')
    expect(extractTitle('首行即标题\n正文', 'a/b.md')).toBe('首行即标题')
    expect(extractTitle('', 'a/readme.md')).toBe('readme')
  })
})

describe('segmentCjk + toMatchExpression', () => {
  it('breaks Han runs with zero-width separators only inside runs', () => {
    expect(segmentCjk('部署网关')).toBe('部\u200b署\u200b网\u200b关')
    expect(segmentCjk('使用 Docker 部署')).toBe('使\u200b用 Docker 部\u200b署')
    expect(segmentCjk('plain ascii')).toBe('plain ascii')
    // no visible character is added or removed
    expect(segmentCjk('网关端口').replaceAll('\u200b', '')).toBe('网关端口')
  })

  it('renders bare queries as quoted phrases and passes operators through', () => {
    expect(toMatchExpression('网关')).toBe('"网 关"')
    expect(toMatchExpression('gateway config')).toBe('"gateway" "config"')
    expect(toMatchExpression('8080端口')).toBe('"8080" "端 口"')
    expect(toMatchExpression('部署 AND 网关')).toBe('"部 署" AND "网 关"')
    expect(toMatchExpression('   ')).toBeUndefined()
  })
})
