// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BrowserElementCaptureSection } from '../src/client/BrowserElementCaptureSection.tsx'
import type { BrowserElementCaptureSectionProps } from '../src/client/BrowserElementCaptureSection.tsx'
import { en, zh, type BrowserElementCaptureKey } from '../src/client/locales.ts'

const css = readFileSync(resolve('packages/client/ui-browser-element-capture/src/client/BrowserElementCaptureSection.module.css'), 'utf8')
afterEach(cleanup)

function props(dictionary: Record<BrowserElementCaptureKey, string>): BrowserElementCaptureSectionProps {
  return { close: () => {}, t: (key: BrowserElementCaptureKey) => dictionary[key] } as BrowserElementCaptureSectionProps
}

describe('BrowserElementCaptureSection', () => {
  it('renders the Chinese workflow and permission separation', () => {
    render(<BrowserElementCaptureSection {...props(zh)} />)
    expect(screen.getByRole('heading', { name: zh.title })).not.toBeNull()
    expect(screen.getByText(zh.stepOne)).not.toBeNull()
    expect(screen.getByText(zh.stepTwo)).not.toBeNull()
    expect(screen.getByText(zh.stepThree)).not.toBeNull()
    expect(screen.getByText(zh.safetyBody)).not.toBeNull()
    expect(screen.getByText(zh.providerFact)).not.toBeNull()
  })

  it('renders the English dictionary through the same semantic structure', () => {
    render(<BrowserElementCaptureSection {...props(en)} />)
    expect(screen.getByRole('heading', { name: en.title })).not.toBeNull()
    expect(screen.getByRole('heading', { name: en.safetyTitle, level: 3 })).not.toBeNull()
  })

  it('uses semantic theme tokens without literal colors', () => {
    expect(css).toContain('var(--dsw-alias-label-primary)')
    expect(css).toContain('var(--dsw-alias-border-l2)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(css).not.toMatch(/rgba?\(/i)
  })
})
