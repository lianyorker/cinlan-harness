/** Optional WebGL terminal renderer lifecycle and fallback behavior. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalRendererController } from '../src/client/terminal-renderer.ts'

const state = {
  constructError: undefined as Error | undefined,
  addons: [] as { dispose: ReturnType<typeof vi.fn>; contextLoss?: () => void }[],
}

function loadWebglAddon() {
  class WebglAddon {
    readonly activate = vi.fn()
    readonly dispose = vi.fn()
    contextLoss: (() => void) | undefined
    constructor() {
      if (state.constructError !== undefined) throw state.constructError
      state.addons.push(this)
    }
    readonly onContextLoss = (listener: () => void) => {
      this.contextLoss = listener
      return { dispose: vi.fn() }
    }
  }
  return Promise.resolve({ WebglAddon })
}

function terminal() {
  return { loadAddon: vi.fn() }
}

afterEach(() => {
  state.constructError = undefined
  state.addons.length = 0
  vi.clearAllMocks()
})

describe('TerminalRendererController', () => {
  it('keeps the DOM renderer when disabled without loading the WebGL module', async () => {
    const term = terminal()
    const loader = vi.fn(loadWebglAddon)
    const controller = new TerminalRendererController(term, () => 'off', loader)
    controller.markOpened()
    await controller.update()
    expect(loader).not.toHaveBeenCalled()
    expect(term.loadAddon).not.toHaveBeenCalled()
  })

  it('does not request WebGL before xterm opens or after disposal', async () => {
    const term = terminal()
    const loader = vi.fn(loadWebglAddon)
    const controller = new TerminalRendererController(term, () => 'on', loader)
    await controller.update()
    expect(loader).not.toHaveBeenCalled()
    controller.markOpened()
    controller.dispose()
    await Promise.resolve()
    await controller.update()
    controller.markOpened()
    expect(loader).toHaveBeenCalledOnce()
    expect(term.loadAddon).not.toHaveBeenCalled()
  })

  it('loads WebGL lazily after xterm is open and can switch it off and on', async () => {
    const term = terminal()
    let mode: 'auto' | 'on' | 'off' = 'auto'
    const controller = new TerminalRendererController(term, () => mode, loadWebglAddon)
    controller.markOpened()
    await controller.update()
    expect(term.loadAddon).toHaveBeenCalledOnce()
    const first = state.addons[0]!

    mode = 'off'
    await controller.update()
    expect(first.dispose).toHaveBeenCalledOnce()

    mode = 'on'
    await controller.update()
    expect(term.loadAddon).toHaveBeenCalledTimes(2)
  })

  it('keeps DOM rendering when WebGL construction fails', async () => {
    const term = terminal()
    state.constructError = new Error('WebGL unavailable')
    const controller = new TerminalRendererController(term, () => 'on', loadWebglAddon)
    controller.markOpened()
    await controller.update()
    expect(term.loadAddon).not.toHaveBeenCalled()
  })

  it('disposes a partially created addon when xterm rejects activation', async () => {
    const term = terminal()
    term.loadAddon.mockImplementation(() => { throw new Error('renderer activation failed') })
    const controller = new TerminalRendererController(term, () => 'on', loadWebglAddon)
    controller.markOpened()
    await Promise.resolve()
    expect(state.addons[0]?.dispose).toHaveBeenCalledOnce()
  })

  it('disposes the addon on context loss and permits a later retry', async () => {
    const term = terminal()
    const controller = new TerminalRendererController(term, () => 'auto', loadWebglAddon)
    controller.markOpened()
    await controller.update()
    const first = state.addons[0]!
    first.contextLoss?.()
    expect(first.dispose).toHaveBeenCalledOnce()

    await controller.update()
    expect(term.loadAddon).toHaveBeenCalledTimes(2)
  })

  it('invalidates a pending addon load when disposed', async () => {
    const term = terminal()
    const controller = new TerminalRendererController(term, () => 'auto', loadWebglAddon)
    controller.markOpened()
    controller.dispose()
    await Promise.resolve()
    expect(term.loadAddon).not.toHaveBeenCalled()
  })
})
