// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractElementData,
  formatInspectedElementMarkdown,
  getElementSelector,
  type InspectedElementData,
} from '../src/client/view/element-inspector-utils.ts'
import { ElementInspectorOverlay } from '../src/client/view/element-inspector.tsx'
import { BrowserBody, type BrowserBodyProps } from '../src/client/view/BrowserBody.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t = (key: keyof typeof en, params?: Record<string, string | number>): string => {
  let val = en[key] ?? String(key)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(`{${k}}`, String(v))
    }
  }
  return val
}

describe('element-inspector-utils', () => {
  it('computes selector using element ID when present', () => {
    const el = document.createElement('button')
    el.id = 'submit-btn'
    expect(getElementSelector(el)).toBe('#submit-btn')
  })

  it('computes selector using tag name and classes', () => {
    const el = document.createElement('div')
    el.className = 'container main-box'
    expect(getElementSelector(el)).toBe('div.container.main-box')
  })

  it('computes selector for nested elements with nth-of-type', () => {
    const parent = document.createElement('ul')
    const child1 = document.createElement('li')
    const child2 = document.createElement('li')
    parent.appendChild(child1)
    parent.appendChild(child2)

    expect(getElementSelector(child2)).toBe('ul > li:nth-of-type(2)')
  })

  it('extracts element data including role, text, and dimensions', () => {
    const el = document.createElement('button')
    el.id = 'login-button'
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', 'Log In')
    el.textContent = ' Sign In to Account '

    const data = extractElementData(el, 'https://example.com/login')
    expect(data.tagName).toBe('BUTTON')
    expect(data.selector).toBe('#login-button')
    expect(data.role).toBe('button')
    expect(data.ariaLabel).toBe('Log In')
    expect(data.text).toBe('Sign In to Account')
    expect(data.pageUrl).toBe('https://example.com/login')
  })

  it('formats inspected element markdown accurately', () => {
    const data: InspectedElementData = {
      tagName: 'BUTTON',
      selector: 'button.primary-action',
      text: 'Submit Order',
      role: 'button',
      ariaLabel: 'Submit your order',
      rect: { x: 120, y: 340, width: 160, height: 44 },
      pageUrl: 'https://shop.example.com/checkout',
    }

    const md = formatInspectedElementMarkdown(data)
    expect(md).toContain('[UI Element Inspection]')
    expect(md).toContain('- Page URL: https://shop.example.com/checkout')
    expect(md).toContain('- Element: <button>')
    expect(md).toContain('- Selector: `button.primary-action`')
    expect(md).toContain('- Role: button')
    expect(md).toContain('- Label: "Submit your order"')
    expect(md).toContain('- Text: "Submit Order"')
    expect(md).toContain('- Dimensions: 160x44 at (120, 340)')
  })
})

describe('ElementInspectorOverlay', () => {
  it('renders inspector overlay and cancels on Escape key', () => {
    const onCancel = vi.fn()
    const onInspect = vi.fn()

    render(
      <ElementInspectorOverlay
        viewportId="viewport-1"
        pageUrl="https://example.com"
        onInspectElement={onInspect}
        onCancel={onCancel}
      />
    )

    const overlay = screen.getByTestId('browser-inspector-overlay')
    expect(overlay).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('handles click to inspect element data and invokes callback', () => {
    const onInspect = vi.fn()
    const onCancel = vi.fn()

    const mockTarget = document.createElement('a')
    mockTarget.id = 'home-link'
    mockTarget.textContent = 'Home'
    document.body.appendChild(mockTarget)

    document.elementFromPoint = vi.fn(() => mockTarget)

    render(
      <ElementInspectorOverlay
        viewportId="viewport-1"
        pageUrl="https://example.com"
        onInspectElement={onInspect}
        onCancel={onCancel}
      />
    )

    const overlay = screen.getByTestId('browser-inspector-overlay')
    fireEvent.click(overlay, { clientX: 100, clientY: 150 })

    expect(onInspect).toHaveBeenCalled()
    const inspected = onInspect.mock.calls[0]![0] as InspectedElementData
    expect(inspected.selector).toBe('#home-link')
    expect(inspected.pageUrl).toBe('https://example.com')

    mockTarget.remove()
  })
})

describe('BrowserBody Design Mode', () => {
  const stableTab = {
    id: 'tab-1',
    actions: {
      bindCommands: vi.fn(),
      openTab: vi.fn(),
    },
    navigation: {
      params: { url: 'https://example.com/app' },
    },
    signal: new AbortController().signal,
  }
  const stableTabInfo = { tab: stableTab }
  const stableActions = { bindCommands: vi.fn() }

  function makeBrowserBodyProps(overrides: Partial<BrowserBodyProps> = {}): BrowserBodyProps {
    return {
      sessionId: 'test-session',
      tabId: 'tab-1' as any,
      actions: stableActions as any,
      t: t as any,
      mount: vi.fn(() => () => {}),
      loadUrl: vi.fn(),
      restore: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      setSandbox: vi.fn(),
      useBrowserState: vi.fn(() => ({
        frame: {
          address: 'known' as const,
          canGoBack: false,
          canGoForward: false,
          loading: false,
          sandboxEnabled: true,
          target: { url: 'https://example.com/app', title: 'Test App' },
        },
        addressRevision: 1,
        addressFailure: undefined,
        restoreTarget: undefined,
      })),
      useStore: vi.fn(() => ({})),
      useTabInfo: () => stableTabInfo,
      ...overrides,
    } as unknown as BrowserBodyProps
  }

  it('renders design mode toggle button in toolbar and toggles inspector overlay', () => {
    const onInjectDraft = vi.fn()
    const props = makeBrowserBodyProps({ onInjectDraft })

    render(<BrowserBody {...props} />)

    const toggleBtn = screen.getByTitle(en['designMode.toggle'])
    expect(toggleBtn).toBeDefined()

    // Toggle on
    fireEvent.click(toggleBtn)
    expect(screen.getByText(new RegExp(en['designMode.banner']))).toBeDefined()
    expect(screen.getByTestId('browser-inspector-overlay')).toBeDefined()

    // Toggle off via exit button in banner
    const exitBtn = screen.getByText(en['designMode.exit'])
    fireEvent.click(exitBtn)
    expect(screen.queryByTestId('browser-inspector-overlay')).toBeNull()
  })

  it('injects markdown formatted element info into session draft on click', () => {
    const onInjectDraft = vi.fn()
    const props = makeBrowserBodyProps({ onInjectDraft })

    render(<BrowserBody {...props} />)

    const toggleBtn = screen.getByTitle(en['designMode.toggle'])
    fireEvent.click(toggleBtn)

    const overlay = screen.getByTestId('browser-inspector-overlay')
    fireEvent.click(overlay, { clientX: 200, clientY: 100 })

    expect(onInjectDraft).toHaveBeenCalled()
    const injectedText = onInjectDraft.mock.calls[0]![0]
    expect(injectedText).toContain('[UI Element Inspection]')
    expect(injectedText).toContain('- Page URL: https://example.com/app')
  })
})
