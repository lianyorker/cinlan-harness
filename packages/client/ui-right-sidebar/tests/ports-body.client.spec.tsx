// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addPortForward,
  disconnectHostPorts,
  getWorkspacePortsState,
  removePortForward,
  resetWorkspacePortsStore,
  scanWorkspacePorts,
} from '../src/client/ports-store.ts'
import { PortsBody } from '../src/client/PortsBody.tsx'
import { en } from '../src/client/locales.ts'

beforeEach(() => {
  localStorage.clear()
  resetWorkspacePortsStore()
})

afterEach(cleanup)

describe('ports-store', () => {
  it('initializes with idle status and empty collections', () => {
    const state = getWorkspacePortsState()
    expect(state.status).toBe('idle')
    expect(state.detectedPorts).toEqual([])
    expect(state.forwardedPorts).toEqual([])
  })

  it('scans workspace ports and distinguishes empty ports from failure', async () => {
    // Empty but successful scan
    await scanWorkspacePorts(async () => ({ ok: true, ports: [] }))
    let state = getWorkspacePortsState()
    expect(state.status).toBe('ready')
    expect(state.detectedPorts).toEqual([])
    expect(state.unavailableReason).toBeUndefined()

    // Successful scan with ports
    await scanWorkspacePorts(async () => ({
      ok: true,
      ports: [
        { port: 3000, host: '127.0.0.1', processName: 'node', detectedAt: Date.now() },
        { port: 8080, host: '0.0.0.0', processName: 'nginx', detectedAt: Date.now() },
      ],
    }))
    state = getWorkspacePortsState()
    expect(state.status).toBe('ready')
    expect(state.detectedPorts.length).toBe(2)

    // Failed probe marks unavailable with specific reason
    await scanWorkspacePorts(async () => ({
      ok: false,
      error: 'SSH tunnel unreachable',
    }))
    state = getWorkspacePortsState()
    expect(state.status).toBe('unavailable')
    expect(state.unavailableReason).toBe('SSH tunnel unreachable')
  })

  it('validates port range and throws on invalid ports', () => {
    expect(() => addPortForward({ localPort: 0, remotePort: 3000 })).toThrow(/Invalid local port/)
    expect(() => addPortForward({ localPort: 70000, remotePort: 3000 })).toThrow(/Invalid local port/)
    expect(() => addPortForward({ localPort: 3000, remotePort: -1 })).toThrow(/Invalid remote port/)
    expect(() => addPortForward({ localPort: 3000, remotePort: 65536 })).toThrow(/Invalid remote port/)
  })

  it('detects local port binding conflicts', () => {
    addPortForward({ localPort: 3000, remotePort: 3000, remoteHost: '127.0.0.1' })
    expect(() =>
      addPortForward({ localPort: 3000, remotePort: 8080, remoteHost: '192.168.1.10' })
    ).toThrow(/already bound/)
  })

  it('adds, dedupes, persists, and removes forwarding rules', () => {
    const rule = addPortForward({
      localPort: 8080,
      remotePort: 80,
      remoteHost: '10.0.0.1',
      label: 'HTTP Gateway',
    })
    expect(rule.status).toBe('active')
    expect(getWorkspacePortsState().forwardedPorts.length).toBe(1)

    // Check persistence
    const raw = localStorage.getItem('dsh.workspace.port-forwards')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).length).toBe(1)

    // Remove
    removePortForward(rule.id)
    expect(getWorkspacePortsState().forwardedPorts.length).toBe(0)
    expect(JSON.parse(localStorage.getItem('dsh.workspace.port-forwards')!).length).toBe(0)
  })

  it('releases and stops forwarded rules on disconnectHostPorts', () => {
    addPortForward({ localPort: 3000, remotePort: 3000 })
    disconnectHostPorts()
    const state = getWorkspacePortsState()
    expect(state.status).toBe('unavailable')
    expect(state.unavailableReason).toContain('disconnected')
    expect(state.forwardedPorts[0]?.status).toBe('stopped')
  })
})

describe('PortsBody component', () => {
  const t = (key: keyof typeof en) => en[key] ?? key

  it('renders panel header and performs initial scan', async () => {
    const probe = vi.fn().mockResolvedValue({
      ok: true,
      ports: [{ port: 4000, host: '127.0.0.1', processName: 'express', detectedAt: Date.now() }],
    })

    render(<PortsBody t={t as any} probe={probe} />)

    expect(screen.getByTestId('right-sidebar-ports-panel')).toBeTruthy()
    expect(screen.getByText(en['ports.title'])).toBeTruthy()
    expect(screen.getByText(en['ports.description'])).toBeTruthy()

    await waitFor(() => {
      expect(probe).toHaveBeenCalled()
      expect(screen.getByText('4000')).toBeTruthy()
      expect(screen.getByText('express')).toBeTruthy()
    })
  })

  it('allows quick-forwarding detected ports', async () => {
    const probe = vi.fn().mockResolvedValue({
      ok: true,
      ports: [{ port: 5173, host: '127.0.0.1', processName: 'vite-dev', detectedAt: Date.now() }],
    })

    render(<PortsBody t={t as any} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText('5173')).toBeTruthy()
    })

    const forwardBtn = screen.getByText(en['ports.forward'])
    fireEvent.click(forwardBtn)

    // Now port 5173 should be in forwarded ports list with Active status
    await waitFor(() => {
      expect(getWorkspacePortsState().forwardedPorts.length).toBe(1)
      expect(screen.getByText(en['ports.statusActive'])).toBeTruthy()
    })
  })

  it('supports manual port forwarding form and stops active rules', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, ports: [] })
    render(<PortsBody t={t as any} probe={probe} />)

    await waitFor(() => {
      expect(screen.getByText(en['ports.noForwarded'])).toBeTruthy()
    })

    const localInput = screen.getByLabelText(en['ports.localPort'])
    const remoteInput = screen.getByLabelText(en['ports.remotePort'])
    const labelInput = screen.getByLabelText(en['ports.label'])
    const addBtn = screen.getByText(en['ports.addBtn'])

    // Type invalid ports
    fireEvent.change(localInput, { target: { value: 'abc' } })
    fireEvent.change(remoteInput, { target: { value: '99999' } })
    fireEvent.click(addBtn)
    expect(screen.getByRole('alert')).toBeTruthy()

    // Type valid ports
    fireEvent.change(localInput, { target: { value: '9000' } })
    fireEvent.change(remoteInput, { target: { value: '9000' } })
    fireEvent.change(labelInput, { target: { value: 'Custom Microservice' } })
    fireEvent.click(addBtn)

    await waitFor(() => {
      expect(screen.getByText('9000')).toBeTruthy()
      expect(screen.getByText('(Custom Microservice)')).toBeTruthy()
    })

    // Stop rule
    const stopBtn = screen.getByTitle(en['ports.stop'])
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(getWorkspacePortsState().forwardedPorts.length).toBe(0)
    })
  })

  it('triggers onOpenUrl callback when clicking open button', async () => {
    const probe = vi.fn().mockResolvedValue({
      ok: true,
      ports: [{ port: 8080, host: '127.0.0.1', detectedAt: Date.now() }],
    })
    const onOpenUrl = vi.fn()

    render(<PortsBody t={t as any} probe={probe} onOpenUrl={onOpenUrl} />)

    await waitFor(() => {
      expect(screen.getByText('8080')).toBeTruthy()
    })

    const openBtn = screen.getByText(en['ports.open'])
    fireEvent.click(openBtn)
    expect(onOpenUrl).toHaveBeenCalledWith('http://localhost:8080')
  })

  it('renders unavailable banner when scanner probe fails', async () => {
    const probe = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Host isolation container not running',
    })

    render(<PortsBody t={t as any} probe={probe} />)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Host isolation container not running')
    })
  })
})
