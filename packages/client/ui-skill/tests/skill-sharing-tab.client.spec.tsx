// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { SkillSharingTab } from '../src/client/SkillSharingTab.tsx'
import { zh, en } from '../src/client/locales.ts'

afterEach(cleanup)

describe('SkillSharingTab', () => {
  it('renders cloud unavailable warning, disabled agent switch, and offline guide in zh', () => {
    const t = makeTranslate(zh, commonZh)
    render(<SkillSharingTab t={t} />)

    // Heading & alert
    expect(screen.getByRole('heading', { level: 2, name: zh['sharing.title'] })).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(zh['sharing.cloudUnavailableTitle'])).toBeTruthy()
    expect(screen.getByText(zh['sharing.cloudUnavailableDescription'])).toBeTruthy()

    // Agent publish switch - disabled
    const switchEl = screen.getByRole('switch', { name: zh['sharing.agentPublishTitle'] })
    expect(switchEl).toBeTruthy()
    expect(switchEl.hasAttribute('disabled')).toBe(true)
    expect(switchEl.getAttribute('aria-checked')).toBe('false')

    // Offline archive section
    expect(screen.getByRole('heading', { level: 3, name: zh['sharing.offlineTitle'] })).toBeTruthy()
    expect(screen.getByText(zh['sharing.step1Title'])).toBeTruthy()
    expect(screen.getByText(zh['sharing.step2Title'])).toBeTruthy()
    expect(screen.getByText(zh['sharing.step3Title'])).toBeTruthy()
  })

  it('renders in English locale properly', () => {
    const t = makeTranslate(en, commonEn)
    render(<SkillSharingTab t={t} />)

    expect(screen.getByRole('heading', { level: 2, name: en['sharing.title'] })).toBeTruthy()
    expect(screen.getByText(en['sharing.cloudUnavailableTitle'])).toBeTruthy()

    const switchEl = screen.getByRole('switch', { name: en['sharing.agentPublishTitle'] })
    expect(switchEl.hasAttribute('disabled')).toBe(true)
    expect(switchEl.getAttribute('aria-checked')).toBe('false')

    expect(screen.getByRole('heading', { level: 3, name: en['sharing.offlineTitle'] })).toBeTruthy()
    expect(screen.getByText(en['sharing.step1Title'])).toBeTruthy()
  })
})
