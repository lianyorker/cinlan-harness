// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { MobileAgentCard } from '../src/client/MobileAgentCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = makeTranslate(en, commonEn)

describe('mobile commands and prompts', () => {
  it('keeps commands and example prompts without activation controls', () => {
    render(<MobileAgentCard t={t} />)
    expect(screen.getByRole('heading', { name: en.mobileCommandsTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.examplesTitle })).toBeTruthy()
    expect(screen.getByText(en.mobileLaunchCommand)).toBeTruthy()
    expect(screen.getByText('mobile_observe')).toBeTruthy()
    expect(screen.queryByText(en.mobileAgentControl)).toBeNull()
    expect(screen.queryByText('2/2')).toBeNull()
    expect(screen.queryByRole('button', { name: en.mobileAgentDisable })).toBeNull()
    expect(screen.queryByRole('button', { name: en.mobileAgentRecheck })).toBeNull()
  })

  it('copies all three prompts and reports clipboard denial', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<MobileAgentCard t={t} />)
    const copies = screen.getAllByRole('button', { name: en.copyExample })
    expect(copies).toHaveLength(3)
    fireEvent.click(copies[0]!)
    expect(writeText).toHaveBeenCalledWith(en.mobileExample)
    expect(await screen.findByText(en.mobileCopied)).toBeTruthy()
    fireEvent.click(copies[1]!)
    expect(await screen.findByText(en.copyFailed)).toBeTruthy()
  })

  it('ignores a clipboard answer after leaving the page', async () => {
    const answer = Promise.withResolvers<undefined>()
    vi.stubGlobal('navigator', { clipboard: { writeText: () => answer.promise } })
    const view = render(<MobileAgentCard t={t} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.copyExample })[0]!)
    view.unmount()
    await act(async () => { answer.resolve(undefined); await answer.promise })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
