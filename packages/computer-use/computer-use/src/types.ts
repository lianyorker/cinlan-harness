/** Type-only declarations for provider-neutral desktop Computer Use. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable provider-issued desktop application selector. */
export type ComputerAppId = Branded<'ComputerAppId'>

/** Stable provider-issued window selector within one application. */
export type ComputerWindowId = Branded<'ComputerWindowId'>

/** Identifier for one short-lived accessibility observation. */
export type ComputerObservationId = Branded<'ComputerObservationId'>

/** Element identifier valid only within its owning observation. */
export type ComputerElementId = Branded<'ComputerElementId'>

/** Mouse button accepted by pointer actions. */
export type ComputerMouseButton = 'left' | 'right' | 'middle'

/** Scroll direction accepted by pointer actions. */
export type ComputerScrollDirection = 'up' | 'down' | 'left' | 'right'

/** One local desktop application visible to the selected provider. */
export interface ComputerApp {
  readonly appId: ComputerAppId
  readonly name: string
  readonly bundleId: string | null
  readonly pid: number
  readonly running: boolean
  readonly lastUsedAt: string | null
  readonly useCount: number | null
}

/** One local desktop window visible to the selected provider. */
export interface ComputerWindow {
  readonly windowId: ComputerWindowId
  readonly appId: ComputerAppId
  readonly title: string
  readonly x: number | null
  readonly y: number | null
  readonly width: number
  readonly height: number
  readonly minimized: boolean | null
  readonly offscreen: boolean | null
  readonly screenIndex: number | null
  readonly main: boolean | null
}

/** Provider capability descriptor used for load-time compatibility checks. */
export interface ComputerCapabilities {
  readonly platform: NodeJS.Platform
  readonly provider: string
  readonly providerVersion: string
  readonly protocolVersion: number
  readonly supports: {
    readonly apps: { readonly list: boolean; readonly bundleIds: boolean; readonly pids: boolean }
    readonly windows: {
      readonly list: boolean
      readonly targetById: boolean
      readonly targetByIndex: boolean
      readonly focus: boolean
      readonly moveResize: boolean
    }
    readonly observation: {
      readonly screenshot: boolean
      readonly annotatedScreenshot: boolean
      readonly elementFrames: boolean
      readonly ocr: boolean
    }
    readonly actions: {
      readonly click: boolean
      readonly typeText: boolean
      readonly pressKey: boolean
      readonly hotkey: boolean
      readonly pasteText: boolean
      readonly scroll: boolean
      readonly drag: boolean
      readonly setValue: boolean
      readonly performAction: boolean
    }
    readonly surfaces: {
      readonly menus: boolean
      readonly dialogs: boolean
      readonly dock: boolean
      readonly menubar: boolean
    }
  }
}

/** Catalog lifecycle reported by a provider that publishes its own tools. */
export interface ComputerToolReadiness {
  readonly kind: 'tool-catalog'
  readonly provider: string
  readonly platform: NodeJS.Platform
  readonly state: 'initializing' | 'ready' | 'disposing' | 'failed'
  /** Registered public tool names; an empty catalog does not establish readiness. */
  readonly toolNames: readonly string[]
  /** Catalog discovery does not test operating-system permissions or input delivery. */
  readonly permissions: 'unknown'
}

/** Readiness without translating provider-owned tools into facade actions. */
export type ComputerReadiness = ComputerToolReadiness | {
  readonly kind: 'facade'
  readonly capabilities: ComputerCapabilities
  readonly permissions: 'unknown'
}

/** One element index published by an accessibility observation. */
export interface ComputerElement {
  readonly elementId: ComputerElementId
  readonly index: number
}

/** Bounded provider truncation facts for an accessibility tree. */
export interface ComputerObservationTruncation {
  readonly truncated: boolean
  readonly maxNodes?: number
  readonly maxDepth?: number
  readonly maxDepthReached?: boolean
}

/** One validated PNG screenshot before Consumer-owned attachment persistence. */
export interface ComputerScreenshot {
  readonly mediaType: 'image/png'
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  readonly scale: number
}

/** Screenshot outcome accompanying an observation. */
export type ComputerScreenshotStatus =
  | { readonly state: 'captured' }
  | { readonly state: 'skipped'; readonly reason: 'no_screenshot_flag' }
  | { readonly state: 'failed'; readonly code: string; readonly message: string }

/** One fresh desktop observation and its exact element-id scope. */
export interface ComputerObservation {
  readonly observationId: ComputerObservationId
  readonly app: ComputerApp
  readonly window: ComputerWindow
  readonly coordinateSpace: 'window'
  readonly tree: string
  readonly elements: readonly ComputerElement[]
  readonly focusedElementId: ComputerElementId | null
  readonly truncation?: ComputerObservationTruncation
  readonly screenshot?: ComputerScreenshot
  readonly screenshotStatus: ComputerScreenshotStatus
}

/** Provider-reported action verification without text-value disclosure. */
export type ComputerActionVerification =
  | { readonly state: 'verified'; readonly property: 'focusedText' | 'selection' | 'value' }
  | {
    readonly state: 'unverified'
    readonly reason: 'synthetic_input' | 'clipboard_paste' | 'provider_unavailable' | 'window_changed' | 'value_mismatch'
  }

/** Provider metadata for one accepted desktop action. */
export interface ComputerActionMetadata {
  readonly path: 'accessibility' | 'synthetic' | 'clipboard'
  readonly actionName: string | null
  readonly fallbackReason: string | null
  readonly verification?: ComputerActionVerification
}

/** One action result with the mandatory fresh post-action observation. */
export interface ComputerActionResult {
  readonly observation: ComputerObservation
  readonly action?: ComputerActionMetadata
}

/** Target and observation options shared by desktop reads and actions. */
export interface ComputerObserveRequest {
  readonly appId: ComputerAppId
  readonly windowId?: ComputerWindowId
  readonly restoreWindow?: boolean
  readonly captureScreenshot?: boolean
}

/** Request to list windows for one application. */
export interface ComputerListWindowsRequest {
  readonly appId: ComputerAppId
}

/** Exact prior observation required before a desktop mutation. */
export interface ComputerActionRequest extends ComputerObserveRequest {
  readonly windowId: ComputerWindowId
  readonly observationId: ComputerObservationId
}

/** Pointer target selected from an observation element or window-local point. */
export type ComputerPointerTarget =
  | { readonly kind: 'element'; readonly elementId: ComputerElementId }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }

/** Drag endpoints selected from observation elements or window-local points. */
export type ComputerDragTarget =
  | {
    readonly kind: 'elements'
    readonly fromElementId: ComputerElementId
    readonly toElementId: ComputerElementId
  }
  | {
    readonly kind: 'points'
    readonly fromX: number
    readonly fromY: number
    readonly toX: number
    readonly toY: number
  }

/** Request to click one observation-bound element or point. */
export interface ComputerClickRequest extends ComputerActionRequest {
  readonly target: ComputerPointerTarget
  readonly clickCount?: number
  readonly mouseButton?: ComputerMouseButton
  readonly modifiers?: string
}

/** Request to perform one provider-advertised accessibility action. */
export interface ComputerSecondaryActionRequest extends ComputerActionRequest {
  readonly elementId: ComputerElementId
  readonly action: string
}

/** Request to scroll one observation-bound element or point. */
export interface ComputerScrollRequest extends ComputerActionRequest {
  readonly target: ComputerPointerTarget
  readonly direction: ComputerScrollDirection
  readonly pages?: number
}

/** Request to drag between observation-bound elements or points. */
export interface ComputerDragRequest extends ComputerActionRequest {
  readonly target: ComputerDragTarget
}

/** Request to type literal text at the current focus. */
export interface ComputerTypeTextRequest extends ComputerActionRequest {
  readonly text: string
}

/** Request to press one key. */
export interface ComputerPressKeyRequest extends ComputerActionRequest {
  readonly key: string
}

/** Request to press one platform-aware modifier chord. */
export interface ComputerHotkeyRequest extends ComputerActionRequest {
  readonly key: string
}

/** Request to paste exact text at the current focus. */
export interface ComputerPasteTextRequest extends ComputerActionRequest {
  readonly text: string
}

/** Request to set one observation-bound element value. */
export interface ComputerSetValueRequest extends ComputerActionRequest {
  readonly elementId: ComputerElementId
  readonly value: string
}

/** Provider implementation for local desktop Computer Use. */
export interface ComputerUseProvider {
  readonly id: string
  available(): boolean
  capabilities(signal?: AbortSignal): Promise<ComputerCapabilities>
  listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]>
  listWindows(request: ComputerListWindowsRequest, signal?: AbortSignal): Promise<readonly ComputerWindow[]>
  observe(request: ComputerObserveRequest, signal?: AbortSignal): Promise<ComputerObservation>
  click(request: ComputerClickRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  performSecondaryAction(request: ComputerSecondaryActionRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  scroll(request: ComputerScrollRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  drag(request: ComputerDragRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  typeText(request: ComputerTypeTextRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  pressKey(request: ComputerPressKeyRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  hotkey(request: ComputerHotkeyRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  pasteText(request: ComputerPasteTextRequest, signal?: AbortSignal): Promise<ComputerActionResult>
  setValue(request: ComputerSetValueRequest, signal?: AbortSignal): Promise<ComputerActionResult>
}

/** Provider-selection configuration for the Computer Use runtime. */
export interface Config {
  /** Explicit provider id. Omitted auto-selects exactly one usable provider. */
  readonly provider?: string
}
