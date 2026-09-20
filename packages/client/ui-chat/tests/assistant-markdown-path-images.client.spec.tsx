// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantMarkdown, localPathMediaUrl } from '../src/client/chat/AssistantMarkdown.tsx'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import type {
  ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps,
} from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'

afterEach(cleanup)

const t = ((_key: string) => 'label') as unknown as ChatViewSlotProps['t']
const renderMessageImages = (() => null) as unknown as ChatNodeOwnerProps['renderMessageImages']

function textBlock(text: string): AssistantBlock {
  return { kind: 'text', text }
}

const SESSION = 'media-owner'
const ORIGIN = 'http://127.0.0.1:3080'

describe('localPathMediaUrl', () => {
  it('maps an owned absolute POSIX path on an HTTP page to the file API', () => {
    expect(localPathMediaUrl('http:', ORIGIN, '/tmp/graph.png', SESSION))
      .toBe(`${ORIGIN}/api/file?sessionId=media-owner&path=${encodeURIComponent('/tmp/graph.png')}`)
    expect(localPathMediaUrl('https:', 'https://127.0.0.1:3080', '/tmp/graph.png', SESSION))
      .toBe(`https://127.0.0.1:3080/api/file?sessionId=media-owner&path=${encodeURIComponent('/tmp/graph.png')}`)
  })

  it('keeps an absent or empty owner inert', () => {
    expect(localPathMediaUrl('http:', ORIGIN, '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('http:', ORIGIN, '/tmp/graph.png', '')).toBeUndefined()
  })

  it('keeps non-HTTP transports inert', () => {
    expect(localPathMediaUrl('file:', 'file:///app', '/tmp/graph.png', SESSION)).toBeUndefined()
    expect(localPathMediaUrl('ws:', ORIGIN, '/tmp/graph.png', SESSION)).toBeUndefined()
  })

  it('keeps destinations that cannot be Host-served POSIX files inert', () => {
    expect(localPathMediaUrl('http:', ORIGIN, '', SESSION)).toBeUndefined()
    expect(localPathMediaUrl('http:', ORIGIN, '//cdn.example.com/x.png', SESSION)).toBeUndefined()
    expect(localPathMediaUrl('http:', ORIGIN, 'relative.png', SESSION)).toBeUndefined()
    expect(localPathMediaUrl('http:', ORIGIN, 'C:\\tmp\\x.png', SESSION)).toBeUndefined()
  })

  it('encodes the complete owner and path as independent query values', () => {
    const mapped = localPathMediaUrl('http:', ORIGIN, '/tmp/my graph&part=1.png', 'owner&path=other')
    expect(mapped).toBeDefined()
    const url = new URL(mapped ?? ORIGIN)
    expect(url.searchParams.get('sessionId')).toBe('owner&path=other')
    expect(url.searchParams.get('path')).toBe('/tmp/my graph&part=1.png')
  })
})

describe('AssistantMarkdown path images', () => {
  it('receives the session-scoped owner through AssistantNodeView', () => {
    const node: ChatNodeViewProps<'assistant-step'>['node'] = {
      key: 'assistant:path-image',
      kind: 'assistant-step',
      id: 'path-image',
      target: 'chat',
      anchorSeq: 1,
      location: { kind: 'session' },
      visibility: 'visible',
      data: {
        status: 'interrupted',
        turn: 1,
        step: 1,
        blocks: [textBlock('See ![diagram](/tmp/graph.png).')],
        time: 1,
      },
    }
    const props = {
      node,
      sessionId: SESSION,
      useTurnData: () => undefined,
      openFile: () => {},
      renderMessageImages,
      fileMentions: () => undefined,
      t,
    } as unknown as ChatNodeViewProps<'assistant-step'>

    const view = render(<AssistantNodeView {...props} />)
    const image = view.getByRole('img', { name: 'diagram' })
    const url = new URL(image.getAttribute('src') ?? '')
    expect(url.pathname).toBe('/api/file')
    expect(url.searchParams.get('sessionId')).toBe(SESSION)
    expect(url.searchParams.get('path')).toBe('/tmp/graph.png')
  })

  it('leaves an unowned local image and local link as inert text', () => {
    const view = render(
      <AssistantMarkdown
        blocks={[textBlock('![diagram](/tmp/graph.png) and [local link](/tmp/graph.png).')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(view.queryByRole('img')).toBeNull()
    expect(view.queryByRole('link')).toBeNull()
    expect(view.getByText('diagram')).toBeTruthy()
    expect(view.container.textContent).toContain('local link')
  })

  it('preserves a streaming remote image, accessible alt, and safe outer link', () => {
    const view = render(
      <AssistantMarkdown
        blocks={[textBlock('[![remote diagram](https://cdn.example.com/graph.png)](https://docs.example.com/graph)')]}
        streaming
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    const image = view.getByRole('img', { name: 'remote diagram' })
    expect(image.getAttribute('src')).toBe('https://cdn.example.com/graph.png')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    const link = image.closest('a')
    expect(link?.getAttribute('href')).toBe('https://docs.example.com/graph')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('keeps local paths inert while streaming and activates them when streaming ends', () => {
    const props = {
      sessionId: SESSION,
      blocks: [textBlock('![diagram](/tmp/graph.png)')],
      renderMessageImages,
      t,
    }
    const view = render(<AssistantMarkdown {...props} streaming />)
    expect(view.queryByRole('img')).toBeNull()
    expect(view.getByText('diagram')).toBeTruthy()

    view.rerender(<AssistantMarkdown {...props} streaming={false} />)
    expect(view.getByRole('img', { name: 'diagram' })).toBeTruthy()
  })

  it('remounts the image under a changed owner', () => {
    const blocks = [textBlock('![diagram](/tmp/graph.png)')]
    const view = render(
      <AssistantMarkdown
        sessionId="first-owner"
        blocks={blocks}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    const first = view.getByRole('img', { name: 'diagram' })
    expect(new URL(first.getAttribute('src') ?? '').searchParams.get('sessionId')).toBe('first-owner')

    view.rerender(
      <AssistantMarkdown
        sessionId="second-owner"
        blocks={blocks}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    const second = view.getByRole('img', { name: 'diagram' })
    expect(second).not.toBe(first)
    expect(new URL(second.getAttribute('src') ?? '').searchParams.get('sessionId')).toBe('second-owner')
  })

  it('falls back to the authored alt after a load failure', () => {
    const view = render(
      <AssistantMarkdown
        sessionId={SESSION}
        blocks={[textBlock('![diagram](/tmp/missing.png)')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    fireEvent.error(view.getByRole('img', { name: 'diagram' }))
    expect(view.queryByRole('img')).toBeNull()
    expect(view.getByText('diagram')).toBeTruthy()
  })
})
