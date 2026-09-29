/**
 * Frozen-aware surface selection and deterministic chunk partitioning.
 *
 * @module @deepseek-ai/dsh-compact-recallable/chunking
 */

import {
  CompactionId,
  isCompactCheckpointSource,
  toolPairingBalancedAfter,
} from '@deepseek-ai/dsh-compaction'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import type { ChunkSlice, PartitionPlan } from './types.ts'

/** Check if a session event represents a history recall invocation or result. */
export function isRecallToolEvent(event: SessionEvent): boolean {
  if (event.type === 'tool/call') {
    return event.data.name === 'history_read' || event.data.name === 'history_search'
  }
  if (event.type === 'tool/result') {
    const rawData = event.data as unknown as { name?: string }
    return rawData.name === 'history_read' || rawData.name === 'history_search'
  }
  return false
}

/** Check if all message events in a sequence span are recall tool invocations. */
export function isRecalledOnlySpan(session: Session, shadowedSeqs: readonly SessionSeq[]): boolean {
  const seqSet = new Set(shadowedSeqs)
  const events = session.snapshotEvents().filter(e => seqSet.has(e.seq))
  if (events.length === 0) return false
  return events.every(e => isRecallToolEvent(e) || e.type === 'compaction/summary' || e.type === 'compaction/start' || e.type === 'compaction/end')
}

/**
 * Find the surface index of the last committed index checkpoint.
 * Stubs are identified by matching `compaction/summary` event with `checkpointKind === 'index'`.
 * @param session - session owning the surface.
 * @returns surface index, or -1 if no index checkpoint exists.
 */
export function findLastCommittedIndexCheckpoint(session: Session): number {
  const nodes = session.surface.nodes
  const events = session.snapshotEvents()
  const summaryByCompactionId = new Map<string, SessionEvent<'compaction/summary'>>()
  for (const event of events) {
    if (event.type === 'compaction/summary') {
      summaryByCompactionId.set(event.data.compactionId, event)
    }
  }

  let lastIndex = -1
  for (const [i, seq] of nodes.entries()) {
    const event = session.eventAt(seq)
    if (event === undefined) break
    if (event.type !== 'user/message') {
      if (i > 0 || event.type !== 'system/message') break
      continue
    }
    const source = event.data.source as unknown as { compactionId?: CompactionId }
    if (!isCompactCheckpointSource(event.data.source) || source.compactionId === undefined) {
      break
    }
    const summaryEvent = summaryByCompactionId.get(source.compactionId)
    if (summaryEvent !== undefined && (summaryEvent.data as { checkpointKind?: string }).checkpointKind === 'index') {
      lastIndex = i
    } else {
      break
    }
  }
  return lastIndex
}

/**
 * Deterministically partition the compactable surface into index chunks and a trailing slice.
 * @param session - session owning the surface.
 * @param measurement - token measurement of current surface.
 * @param chunkTokens - target tokens per index chunk.
 * @param retainTokens - token budget for retained tail.
 * @returns execution plan, or null if no compactable span exists.
 */
export function selectPartitionPlan(
  session: Session,
  measurement: TokenMeasurement,
  chunkTokens: number,
  retainTokens: number,
): PartitionPlan | null {
  const nodes = session.surface.nodes
  if (nodes.length === 0) return null

  // 1. Determine startIdx (after last committed index checkpoint)
  const lastIndexIdx = findLastCommittedIndexCheckpoint(session)
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const headEvent = session.eventAt(nodes[0]!)
  let startIdx: number
  if (lastIndexIdx >= 0) {
    startIdx = lastIndexIdx + 1
  } else if (headEvent?.type === 'system/message') {
    startIdx = 1
  } else {
    startIdx = 0
  }

  if (startIdx >= nodes.length) return null

  // 2. Determine endIdx (before retained tail)
  let accumulatedTailTokens = 0
  let candidateEndIdx = -1
  for (let i = nodes.length - 1; i >= startIdx; i--) {
    const nodePrice = measurement.nodes[i]?.tokens ?? 0
    if ((accumulatedTailTokens + nodePrice > retainTokens || retainTokens === 0) && i < nodes.length - 1) {
      candidateEndIdx = i
      break
    }
    accumulatedTailTokens += nodePrice
  }
  if (candidateEndIdx < startIdx) return null

  // Snap retain boundary
  let balancedEndIdx = candidateEndIdx
  while (balancedEndIdx >= startIdx) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    if (toolPairingBalancedAfter(session, nodes[balancedEndIdx]!)) break
    balancedEndIdx -= 1
  }
  if (balancedEndIdx < startIdx) return null

  const endIdx = balancedEndIdx
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const compactableStartSeq = nodes[startIdx]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const compactableEndSeq = nodes[endIdx]!

  // 3. Partition nodes[startIdx .. endIdx] into chunks + trailing slice
  let totalSpanTokens = 0
  for (let i = startIdx; i <= endIdx; i++) {
    totalSpanTokens += measurement.nodes[i]?.tokens ?? 0
  }

  // If the span is small enough, the whole span is the trailing slice (no stubs)
  if (totalSpanTokens <= chunkTokens || endIdx - startIdx < 2) {
    const shadowedSeqs = nodes.slice(startIdx, endIdx + 1)
    return {
      chunks: [],
      trailingSlice: {
        startSeq: compactableStartSeq,
        endSeq: compactableEndSeq,
        startIdx,
        endIdx,
        shadowedSeqs,
        estimatedTokens: totalSpanTokens,
        isRecalledOnly: isRecalledOnlySpan(session, shadowedSeqs),
      },
      compactableStartSeq,
      compactableEndSeq,
    }
  }

  // Otherwise, partition into chunks
  const chunks: ChunkSlice[] = []
  let currentChunkStartIdx = startIdx
  let currentChunkTokens = 0

  for (let i = startIdx; i < endIdx; i++) {
    const nodeTokens = measurement.nodes[i]?.tokens ?? 0
    currentChunkTokens += nodeTokens

    if (currentChunkTokens >= chunkTokens && i < endIdx - 1) {
      let chunkEndIdx = i
      while (chunkEndIdx >= currentChunkStartIdx) {
        // oxlint-disable-next-line typescript/no-non-null-assertion
        if (toolPairingBalancedAfter(session, nodes[chunkEndIdx]!)) break
        chunkEndIdx -= 1
      }
      if (chunkEndIdx >= currentChunkStartIdx && chunkEndIdx < endIdx) {
        const chunkShadowed = nodes.slice(currentChunkStartIdx, chunkEndIdx + 1)
        let chunkEst = 0
        for (let j = currentChunkStartIdx; j <= chunkEndIdx; j++) {
          chunkEst += measurement.nodes[j]?.tokens ?? 0
        }
        chunks.push({
          // oxlint-disable-next-line typescript/no-non-null-assertion
          startSeq: nodes[currentChunkStartIdx]!,
          // oxlint-disable-next-line typescript/no-non-null-assertion
          endSeq: nodes[chunkEndIdx]!,
          startIdx: currentChunkStartIdx,
          endIdx: chunkEndIdx,
          shadowedSeqs: chunkShadowed,
          estimatedTokens: chunkEst,
          isRecalledOnly: isRecalledOnlySpan(session, chunkShadowed),
        })
        currentChunkStartIdx = chunkEndIdx + 1
        currentChunkTokens = 0
        i = chunkEndIdx
      }
    }
  }

  // Trailing slice covers whatever remains from currentChunkStartIdx to endIdx
  const trailingShadowed = nodes.slice(currentChunkStartIdx, endIdx + 1)
  let trailingTokens = 0
  for (let j = currentChunkStartIdx; j <= endIdx; j++) {
    trailingTokens += measurement.nodes[j]?.tokens ?? 0
  }

  const trailingSlice: ChunkSlice = {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    startSeq: nodes[currentChunkStartIdx]!,
    // oxlint-disable-next-line typescript/no-non-null-assertion
    endSeq: nodes[endIdx]!,
    startIdx: currentChunkStartIdx,
    endIdx,
    shadowedSeqs: trailingShadowed,
    estimatedTokens: trailingTokens,
    isRecalledOnly: isRecalledOnlySpan(session, trailingShadowed),
  }

  return {
    chunks,
    trailingSlice,
    compactableStartSeq,
    compactableEndSeq,
  }
}
