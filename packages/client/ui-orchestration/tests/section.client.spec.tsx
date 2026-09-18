// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationSection, type OrchestrationSectionProps } from '../src/client/OrchestrationSection.tsx'
import { en } from '../src/client/locales.ts'
import { bench } from './fixture.client.ts'

afterEach(cleanup)

async function renderSection() {
  const b = await bench()
  const face = b.face()
  const props = {
    close: () => {}, loadInventory: face.loadInventory, saveParallelism: face.saveParallelism,
    useParallelism: bindSnapshotSelector(face.hooks.parallelism),
    t: (key: keyof typeof en, params?: Record<string, string | number>) =>
      en[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
  } as OrchestrationSectionProps
  const rendered = render(<OrchestrationSection {...props} />)
  await waitFor(() => { expect(screen.getByRole('spinbutton')).toHaveProperty('value', '4') })
  return { ...b, ...rendered, props }
}

describe('orchestration settings page', () => {
  it('saves a valid cap, restores inheritance, and keeps the ownership explanation visible', async () => {
    const b = await renderSection()
    expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeTruthy()
    const input = screen.getByRole('spinbutton', { name: en.parallelismLabel })
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(b.host.value).toBe(2) })
    await waitFor(() => { expect(screen.getByRole('button', { name: en.reset })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: en.reset }))
    await waitFor(() => { expect(input).toHaveProperty('value', '4') })
    expect(b.host.overridden).toBe(false)
    expect(screen.getByText(en.parallelismHelp)).toBeTruthy()
  })

  it('preserves rejected drafts through refresh and retries only after an explicit save', async () => {
    const b = await renderSection()
    b.host.reject = true
    const input = screen.getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.saveFailed) })
    expect(input).toHaveProperty('value', '6')
    await act(async () => { b.host.value = 5; b.host.revision += 1; b.ctx.emit('connection/reset') })
    expect(input).toHaveProperty('value', '6')
    expect(b.settings.mutate).toHaveBeenCalledTimes(1)
    b.host.reject = false
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => { expect(b.host.value).toBe(6) })
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('blocks invalid values and discloses read-only or unavailable host settings', async () => {
    const b = await renderSection()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } })
    expect(screen.getByRole('alert').textContent).toBe(en.invalidParallelism)
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(b.settings.mutate).not.toHaveBeenCalled()
    await act(async () => { b.host.writable = false; b.ctx.emit('connection/reset') })
    await waitFor(() => { expect(screen.getByText(en.readOnly)).toBeTruthy() })
    expect(screen.getByRole('spinbutton')).toHaveProperty('disabled', true)
    await act(async () => { b.host.available = false; b.ctx.emit('connection/reset') })
    await waitFor(() => { expect(screen.getByText(en.unavailable)).toBeTruthy() })
  })

  it('reveals workflow limits for a search target while retaining a parallelism draft', async () => {
    const b = await renderSection()
    const details = screen.getByText(en.engineOverviewTitle).closest('details')!
    expect(details.open).toBe(false)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } })
    b.rerender(<OrchestrationSection {...b.props} target={{ itemId: 'workflow-limits', anchorId: 'orchestration-workflow-limits' }} />)
    expect(details.open).toBe(true)
    expect(screen.getByRole('spinbutton')).toHaveProperty('value', '8')
    expect(details.querySelector('[data-settings-anchor="orchestration-workflow-limits"]')).not.toBeNull()
    expect(screen.getByText(en.engineLimitsHelp)).toBeTruthy()
    expect(b.settings.mutate).not.toHaveBeenCalled()
  })

  it('refreshes actual capabilities and exposes a recoverable inventory error', async () => {
    const b = await renderSection()
    await waitFor(() => { expect(screen.getByText(en.noPresets)).toBeTruthy() })
    b.host.inventory = { entries: [], agentPresets: [{
      id: 'mine', name: 'My agent', trust: 'user', isDefault: true,
      rows: [{ entryId: null, moduleName: '@deepseek-ai/dsh-tool-workflow', enabled: false, fiberPhase: null }],
    }] }
    fireEvent.click(screen.getByRole('button', { name: en.coverageRefresh }))
    await waitFor(() => { expect(screen.getByText(en.coverageDisabled)).toBeTruthy() })
    expect(screen.getAllByText(en.coverageMissing)).toHaveLength(3)
    b.pluginInventory.list.mockResolvedValueOnce({ ok: false, error: { message: 'connection unavailable' } } as never)
    fireEvent.click(screen.getByRole('button', { name: en.coverageRefresh }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('connection unavailable') })
    fireEvent.click(screen.getByRole('button', { name: en.coverageRefresh }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(screen.getByText('My agent')).toBeTruthy()
  })
})
