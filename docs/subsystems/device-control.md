# Device control

English | [中文](device-control.zh.md)

## Summary

Desktop and mobile control let agents inspect a device before acting on it. This reference covers the Provider-owned observations, action requests, results, and permission decisions declared by `packages/computer-use` and `packages/mobile-device`.

## Table of Contents

- [Composition](#composition)
- [Observations and permission](#observations-and-permission)
- [Runtime readiness](#runtime-readiness)
- [Lifecycle](#lifecycle)
- [Desktop types](#desktop-types)
- [Mobile types](#mobile-types)
- [Permission decisions](#permission-decisions)
- [Dev Note](#dev-note)

## Composition

The opt-in `device-control` profile layers the [Computer Use bundle](../../packages/bundle/cinlan-computer-use/README.md) and [Mobile Device bundle](../../packages/bundle/cinlan-mobile-device/README.md) over the ordinary base and Web bundles. Generic `web` and `headless` profiles do not acquire device input capabilities. The [user guide](../user/develop/practice/device-control.md) owns launch and configuration instructions.

## Observations and permission

[Computer Use](../../packages/computer-use/computer-use/README.md) names applications, windows, and observation-scoped elements. Actions consume a fresh observation and return the resulting observation. [Mobile Device](../../packages/mobile-device/mobile-device/README.md) uses exact device ids, normalized coordinates, runtime generations, and one-use observation tokens; mutation is followed by an explicit new observation.

The tool Consumers register their schemas and stable model guidance through existing tools and system-prompt services. All observation and action classes default to ask. Execution guards prevent an earlier tool listener from silently bypassing the configured policy. Screenshots use the existing Attachment service; typed input is not echoed in result summaries.

## Runtime readiness

The [readiness controller](../../packages/api/device-capabilities-controller/README.md) owns `deviceCapabilities/check`. It calls the selected desktop Provider's capabilities method or the mobile Provider's device listing; it never sends device input or returns device identities.

| Status | Meaning |
|---|---|
| `not-configured` | The selected service is absent from the active Host |
| `available` | The read-only Provider probe succeeded; mobile also reported an available device |
| `unavailable` | The Provider could not be selected, resolved, or probed, or no mobile device is available |

`reason` is a redacted category, not raw Provider stderr. Loader activation, installation, Provider readiness, and permission to act are distinct facts. The [Settings plugin](../../packages/client/ui-settings-security/README.md) preserves that distinction and shows a usable profile launch command rather than an unsupported installation command.

## Lifecycle

Providers cache only successful executable resolution. A missing CLI can be installed or its PATH repaired, then checked again without restarting the Host. Caller cancellation and plugin disposal interrupt pending executable lookup and command work. CLI failures do not prevent the Settings shell from loading. A missing external CLI is an explicit prerequisite failure, not a stubbed success.

<a id="desktop-types"></a>

## Desktop types

The [desktop declarations](../../packages/computer-use/computer-use/src/types.ts) describe exact application/window targets and observation-scoped input. Data fields are readonly; `?` marks an optional field in these tables. The [runtime](../../packages/computer-use/computer-use/src/index.ts) declares `ComputerUseRuntime` and `ComputerUseError`.

`ComputerUseProviderName` is a branded string exported through `./brand` for exclusive adapters that publish their own tools. `register(name)` returns an asynchronous effect disposer, `providerName` reports the reservation, and `ComputerUseRegistry` aliases the same runtime class. An exclusive adapter cannot coexist with any registered `ComputerUseProvider`, including an unavailable one; Cinlan multi-provider selection and observation APIs retain their existing facade. See [Cua Driver MCP](../../packages/experimental/computer-use-cua-driver-mcp/README.md) and [Cua Driver native](../../packages/experimental/computer-use-cua-driver-native/README.md) for opt-in composition and permissions.

### Identity and observations

| Type | Fields and meaning |
|---|---|
| `ComputerAppId`, `ComputerWindowId` | Branded strings identifying a Provider-issued application and one window within it. |
| `ComputerObservationId`, `ComputerElementId` | Branded strings identifying one short-lived observation and an element valid only in that observation. |
| `ComputerApp` | `appId`, `name`, `bundleId: string` or `null`, `pid`, `running`, `lastUsedAt: string` or `null`, `useCount: number` or `null`. |
| `ComputerWindow` | `windowId`, `appId`, `title`, `width`, `height`; nullable `x`, `y`, `minimized`, `offscreen`, `screenIndex`, `main`. |
| `ComputerCapabilities` | `platform: NodeJS.Platform`, `provider`, `providerVersion`, `protocolVersion`, and boolean flags under `supports`: `apps` (`list`, `bundleIds`, `pids`), `windows` (`list`, `targetById`, `targetByIndex`, `focus`, `moveResize`), `observation` (`screenshot`, `annotatedScreenshot`, `elementFrames`, `ocr`), `actions` (`click`, `typeText`, `pressKey`, `hotkey`, `pasteText`, `scroll`, `drag`, `setValue`, `performAction`), `surfaces` (`menus`, `dialogs`, `dock`, `menubar`). |
| `ComputerElement` | `elementId` and numeric `index` in the accessibility observation. |
| `ComputerObservationTruncation` | `truncated`, `maxNodes?`, `maxDepth?`, `maxDepthReached?` describe bounded tree output. |
| `ComputerScreenshot` | `mediaType: 'image/png'`, `data: Uint8Array`, `width`, `height`, `scale`; bytes precede Consumer-owned Attachment persistence. |
| `ComputerScreenshotStatus` | `state: 'captured'`; `state: 'skipped'` with `reason: 'no_screenshot_flag'`; or `state: 'failed'` with string `code` and `message`. |
| `ComputerObservation` | `observationId`, `app: ComputerApp`, `window: ComputerWindow`, `coordinateSpace: 'window'`, `tree`, `elements: readonly ComputerElement[]`, nullable `focusedElementId`, `truncation?`, `screenshot?`, `screenshotStatus`. |

### Action requests and results

`ComputerActionRequest` extends `ComputerObserveRequest`, makes `windowId` required, and adds the exact `observationId`. All specialized action requests below inherit those fields. `ComputerUseRuntime.observe()` documents validity until another observation replaces it for the same target, a mutation consumes it, the Provider generation changes, or the Provider is disposed.

| Type | Fields and meaning |
|---|---|
| `ComputerObserveRequest` | `appId`, `windowId?`, `restoreWindow?`, `captureScreenshot?`. |
| `ComputerListWindowsRequest` | `appId` selects the application whose windows are listed. |
| `ComputerActionRequest` | Observation options with required `appId`, `windowId`, and `observationId`. |
| `ComputerPointerTarget` | `kind: 'element'` with `elementId`, or `kind: 'point'` with window-local `x`, `y`. |
| `ComputerDragTarget` | `kind: 'elements'` with `fromElementId`, `toElementId`, or `kind: 'points'` with `fromX`, `fromY`, `toX`, `toY`. |
| `ComputerMouseButton`, `ComputerScrollDirection` | Mouse button: `left`, `right`, `middle`. Scroll direction: `up`, `down`, `left`, `right`. |
| `ComputerClickRequest` | Adds `target: ComputerPointerTarget`, `clickCount?`, `mouseButton?: ComputerMouseButton`, `modifiers?: string`. |
| `ComputerSecondaryActionRequest` | Adds `elementId` and the Provider-advertised accessibility `action: string`. |
| `ComputerScrollRequest` | Adds `target: ComputerPointerTarget`, `direction: ComputerScrollDirection`, `pages?`. |
| `ComputerDragRequest` | Adds `target: ComputerDragTarget`. |
| `ComputerTypeTextRequest`, `ComputerPasteTextRequest` | Each adds literal `text: string`. |
| `ComputerPressKeyRequest`, `ComputerHotkeyRequest` | Each adds `key: string`; the hotkey represents a platform-aware modifier chord. |
| `ComputerSetValueRequest` | Adds `elementId` and `value: string`. |
| `ComputerActionVerification` | `state: 'verified'` with `property` (`focusedText`, `selection`, `value`), or `state: 'unverified'` with `reason` (`synthetic_input`, `clipboard_paste`, `provider_unavailable`, `window_changed`, `value_mismatch`). |
| `ComputerActionMetadata` | `path` is `accessibility`, `synthetic`, or `clipboard`; nullable `actionName` and `fallbackReason`; `verification?: ComputerActionVerification`. |
| `ComputerActionResult` | Required fresh `observation: ComputerObservation` and optional `action: ComputerActionMetadata`. |
| `ComputerUseProvider` | `id: string`, `available(): boolean`, `capabilities`, `listApps`, `listWindows`, `observe`, and the nine action methods: `click`, `performSecondaryAction`, `scroll`, `drag`, `typeText`, `pressKey`, `hotkey`, `pasteText`, `setValue`. Async methods accept optional `AbortSignal`; every action resolves to `ComputerActionResult`. |
| `ComputerUseError` | Extends `HarnessError` with an open-string machine-routable code; it adds no fields. |

<a id="mobile-types"></a>

## Mobile types

The [mobile declarations](../../packages/mobile-device/mobile-device/src/types.ts) separate a requested device from a resolved Provider target. [MobileDeviceRuntime](../../packages/mobile-device/mobile-device/src/index.ts) resolves an omitted `deviceId` only through the saved exact default; a missing, ambiguous, or unavailable default does not select another device.

| Type | Fields and meaning |
|---|---|
| `MobileDeviceId`, `MobileDeviceGeneration`, `MobileObservationId` | Branded strings for the exact device, one Provider-issued device instance generation, and its one-use observation token. |
| `MobileDevice` | `backend`, `id: MobileDeviceId`, `name`, `state`, `isAvailable`, `detail?`. |
| `MobileScreenshot` | `mediaType: 'image/png'`, `data: Uint8Array`, `width`, `height` before Attachment persistence. |
| `MobileScreenshotStatus` | `state: 'captured'`, `state: 'skipped'`, or `state: 'failed'` with string `code` and `message`. |
| `MobileObservation` | `device`, `deviceGeneration`, `observationId`, `coordinateSpace: 'normalized'`, `tree`, `screenshot?`, `screenshotStatus`. |
| `MobileDeviceSettings` | Mutable preferences: `enabled: boolean`, `defaultDeviceId: string`, `androidSdkPath: string`. They neither authorize an operation nor activate/configure an external Provider. |
| `MobileObserveRequest`, `MobileObserveSpec` | Request: `deviceId?`, `captureScreenshot?`. Spec extends the request with required `deviceId` for the selected Provider. |
| `MobileMutationRequest` | Required `deviceId` and one-use `observationId`; all mutation requests below include both. |
| `MobileTouchRequest` | Mutation fields plus `kind: 'tap'` with `x`, `y`, or `kind: 'swipe'` with `fromX`, `fromY`, `toX`, `toY`; coordinates are normalized to `0..1`. |
| `MobileTypeRequest`, `MobileButtonRequest` | Extend mutation fields with literal `text: string` or Provider-supported `button: string`, respectively. |
| `MobileMutationResult` | `device`, `deviceGeneration`, `observationId` acknowledge the consumed token. Callers must observe again before another mutation. |
| `MobileDeviceProvider` | `id: string`, `available(): boolean`, `listDevices`, `observe(MobileObserveSpec)`, `touch`, `typeText`, `pressButton`. Async methods accept optional `AbortSignal`; mutations resolve to `MobileMutationResult`. |
| `MobileDeviceError` | Declared beside `MobileDeviceRuntime`; extends `HarnessError` with an open-string machine-routable code and no additional fields. |

<a id="permission-decisions"></a>

## Permission decisions

`ComputerUsePermissionDecision` in the [desktop policy](../../packages/computer-use/computer-use-permission-policy/src/index.ts) and `MobileDevicePermissionDecision` in the [mobile policy](../../packages/mobile-device/mobile-device-permission-policy/src/index.ts) both admit `allow`, `ask`, and `deny`. Desktop classes are `observe`, `pointer`, `keyboard`, and `accessibilityAction`; mobile classes are `observe`, `touch`, `textInput`, and `deviceNavigation`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseruntime"></a>

### `ctx.computerUse` — `ComputerUseRuntime`

Registry and execution facade for desktop Computer Use providers.

```ts cordis-catalog
/**
 * Reserve computer use for a provider that publishes its own tools.
 * Registered facade providers also occupy computer use, including unavailable ones.
 * The caller must remove its tools and await owned work before releasing this effect.
 * @param name Provider-owned name used in registration diagnostics.
 * @returns Effect disposer for this exact exclusive registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>

/**
 * Register one provider for the calling plugin lifetime.
 * @param provider Provider implementation with a unique stable id.
 * @returns Disposer that removes the provider registration.
 */
registerProvider(provider: ComputerUseProvider): () => void

/**
 * Read selected-provider capabilities.
 * @param signal Cooperative cancellation signal.
 * @returns Current provider capabilities.
 */
capabilities(signal?: AbortSignal): Promise<ComputerCapabilities>

/**
 * List local desktop applications.
 * @param signal Cooperative cancellation signal.
 * @returns Applications visible to the selected provider.
 */
listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]>

/**
 * List windows for one application.
 * @param request Application selector.
 * @param signal Cooperative cancellation signal.
 * @returns Windows owned by the selected application.
 */
listWindows(request: ComputerListWindowsRequest, signal?: AbortSignal): Promise<readonly ComputerWindow[]>

/**
 * Capture one fresh accessibility observation.
 * @param request Application, optional window, and capture options.
 * @param signal Cooperative cancellation signal.
 * @returns Observation valid until a new observation replaces it for the same target, a mutation consumes it,
 * the provider generation changes, or the provider is disposed.
 */
observe(request: ComputerObserveRequest, signal?: AbortSignal): Promise<ComputerObservation>

/**
 * Click an observation-bound element or point.
 * @param request Exact observation and click target.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
click(request: ComputerClickRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Perform an observation-bound secondary accessibility action.
 * @param request Exact observation, element, and advertised action.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
performSecondaryAction(request: ComputerSecondaryActionRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Scroll an observation-bound element or point.
 * @param request Exact observation, target, direction, and distance.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
scroll(request: ComputerScrollRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Drag between observation-bound elements or points.
 * @param request Exact observation and drag endpoints.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
drag(request: ComputerDragRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Type literal text at the observed focus.
 * @param request Exact observation and text.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
typeText(request: ComputerTypeTextRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Press one key at the observed focus.
 * @param request Exact observation and key.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
pressKey(request: ComputerPressKeyRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Press one platform-aware hotkey at the observed focus.
 * @param request Exact observation and hotkey.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
hotkey(request: ComputerHotkeyRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Paste exact text at the observed focus.
 * @param request Exact observation and text.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
pasteText(request: ComputerPasteTextRequest, signal?: AbortSignal): Promise<ComputerActionResult>

/**
 * Set one observation-bound element value.
 * @param request Exact observation, element, and value.
 * @param signal Cooperative cancellation signal.
 * @returns Fresh post-action observation and provider metadata.
 */
setValue(request: ComputerSetValueRequest, signal?: AbortSignal): Promise<ComputerActionResult>
```

Types: [ComputerUseProviderName](device-control.md#desktop-types)

Source: [`packages/computer-use/computer-use/src/index.ts`](../../packages/computer-use/computer-use/src/index.ts)

<a id="ctxmobiledevice--mobiledeviceruntime"></a>

### `ctx.mobileDevice` — `MobileDeviceRuntime`

Registry and execution facade for mobile-device Providers.

```ts cordis-catalog
/**
 * Read current resolved preferences without retaining a mutable settings reference.
 * @returns A detached settings value, or schema defaults when no settings service is mounted.
 */
getPreferences(): MobileDeviceSettings

/**
 * Register one Provider for the calling plugin lifetime.
 * @param provider Provider implementation with a unique stable id.
 * @returns Disposer that removes the Provider registration.
 */
registerProvider(provider: MobileDeviceProvider): () => void

/**
 * List mobile devices visible to the selected Provider.
 * @param signal Cooperative cancellation signal.
 * @returns Canonical device records.
 */
listDevices(signal?: AbortSignal): Promise<readonly MobileDevice[]>

/**
 * Capture one fresh device observation.
 * @param request Explicit device or omitted id for the saved default, and screenshot preference.
 * @param signal Cooperative cancellation signal.
 * @returns Observation valid for one later mutation only.
 * @throws {MobileDeviceError} When an omitted target has no unique available saved default; no failure selects another device.
 */
async observe(request: MobileObserveRequest, signal?: AbortSignal): Promise<MobileObservation>

/**
 * Tap or swipe using one exact observation.
 * @param request Exact device, one-use token, and normalized coordinates.
 * @param signal Cooperative cancellation signal.
 * @returns Mutation acknowledgement; callers must observe again before another mutation.
 */
touch(request: MobileTouchRequest, signal?: AbortSignal): Promise<MobileMutationResult>

/**
 * Type literal text using one exact observation.
 * @param request Exact device, one-use token, and text.
 * @param signal Cooperative cancellation signal.
 * @returns Mutation acknowledgement; callers must observe again before another mutation.
 */
typeText(request: MobileTypeRequest, signal?: AbortSignal): Promise<MobileMutationResult>

/**
 * Press one device navigation button using an exact observation.
 * @param request Exact device, one-use token, and button name.
 * @param signal Cooperative cancellation signal.
 * @returns Mutation acknowledgement; callers must observe again before another mutation.
 */
pressButton(request: MobileButtonRequest, signal?: AbortSignal): Promise<MobileMutationResult>
```

Source: [`packages/mobile-device/mobile-device/src/index.ts`](../../packages/mobile-device/mobile-device/src/index.ts)
<!-- END GENERATED cordis-surface -->

<a id="dev-note"></a>

## Dev Note

None.
