// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SecurityReaDoctorSnapshot } from '@cinlan/api-security-research-controller/types'
import { REA_CAPABILITY } from '../src/client/CapabilitySection.tsx'
import { ReaSection, type ReaSectionProps } from '../src/client/ReaSection.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 0) }) }

function report(overrides: Partial<SecurityReaDoctorSnapshot> = {}): SecurityReaDoctorSnapshot {
  return {
    status: { state: 'ready', nodeVersion: 'v24.22.2', requiredEngines: '^24.22.1', reaVersion: '6.8.0', toolCount: 4 },
    stateDir: 'D:\\clh\\security\\rea',
    tools: [
      { name: 'rizin', detected: true, version: 'rizin 0.7.0' },
      { name: 'frida', detected: false, hint: 'pip install frida-tools' },
    ],
    ...overrides,
  }
}

function mount(snapshot: SecurityReaDoctorSnapshot | null = report(), language: 'en' | 'zh' = 'en') {
  const describeRea = vi.fn(async (_signal: AbortSignal) => {
    if (snapshot === null) throw new Error('host unreachable')
    return snapshot
  })
  const props = {
    definition: REA_CAPABILITY,
    renderFactorySlot: vi.fn(() => null),
    close: vi.fn(),
    describeRea,
    t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
  } as unknown as ReaSectionProps
  return { ...render(<ReaSection {...props} />), props, describeRea }
}

describe('reverse engineering settings page', () => {
  it('shows ready status, runtime facts, and detected host tools', async () => {
    mount()
    expect(await screen.findByText(en.reaStatusReady)).toBeTruthy()
    expect(screen.getByText(en.reaReadyDescription)).toBeTruthy()
    expect(screen.getByText('v24.22.2')).toBeTruthy()
    expect(screen.getByText('^24.22.1')).toBeTruthy()
    expect(screen.getByText('6.8.0')).toBeTruthy()
    expect(screen.getByText('rizin 0.7.0')).toBeTruthy()
    expect(screen.getByText('pip install frida-tools')).toBeTruthy()
    expect(screen.getByText(en.reaExample)).toBeTruthy()
  })

  it('keeps a plain-language guidance line when the runtime cannot start', async () => {
    mount(report({ status: { state: 'unavailable', reason: 'engines-unsatisfied', detail: '逆向分析需要更新运行时。', requiredEngines: '^24.22.1', nodeVersion: 'v24.21.0' } }))
    expect(await screen.findByText('逆向分析需要更新运行时。')).toBeTruthy()
    expect(screen.getByText(en.reaStatusUnavailable)).toBeTruthy()
  })

  it('reports an absent component without pretending the tools were probed', async () => {
    mount({ status: { state: 'unavailable', reason: 'component-missing' }, stateDir: null, tools: [] })
    expect(await screen.findByText(en.reaNotMounted)).toBeTruthy()
    expect(screen.queryByText(en.reaToolsTitle)).toBeNull()
    expect(screen.queryByText(en.reaNodeVersion)).toBeNull()
  })

  it('reports a failed doctor read instead of claiming a status', async () => {
    mount(null)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.loadFailed)
    expect(screen.getByText(en.reaCheckFailed)).toBeTruthy()
  })

  it('re-reads the doctor report through the recheck control', async () => {
    const view = mount()
    await screen.findByText(en.reaStatusReady)
    fireEvent.click(screen.getByRole('button', { name: en.reaRecheck }))
    await waitFor(() => { expect(view.describeRea).toHaveBeenCalledTimes(2) })
  })

  it('cancels a pending doctor read when the page unmounts', async () => {
    const view = mount()
    await waitFor(() => { expect(view.describeRea).toHaveBeenCalledTimes(1) })
    const signal = view.describeRea.mock.calls[0]![0]
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('ignores a doctor read that settles after the page left', async () => {
    const view = mount()
    const answer = Promise.withResolvers<SecurityReaDoctorSnapshot>()
    view.rerender(<ReaSection {...view.props} describeRea={() => answer.promise} />)
    view.unmount()
    answer.resolve(report())
    await settle()
  })

  it('renders the page in Chinese copy', async () => {
    mount(report(), 'zh')
    expect(await screen.findByText(zh.reaStatusReady)).toBeTruthy()
    expect(screen.getByText(zh.reaExample)).toBeTruthy()
  })

  it('keeps detailed diagnostics collapsed beside a compact tool roster', async () => {
    const view = mount()
    await screen.findByText(en.reaStatusReady)
    const diagnostics = screen.getByText(en.reaDiagnostics).closest('details')!
    expect(diagnostics.open).toBe(false)
    expect(screen.getByText(en.reaRuntimeDetails).closest('details')!.open).toBe(false)
    expect(view.container.querySelector<HTMLDetailsElement>('#rea-tools')!.open).toBe(false)
    const tools = view.container.querySelector('#rea-tools ul')!
    expect(tools.textContent).toMatchInlineSnapshot('"rizinDetectedfridaNot detected"')
    expect(screen.getByText('1 of 2 detected')).toBeTruthy()
    expect(tools.textContent).not.toContain('pip install')
    expect(screen.getByText(en.reaPageHelp)).toBeTruthy()
    expect(screen.getByText(en.reaGuideTitle)).toBeTruthy()
    expect(view.container.querySelectorAll('#rea-examples ol li')).toHaveLength(3)
  })

  it.each(['disabled', 'connecting'] as const)('shows the %s engine state without claiming readiness', async (state) => {
    mount(report({ status: { state, detail: 'Runtime not configured' }, tools: [] }))
    expect(await screen.findByText('Runtime not configured')).toBeTruthy()
    expect(screen.getByText(state === 'disabled' ? en.reaStatusDisabled : en.reaStatusConnecting)).toBeTruthy()
    expect(screen.queryByText(en.reaToolsTitle)).toBeNull()
    expect(screen.queryByText(en.reaReadyDescription)).toBeNull()
  })
})
