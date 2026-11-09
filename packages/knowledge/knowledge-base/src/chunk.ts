/**
 * Paragraph-level chunking for the knowledge base: split normalized document
 * text into slices under a character window, respecting heading structure so
 * each chunk carries its heading chain. Pure functions; the ingest path
 * feeds their output straight into the chunks table.
 * @module @cinlan/knowledge-base/chunk
 */

import type { KnowledgeChunk } from './schema.ts'

/** Soft window: chunks longer than this are split on paragraph/sentence seams. */
const CHUNK_WINDOW = 1200

interface Section {
  /** Heading chain, e.g. `安装 / 配置`; empty for the preamble. */
  readonly heading: string
  /** Paragraph blocks under this heading. */
  readonly blocks: readonly string[]
}

/**
 * Split document text into sections by markdown ATX headings, tracking the
 * heading chain for each. Non-markdown text yields one preamble section.
 * @param text Normalized document text (CRLF already folded).
 * @returns sections in document order.
 */
export function splitSections(text: string): Section[] {
  const lines = text.split('\n')
  const sections: Section[] = []
  const stack: Array<{ level: number; title: string }> = []
  let current: { heading: string; blocks: string[] } = { heading: '', blocks: [] }
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    const joined = paragraph.join('\n').trim()
    paragraph = []
    if (joined !== '') current.blocks.push(joined)
  }
  const flushSection = (): void => {
    flushParagraph()
    if (current.blocks.length > 0 || current.heading !== '') {
      sections.push({ heading: current.heading, blocks: current.blocks })
      current = { heading: current.heading, blocks: [] }
    }
  }

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading !== null) {
      flushSection()
      const level = heading[1]?.length ?? 0
      while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop()
      stack.push({ level, title: heading[2] ?? '' })
      current.heading = stack.map(entry => entry.title).join(' / ')
      sections.push({ heading: current.heading, blocks: current.blocks })
      current = { heading: current.heading, blocks: [] }
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }
  flushSection()
  return sections
}

/**
 * Split one long block into window-sized pieces on sentence seams, falling
 * back to hard cuts when a single sentence exceeds the window.
 * @param block Paragraph text.
 * @param window Character window (positive).
 * @returns slices, each no longer than `window` except an unsplittable sentence.
 */
function splitBlock(block: string, window: number): string[] {
  if (block.length <= window) return [block]
  const pieces: string[] = []
  const sentences = block.split(/(?<=[。！？.!?])\s*/)
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > window) {
      if (current !== '') pieces.push(current)
      for (let offset = 0; offset < sentence.length; offset += window) {
        pieces.push(sentence.slice(offset, offset + window))
      }
      current = ''
      continue
    }
    if (current.length + sentence.length + 1 > window) {
      if (current !== '') pieces.push(current)
      current = sentence
    } else {
      current = current === '' ? sentence : `${current} ${sentence}`
    }
  }
  if (current !== '') pieces.push(current)
  return pieces
}

/**
 * Chunk a document into window-bounded slices with heading chains. Chunk ids
 * are assigned here and stay stable per (docId, ordinal); re-ingest replaces
 * the document's chunks wholesale.
 * @param docId Document identity the chunks belong to.
 * @param text Normalized document text.
 * @returns chunks in document order, ordinal 0-based.
 */
export function chunkDocument(docId: string, text: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = []
  let ordinal = 0
  for (const section of splitSections(text)) {
    const pieces = section.blocks.flatMap(block => splitBlock(block, CHUNK_WINDOW))
    for (const piece of pieces) {
      chunks.push({
        chunkId: `${docId}#${ordinal}`,
        docId,
        ordinal,
        text: piece,
        heading: section.heading,
      })
      ordinal += 1
    }
  }
  return chunks
}

/**
 * Best-effort title: the first markdown heading, else the first non-empty
 * line, else the path's file name.
 * @param text Raw document text.
 * @param path Source-relative path.
 * @returns the extracted title.
 */
export function extractTitle(text: string, path: string): string {
  const heading = /^#{1,6}\s+(.+?)\s*$/m.exec(text)
  if (heading !== null && heading[1] !== undefined) return heading[1]
  const firstLine = text.split('\n').find(line => line.trim() !== '')
  if (firstLine !== undefined) return firstLine.trim().slice(0, 120)
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.[^.]+$/, '')
}
