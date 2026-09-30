import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  CompactionId,
  compactCheckpointSource,
  formatCheckpointFooter,
} from '@deepseek-ai/dsh-compaction'
import {
  createUserMessage,
  createToolResultMessage,
  createSystemMessage,
  createMessage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as toolRecall from '../src/index.ts'

const testSignal = new AbortController().signal

function agentWithSession(session: Session): Agent & { session: Session } {
  return { id: session.id, session } as unknown as Agent & { session: Session }
}

async function setupContext(config: toolRecall.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(toolRecall, config)
  return ctx
}

let callSeq = 0
function execTool(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal: testSignal,
    callId: ToolCallId(`call-${++callSeq}`),
    name,
    arguments: args,
    ...agent ? { agent } : {},
  })
}

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

describe('dsh-tool-recall', () => {
  it('registers history_read and history_search tools and system prompt section', async () => {
    const ctx = await setupContext()
    const schemas = ctx.tools.schemas()
    expect(schemas.find(s => s.name === 'history_read')).toBeDefined()
    expect(schemas.find(s => s.name === 'history_search')).toBeDefined()

    const assembly = await ctx.systemPrompt.assemble()
    const recallSection = assembly.sections.find(s => s.name === 'tool:recall')
    expect(recallSection).toBeDefined()
    expect(recallSection?.text).toContain('history_read')
    expect(recallSection?.text).toContain('history_search')
  })

  it('rejects non-agent callers with NON_AGENT_CALLER', async () => {
    const ctx = await setupContext()
    const r1 = await execTool(ctx, 'history_read', { checkpoint: 'c1' })
    expect(r1.isError).toBe(true)
    expect(r1.error?.info?.code).toBe('NON_AGENT_CALLER')

    const r2 = await execTool(ctx, 'history_search', { query: 'test' })
    expect(r2.isError).toBe(true)
    expect(r2.error?.info?.code).toBe('NON_AGENT_CALLER')
  })

  it('validates arguments for history_read and history_search', async () => {
    const ctx = await setupContext()
    const session = Session.create(SessionId('s1'))
    const agent = agentWithSession(session)

    const r1 = await execTool(ctx, 'history_read', { checkpoint: 'invalid-id' }, agent)
    expect(r1.isError).toBe(true)
    expect(r1.error?.info?.code).toBe('INVALID_ARGUMENT')

    const r2 = await execTool(ctx, 'history_read', { checkpoint: 'c10', offset: -1 }, agent)
    expect(r2.isError).toBe(true)
    expect(r2.error?.info?.code).toBe('INVALID_OFFSET')

    const r3 = await execTool(ctx, 'history_search', { query: '   ' }, agent)
    expect(r3.isError).toBe(true)
    expect(r3.error?.info?.code).toBe('INVALID_ARGUMENT')
  })

  it('rejects non-existent checkpoints and orphaned compaction starts', async () => {
    const ctx = await setupContext()
    const session = Session.create(SessionId('s2'))
    const agent = agentWithSession(session)

    // Checkpoint does not exist
    const r1 = await execTool(ctx, 'history_read', { checkpoint: 'c99' }, agent)
    expect(r1.isError).toBe(true)
    expect(r1.error?.info?.code).toBe('CHECKPOINT_NOT_FOUND')

    // Orphaned start
    const orphanStart = session.append('compaction/start', {
      compactionId: CompactionId('orphan-compaction'),
      turn: 1,
    })
    const r2 = await execTool(ctx, 'history_read', { checkpoint: `c${orphanStart.seq}` }, agent)
    expect(r2.isError).toBe(true)
    expect(r2.error?.info?.code).toBe('ORPHANED_COMPACTION')
  })

  it('reads shadowed span of a checkpoint with correct transcript labels and pagination', async () => {
    const ctx = await setupContext({ readBudgetChars: 120 })
    const session = Session.create(SessionId('s3'))
    const agent = agentWithSession(session)

    // Create conversation history
    const userMsg = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Please inspect the repository layout.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const asstMsg = session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'I will list the directory contents.' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
    }, { surfaceOp: 'append' })

    const toolMsg = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('call-1'),
        content: [{ type: 'text', text: 'packages/core, packages/llm' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    // Perform compaction
    const compId = CompactionId('comp-1')
    session.append('compaction/start', { compactionId: compId, turn: 1 })
    const summary = session.append('compaction/summary', {
      compactionId: compId,
      summary: [{ type: 'text', text: 'Repository contains core and llm packages.' }],
      shadowedRange: { start: userMsg.seq, end: toolMsg.seq },
      shadowedSeqs: [userMsg.seq, asstMsg.seq, toolMsg.seq],
      shadowedTokenCount: 50,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Checkpoint 1 summary\n' + formatCheckpointFooter(summary.seq, userMsg.seq, toolMsg.seq) }],
      source: compactCheckpointSource(compId),
    }), {
      surfaceOp: { op: 'replace', startSeq: userMsg.seq, endSeq: toolMsg.seq },
      sourceEventSeqs: [userMsg.seq, asstMsg.seq, toolMsg.seq],
    })
    session.append('compaction/end', { compactionId: compId, turn: 1 })

    // Read first page (budget 120 chars should paginate)
    const page1 = await execTool(ctx, 'history_read', { checkpoint: `c${summary.seq}` }, agent)
    expect(page1.isError).toBe(false)
    const t1 = resultText(page1)
    expect(t1).toContain('User: Please inspect the repository layout.')
    expect(t1).toContain('[Continuation cursor: offset=')

    // Read continuation page (offset = 1)
    const page2 = await execTool(ctx, 'history_read', { checkpoint: `c${summary.seq}`, offset: 1 }, agent)
    expect(page2.isError).toBe(false)
    const t2 = resultText(page2)
    expect(t2).toContain('Assistant: I will list the directory contents.')

    // Read page with offset = 2
    const page3 = await execTool(ctx, 'history_read', { checkpoint: `c${summary.seq}`, offset: 2 }, agent)
    expect(page3.isError).toBe(false)
    const t3 = resultText(page3)
    expect(t3).toContain('Tool result: packages/core, packages/llm')

    // Read beyond end
    const pageEnd = await execTool(ctx, 'history_read', { checkpoint: `c${summary.seq}`, offset: 10 }, agent)
    expect(pageEnd.isError).toBe(false)
    expect(resultText(pageEnd)).toBe('(no further messages in this checkpoint span)')
  })

  it('searches across checkpoints and satisfies the superseded state regression pin', async () => {
    const ctx = await setupContext()
    const session = Session.create(SessionId('s4'))
    const agent = agentWithSession(session)

    // Pass 1: Original turns
    const u1 = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Important secret PIN: 987654' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const a1 = session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Saved the secret PIN.' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
    }, { surfaceOp: 'append' })

    const c1Id = CompactionId('c1')
    session.append('compaction/start', { compactionId: c1Id, turn: 1 })
    const sum1 = session.append('compaction/summary', {
      compactionId: c1Id,
      summary: [{ type: 'text', text: 'User provided secret credentials.' }],
      shadowedRange: { start: u1.seq, end: a1.seq },
      shadowedSeqs: [u1.seq, a1.seq],
      shadowedTokenCount: 30,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    const state1 = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'State 1: secret stored\n' + formatCheckpointFooter(sum1.seq, u1.seq, a1.seq) }],
      source: compactCheckpointSource(c1Id),
    }), {
      surfaceOp: { op: 'replace', startSeq: u1.seq, endSeq: a1.seq },
      sourceEventSeqs: [u1.seq, a1.seq],
    })
    session.append('compaction/end', { compactionId: c1Id, turn: 1 })

    // Turn 2: New turn added
    const u2 = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Now configure the database URL postgres://localhost:5432' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    // Pass 2: Supersedes state 1 and compacts Turn 2
    const c2Id = CompactionId('c2')
    session.append('compaction/start', { compactionId: c2Id, turn: 2 })
    const sum2 = session.append('compaction/summary', {
      compactionId: c2Id,
      summary: [{ type: 'text', text: 'All credentials and db configured.' }],
      shadowedRange: { start: state1.seq, end: u2.seq },
      shadowedSeqs: [state1.seq, u2.seq],
      shadowedTokenCount: 50,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'State 2: complete\n' + formatCheckpointFooter(sum2.seq, state1.seq, u2.seq) }],
      source: compactCheckpointSource(c2Id),
    }), {
      surfaceOp: { op: 'replace', startSeq: state1.seq, endSeq: u2.seq },
      sourceEventSeqs: [state1.seq, u2.seq],
    })
    session.append('compaction/end', { compactionId: c2Id, turn: 2 })

    // Regression pin: Finding content that exists ONLY in a span shadowed by a superseded state checkpoint
    const searchPin = await execTool(ctx, 'history_search', { query: 'PIN: 987654' }, agent)
    expect(searchPin.isError).toBe(false)
    const pinText = resultText(searchPin)
    expect(pinText).toContain(`[c${sum1.seq}]`)
    expect(pinText).toContain('PIN: 987654')

    // Reading c2 should render the prior state checkpoint labeled [prior state checkpoint]
    const readC2 = await execTool(ctx, 'history_read', { checkpoint: `c${sum2.seq}` }, agent)
    expect(readC2.isError).toBe(false)
    const c2Text = resultText(readC2)
    expect(c2Text).toContain('[prior state checkpoint]')
    expect(c2Text).toContain(`[checkpoint c${sum1.seq}:`)

    // Search with zero matches returns helpful hint
    const searchMiss = await execTool(ctx, 'history_search', { query: 'nonexistent-string' }, agent)
    expect(searchMiss.isError).toBe(false)
    const missText = resultText(searchMiss)
    expect(missText).toContain('Found 0 match(es)')
    expect(missText).toContain('Hint: Zero matches found.')
    expect(missText).toContain('history_read')
  })

  it('covers presentCall, truncated search results, and specific checkpoint search', async () => {
    const ctx = await setupContext()
    const session = Session.create(SessionId('s5'))
    const agent = agentWithSession(session)

    const u1 = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first prompt line one\nfirst prompt line two' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const compId = CompactionId('c5')
    session.append('compaction/start', { compactionId: compId, turn: 1 })
    const sum = session.append('compaction/summary', {
      compactionId: compId,
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: u1.seq, end: u1.seq },
      shadowedSeqs: [u1.seq],
      shadowedTokenCount: 10,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary text' }],
      source: compactCheckpointSource(compId),
    }), { surfaceOp: { op: 'replace', startSeq: u1.seq, endSeq: u1.seq }, sourceEventSeqs: [u1.seq] })
    session.append('compaction/end', { compactionId: compId, turn: 1 })

    // Test presentCall on tool definitions
    const historyReadTool = (ctx.tools as unknown as { get(name: string): { presentCall?: (args: unknown) => unknown } }).get('history_read')
    expect(historyReadTool?.presentCall?.({ checkpoint: 'c1' })).toMatchObject({
      card: 'generic',
      title: 'Read history checkpoint c1',
    })

    const historySearchTool = (ctx.tools as unknown as { get(name: string): { presentCall?: (args: unknown) => unknown } }).get('history_search')
    expect(historySearchTool?.presentCall?.({ query: 'hello' })).toMatchObject({
      card: 'generic',
      title: 'Search history for "hello"',
    })

    // Search with specific checkpoint
    const resSpecific = await execTool(ctx, 'history_search', { query: 'first', checkpoint: `c${sum.seq}` }, agent)
    expect(resSpecific.isError).toBe(false)
    expect(resultText(resSpecific)).toContain('Found 2 match(es)')

    // Search with limit: 1 causing truncation when multiple matches exist
    const resTruncated = await execTool(ctx, 'history_search', { query: 'first', limit: 1 }, agent)
    expect(resTruncated.isError).toBe(false)
    expect(resultText(resTruncated)).toContain('(results truncated)')
  })

  it('renders system messages, tool calls, tool errors, and media blocks', async () => {
    const ctx = await setupContext()
    const session = Session.create(SessionId('s6'))
    const agent = agentWithSession(session)

    const sys = session.append('system/message', {
      turn: 1,
      step: 1,
      message: createSystemMessage('System instruction prompt'),
    }, { surfaceOp: 'append' })

    const asst = session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Calling tool now' },
          { type: 'tool-call', id: ToolCallId('tc-1'), name: 'test_tool', arguments: '{"arg":1}' },
        ],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      }),
    }, { surfaceOp: 'append' })

    const toolErr = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('tc-1'),
        content: [{ type: 'text', text: 'Command failed' }],
        isError: true,
      }),
    }, { surfaceOp: 'append' })

    const toolMedia = session.append('tool/result', {
      turn: 1,
      step: 2,
      message: createToolResultMessage({
        callId: ToolCallId('tc-2'),
        content: [{ type: 'text', text: 'caption' }, { type: 'image', attachment: { attachmentId: 'att-1' as never, mediaType: 'image/png', bytes: 10, width: 10, height: 10 } }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    const compId = CompactionId('c6')
    session.append('compaction/start', { compactionId: compId, turn: 1 })
    const sum = session.append('compaction/summary', {
      compactionId: compId,
      summary: [{ type: 'text', text: 'rich messages summary' }],
      shadowedRange: { start: asst.seq, end: toolMedia.seq },
      shadowedSeqs: [asst.seq, toolErr.seq, toolMedia.seq],
      shadowedTokenCount: 60,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'checkpoint replacement' }],
      source: compactCheckpointSource(compId),
    }), {
      surfaceOp: { op: 'replace', startSeq: asst.seq, endSeq: toolMedia.seq },
      sourceEventSeqs: [asst.seq, toolErr.seq, toolMedia.seq],
    })
    session.append('compaction/end', { compactionId: compId, turn: 1 })

    // Direct renderMessage assertion on system prompt message
    expect(toolRecall.renderMessage(sys.data.message)).toBe('System: System instruction prompt')

    const read = await execTool(ctx, 'history_read', { checkpoint: `c${sum.seq}` }, agent)
    expect(read.isError).toBe(false)
    const text = resultText(read)
    expect(text).toContain('[Tool call: test_tool({"arg":1})]')
    expect(text).toContain('[Tool error: Command failed]')
    expect(text).toContain('[image]')
  })

  it('rejects failed or orphaned checkpoints when resolving', async () => {
    const ctx = await setupContext()
    const session = Session.create(SessionId('s7'))
    const agent = agentWithSession(session)

    // Summary with missing end
    const c1Id = CompactionId('no-end')
    session.append('compaction/start', { compactionId: c1Id, turn: 1 })
    const sum1 = session.append('compaction/summary', {
      compactionId: c1Id,
      summary: [{ type: 'text', text: 'sum1' }],
      shadowedRange: { start: SessionSeq(0), end: SessionSeq(0) },
      shadowedSeqs: [SessionSeq(0)],
      shadowedTokenCount: 10,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })

    const r1 = await execTool(ctx, 'history_read', { checkpoint: `c${sum1.seq}` }, agent)
    expect(r1.isError).toBe(true)
    expect(r1.error?.info?.code).toBe('ORPHANED_COMPACTION')

    // Summary with error end
    const c2Id = CompactionId('err-end')
    session.append('compaction/start', { compactionId: c2Id, turn: 2 })
    const sum2 = session.append('compaction/summary', {
      compactionId: c2Id,
      summary: [{ type: 'text', text: 'sum2' }],
      shadowedRange: { start: SessionSeq(0), end: SessionSeq(0) },
      shadowedSeqs: [SessionSeq(0)],
      shadowedTokenCount: 10,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('compaction/end', { compactionId: c2Id, turn: 2, error: 'compaction failed' })

    const r2 = await execTool(ctx, 'history_read', { checkpoint: `c${sum2.seq}` }, agent)
    expect(r2.isError).toBe(true)
    expect(r2.error?.info?.code).toBe('ORPHANED_COMPACTION')
  })

  it('covers explicit config values, thought blocks, findCompletedCheckpoints exclusions, and non-message event skipping', async () => {
    // Explicit config covering both values
    const ctx = await setupContext({ readBudgetChars: 5000, searchLimit: 10 })
    const session = Session.create(SessionId('s8'))
    const agent = agentWithSession(session)

    // Render block with thought/reasoning (which produces no text in transcript)
    const thoughtBlock = { type: 'reasoning' as const, text: 'internal reasoning' }
    expect(toolRecall.renderBlocks([thoughtBlock])).toBe('')

    // A session with:
    // 1 completed compaction
    // 1 errored compaction (should be excluded by findCompletedCheckpoints)
    // 1 in-progress compaction (no end, should be excluded by findCompletedCheckpoints)
    const u1 = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'normal prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const compId1 = CompactionId('ok-comp')
    session.append('compaction/start', { compactionId: compId1, turn: 1 })
    const sum1 = session.append('compaction/summary', {
      compactionId: compId1,
      summary: [{ type: 'text', text: 'sum1' }],
      shadowedRange: { start: u1.seq, end: u1.seq },
      shadowedSeqs: [u1.seq, SessionSeq(9999), SessionSeq(1)],
      shadowedTokenCount: 10,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'sum1 text' }],
      source: compactCheckpointSource(compId1),
    }), { surfaceOp: { op: 'replace', startSeq: u1.seq, endSeq: u1.seq }, sourceEventSeqs: [u1.seq] })
    session.append('compaction/end', { compactionId: compId1, turn: 1 })

    // Errored compaction
    const compId2 = CompactionId('bad-comp')
    session.append('compaction/start', { compactionId: compId2, turn: 2 })
    session.append('compaction/summary', {
      compactionId: compId2,
      summary: [{ type: 'text', text: 'sum2' }],
      shadowedRange: { start: SessionSeq(0), end: SessionSeq(0) },
      shadowedSeqs: [SessionSeq(0)],
      shadowedTokenCount: 10,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    session.append('compaction/end', { compactionId: compId2, turn: 2, error: 'fail' })

    // No-end compaction
    const compId3 = CompactionId('unclosed-comp')
    session.append('compaction/start', { compactionId: compId3, turn: 3 })
    session.append('compaction/summary', {
      compactionId: compId3,
      summary: [{ type: 'text', text: 'sum3' }],
      shadowedRange: { start: SessionSeq(0), end: SessionSeq(0) },
      shadowedSeqs: [SessionSeq(0)],
      shadowedTokenCount: 10,
      provider: 'deepseek',
      model: 'deepseek-chat',
    })

    // findCompletedCheckpoints should only return sum1
    const completed = toolRecall.findCompletedCheckpoints(session)
    expect(completed).toHaveLength(1)
    expect(completed[0]?.id).toBe(`c${sum1.seq}`)

    // history_read should skip the non-existent and non-message events gracefully
    const read = await execTool(ctx, 'history_read', { checkpoint: `c${sum1.seq}` }, agent)
    expect(read.isError).toBe(false)
    expect(resultText(read)).toContain('User: normal prompt')
  })

  it('falls back to default constants when apply is called with empty config', async () => {
    const rawCtx = new Context()
    await rawCtx.plugin(SystemPrompt, {})
    await rawCtx.plugin(ToolRuntime)
    toolRecall.apply(rawCtx, {})
    const schemas = rawCtx.tools.schemas()
    expect(schemas.find(s => s.name === 'history_read')).toBeDefined()
  })
})
