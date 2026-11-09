/** Optional GPU rendering without replacing the terminal or its process attachment. */
import type { IEvent, ITerminalAddon, Terminal } from '@xterm/xterm'
import type { TerminalRenderer } from '../prefs-shared.ts'

type WebglAddonLike = ITerminalAddon & { onContextLoss: IEvent<void> }
type WebglAddonLoader = () => Promise<{ WebglAddon: new () => WebglAddonLike }>

/** Manage the optional WebGL addon for one open xterm instance. */
export class TerminalRendererController {
  private addon: WebglAddonLike | undefined
  private generation = 0
  private opened = false
  private disposed = false

  /** Manage one open xterm instance's optional GPU rendering. */
  constructor(
    private readonly term: Pick<Terminal, 'loadAddon'>,
    private readonly getMode: () => TerminalRenderer,
    private readonly loadWebglAddon: WebglAddonLoader = () => import('@xterm/addon-webgl'),
  ) {}

  /** Mark the xterm instance ready for addon activation after `Terminal.open()`. */
  markOpened(): void {
    if (this.disposed) return
    this.opened = true
    void this.update()
  }

  /** Apply the current renderer preference, retaining DOM rendering on GPU failures. */
  async update(): Promise<void> {
    if (!this.opened || this.disposed) return
    const mode = this.getMode()
    const generation = ++this.generation
    if (mode === 'off') {
      this.disposeAddon()
      return
    }
    if (this.addon !== undefined) return
    let addon: WebglAddonLike | undefined
    try {
      const { WebglAddon } = await this.loadWebglAddon()
      if (generation !== this.generation || this.disposed || this.getMode() === 'off') return
      const created = new WebglAddon()
      addon = created
      created.onContextLoss(() => {
        if (this.addon !== created) return
        this.addon = undefined
        this.safeDispose(created)
      })
      this.term.loadAddon(created)
      this.addon = created
    } catch (_webglUnavailable) {
      if (addon !== undefined) this.safeDispose(addon)
      // WebGL is optional; the built-in DOM renderer remains usable.
    }
  }

  /** Release the addon and invalidate pending dynamic imports. */
  dispose(): void {
    this.disposed = true
    this.generation++
    this.disposeAddon()
  }

  private disposeAddon(): void {
    const addon = this.addon
    this.addon = undefined
    if (addon !== undefined) this.safeDispose(addon)
  }

  private safeDispose(addon: WebglAddonLike): void {
    try {
      addon.dispose()
    } catch {
      // A partially activated GPU context can reject disposal; DOM rendering remains usable.
    }
  }
}
