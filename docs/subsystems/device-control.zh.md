# Device control

[English](device-control.md) | 中文

## 摘要

桌面和移动设备控制让 agent（智能体）能够先观察设备，再执行操作。本参考页覆盖 `packages/computer-use` 与 `packages/mobile-device` 声明的 Provider observation、操作请求、结果和权限判定。

## 目录

- [组合](#composition)
- [观察与权限](#observations-and-permission)
- [运行时就绪状态](#runtime-readiness)
- [生命周期](#lifecycle)
- [桌面类型](#desktop-types)
- [移动设备类型](#mobile-types)
- [权限判定](#permission-decisions)
- [开发备注](#dev-note)

## Composition

可选的 `device-control` profile 在 base 与 Web bundle 之上叠加[原生 CUA bundle](../../packages/bundle/cinlan-computer-use/README.zh.md) 和[原生 Android ADB bundle](../../packages/bundle/cinlan-mobile-device/README.zh.md)。Provider 激活与工具审批仍须显式选择。[用户指南](../user/develop/practice/device-control.zh.md)负责启动和配置说明。

## Observations and permission

[原生 CUA Provider](../../packages/experimental/computer-use-cua-driver-native/README.zh.md)暴露 SDK 工具目录及上游窗口快照、元素 token、请求与结果。独立的 [Computer Use facade](../../packages/computer-use/computer-use/README.zh.md) 为显式组合的 facade Provider 提供下文记录的旧式观察与操作类型。[Mobile Device](../../packages/mobile-device/mobile-device/README.zh.md) 使用精确设备 id、归一化坐标、runtime generation 和一次性 observation token；修改后须显式重新观察。

原生 CUA 通过既有工具注册表注册 SDK schema；移动工具 Consumer 注册与 Provider 无关的 schema 和指引。原生桌面工具及所有移动观察／输入类别默认 ask。执行 guard 防止先执行的工具 listener 绕过策略。截图使用既有 Attachment 服务；输入文本不会在结果摘要中回显。

## Runtime readiness

[就绪控制器](../../packages/api/device-capabilities-controller/README.zh.md)拥有 `deviceCapabilities/check`。它读取原生桌面目录生命周期或所选 facade 的能力，并列出移动设备；既不发送输入，也不返回设备身份。

| Status | Meaning |
|---|---|
| `not-configured` | 当前 Host 未挂载所选服务 |
| `available` | 原生桌面目录已就绪或 facade 探测成功；移动设备报告了可用设备 |
| `unavailable` | Provider 无法选择、解析或探测，或者没有可用的移动设备 |

`reason` 是脱敏类别，不是 Provider 原始 stderr。Loader 激活、软件安装、Provider 就绪与操作权限是不同事实。[Settings 插件](../../packages/client/ui-settings-security/README.zh.md) 保留这些区别，并显示有效的 profile 启动命令，而不是没有实现的安装命令。

## Lifecycle

原生 CUA 在工具、调用与 SDK 关闭完成前保留独占注册；关闭失败会继续占用注册。[原生 ADB Provider](../../packages/mobile-device/mobile-device-adb/README.zh.md)使用 Harness subprocess 取消、有界清理和等待工作结束的释放机制。缺少 ADB 属于前置条件失败，Settings 仍可使用。

<a id="desktop-types"></a>

## 桌面类型

[桌面类型声明](../../packages/computer-use/computer-use/src/types.ts)定义下文 facade 类型；原生 CUA 保留 SDK 拥有的 schema，不将它们转换为这些类型。数据字段均为只读；`?` 表示可选字段。[运行时](../../packages/computer-use/computer-use/src/index.ts)声明 `ComputerUseRuntime` 和 `ComputerUseError`。

`ComputerUseProviderName` 是通过 `./brand` 导出的品牌字符串，用于独占适配器。`register(name, readiness?)` 返回异步 effect disposer，`providerName` 报告占用者，`ComputerUseRegistry` 是运行时类的别名。`readiness()` 区分 `tool-catalog` 生命周期与 `facade` 能力；权限保持 `unknown`。独占适配器与已注册 facade Provider 互斥，包括不可用 Provider。组合与权限要求见[原生 CUA](../../packages/experimental/computer-use-cua-driver-native/README.zh.md) 和另行安装的 [MCP 适配器](../../packages/experimental/computer-use-cua-driver-mcp/README.zh.md)。

### 身份与观察

| 类型 | 字段与含义 |
|---|---|
| `ComputerAppId`, `ComputerWindowId` | 品牌化字符串，分别标识 Provider 发布的应用及该应用内的一个窗口。 |
| `ComputerObservationId`, `ComputerElementId` | 品牌化字符串，分别标识一次短期 observation 及仅在该 observation 中有效的元素。 |
| `ComputerApp` | `appId`、`name`、`bundleId: string` 或 `null`、`pid`、`running`、`lastUsedAt: string` 或 `null`、`useCount: number` 或 `null`。 |
| `ComputerWindow` | `windowId`、`appId`、`title`、`width`、`height`；可为 null 的 `x`、`y`、`minimized`、`offscreen`、`screenIndex`、`main`。 |
| `ComputerCapabilities` | `platform: NodeJS.Platform`、`provider`、`providerVersion`、`protocolVersion`，以及 `supports` 下的布尔标志：`apps`（`list`、`bundleIds`、`pids`）、`windows`（`list`、`targetById`、`targetByIndex`、`focus`、`moveResize`）、`observation`（`screenshot`、`annotatedScreenshot`、`elementFrames`、`ocr`）、`actions`（`click`、`typeText`、`pressKey`、`hotkey`、`pasteText`、`scroll`、`drag`、`setValue`、`performAction`）、`surfaces`（`menus`、`dialogs`、`dock`、`menubar`）。 |
| `ComputerElement` | 无障碍 observation 中的 `elementId` 与数值 `index`。 |
| `ComputerObservationTruncation` | `truncated`、`maxNodes?`、`maxDepth?`、`maxDepthReached?` 描述受限的树输出。 |
| `ComputerScreenshot` | `mediaType: 'image/png'`、`data: Uint8Array`、`width`、`height`、`scale`；这些字节尚未经过 Consumer 负责的 Attachment 持久化。 |
| `ComputerScreenshotStatus` | `state: 'captured'`；`state: 'skipped'` 加 `reason: 'no_screenshot_flag'`；或 `state: 'failed'` 加字符串 `code` 与 `message`。 |
| `ComputerObservation` | `observationId`、`app: ComputerApp`、`window: ComputerWindow`、`coordinateSpace: 'window'`、`tree`、`elements: readonly ComputerElement[]`、可为 null 的 `focusedElementId`、`truncation?`、`screenshot?`、`screenshotStatus`。 |

### 操作请求与结果

`ComputerActionRequest` 扩展 `ComputerObserveRequest`，将 `windowId` 设为必填，并增加精确的 `observationId`。下列专用操作请求均继承这些字段。`ComputerUseRuntime.observe()` 规定：同一目标的新 observation 替换旧值、修改消耗旧值、Provider generation 变化或 Provider 被卸载时，observation 即失效。

| 类型 | 字段与含义 |
|---|---|
| `ComputerObserveRequest` | `appId`、`windowId?`、`restoreWindow?`、`captureScreenshot?`。 |
| `ComputerListWindowsRequest` | `appId` 选择要列出窗口的应用。 |
| `ComputerActionRequest` | 观察选项，以及必填的 `appId`、`windowId` 和 `observationId`。 |
| `ComputerPointerTarget` | `kind: 'element'` 加 `elementId`，或 `kind: 'point'` 加窗口内坐标 `x`、`y`。 |
| `ComputerDragTarget` | `kind: 'elements'` 加 `fromElementId`、`toElementId`，或 `kind: 'points'` 加 `fromX`、`fromY`、`toX`、`toY`。 |
| `ComputerMouseButton`, `ComputerScrollDirection` | 鼠标键：`left`、`right`、`middle`。滚动方向：`up`、`down`、`left`、`right`。 |
| `ComputerClickRequest` | 增加 `target: ComputerPointerTarget`、`clickCount?`、`mouseButton?: ComputerMouseButton`、`modifiers?: string`。 |
| `ComputerSecondaryActionRequest` | 增加 `elementId` 和 Provider 公布的无障碍 `action: string`。 |
| `ComputerScrollRequest` | 增加 `target: ComputerPointerTarget`、`direction: ComputerScrollDirection`、`pages?`。 |
| `ComputerDragRequest` | 增加 `target: ComputerDragTarget`。 |
| `ComputerTypeTextRequest`, `ComputerPasteTextRequest` | 各增加原样文本 `text: string`。 |
| `ComputerPressKeyRequest`, `ComputerHotkeyRequest` | 各增加 `key: string`；hotkey 表示按平台解释的修饰键组合。 |
| `ComputerSetValueRequest` | 增加 `elementId` 和 `value: string`。 |
| `ComputerActionVerification` | `state: 'verified'` 加 `property`（`focusedText`、`selection`、`value`），或 `state: 'unverified'` 加 `reason`（`synthetic_input`、`clipboard_paste`、`provider_unavailable`、`window_changed`、`value_mismatch`）。 |
| `ComputerActionMetadata` | `path` 为 `accessibility`、`synthetic` 或 `clipboard`；可为 null 的 `actionName` 和 `fallbackReason`；`verification?: ComputerActionVerification`。 |
| `ComputerActionResult` | 必填的新鲜 `observation: ComputerObservation`，以及可选的 `action: ComputerActionMetadata`。 |
| `ComputerUseProvider` | `id: string`、`available(): boolean`、`capabilities`、`listApps`、`listWindows`、`observe`，以及九个操作方法：`click`、`performSecondaryAction`、`scroll`、`drag`、`typeText`、`pressKey`、`hotkey`、`pasteText`、`setValue`。异步方法接受可选的 `AbortSignal`；每个操作都返回 `ComputerActionResult`。 |
| `ComputerUseError` | 扩展 `HarnessError`，使用开放字符串作为机器可分流的错误码；不增加字段。 |

<a id="mobile-types"></a>

## 移动设备类型

[移动设备类型声明](../../packages/mobile-device/mobile-device/src/types.ts)区分请求设备与已解析的 Provider 目标。[MobileDeviceRuntime](../../packages/mobile-device/mobile-device/src/index.ts) 仅通过精确保存的默认值解析省略的 `deviceId`；默认设备缺失、歧义或不可用时，绝不选择其他设备。原生 ADB Provider 通过精确 `android:<serial>` id 和已验证 transport 支持 Android 手机与模拟器；离线和未授权项保持不可用。它不支持 iOS。

| 类型 | 字段与含义 |
|---|---|
| `MobileDeviceId`, `MobileDeviceGeneration`, `MobileObservationId` | 品牌化字符串，分别表示精确设备、Provider 发布的一个设备实例 generation，以及对应的一次性 observation token。 |
| `MobileDevice` | `backend`、`id: MobileDeviceId`、`name`、`state`、`isAvailable`、`detail?`。 |
| `MobileScreenshot` | Attachment 持久化前的 `mediaType: 'image/png'`、`data: Uint8Array`、`width`、`height`。 |
| `MobileScreenshotStatus` | `state: 'captured'`、`state: 'skipped'`，或 `state: 'failed'` 加字符串 `code` 与 `message`。 |
| `MobileObservation` | `device`、`deviceGeneration`、`observationId`、`coordinateSpace: 'normalized'`、`tree`、`screenshot?`、`screenshotStatus`。 |
| `MobileDeviceSettings` | 可变偏好：`enabled: boolean`、`defaultDeviceId: string`、`androidSdkPath: string`。它们不授权输入，也不激活 Provider；没有部署命令覆盖时，原生 ADB 使用 `androidSdkPath`。 |
| `MobileObserveRequest`, `MobileObserveSpec` | Request：`deviceId?`、`captureScreenshot?`。Spec 扩展该请求，为所选 Provider 提供必填的 `deviceId`。 |
| `MobileMutationRequest` | 必填的 `deviceId` 与一次性 `observationId`；下列修改请求均包含两者。 |
| `MobileTouchRequest` | 修改字段加 `kind: 'tap'` 与 `x`、`y`，或 `kind: 'swipe'` 与 `fromX`、`fromY`、`toX`、`toY`；坐标归一化到 `0..1`。 |
| `MobileTypeRequest`, `MobileButtonRequest` | 分别在修改字段上增加原样文本 `text: string` 或 Provider 支持的 `button: string`。 |
| `MobileMutationResult` | `device`、`deviceGeneration`、`observationId` 确认 token 已被消耗。调用方在下一次修改前必须重新观察。 |
| `MobileDeviceProvider` | `id: string`、`available(): boolean`、`listDevices`、`observe(MobileObserveSpec)`、`touch`、`typeText`、`pressButton`。异步方法接受可选的 `AbortSignal`；修改返回 `MobileMutationResult`。 |
| `MobileDeviceError` | 与 `MobileDeviceRuntime` 一同声明；扩展 `HarnessError`，使用开放字符串作为机器可分流的错误码，不增加字段。 |

<a id="permission-decisions"></a>

## 权限判定

[桌面策略](../../packages/computer-use/computer-use-permission-policy/src/index.ts)中的 `ComputerUsePermissionDecision` 与[移动设备策略](../../packages/mobile-device/mobile-device-permission-policy/src/index.ts)中的 `MobileDevicePermissionDecision` 均允许 `allow`、`ask`、`deny`。原生桌面类别为 `native`；facade 类别为 `observe`、`pointer`、`keyboard`、`accessibilityAction`；移动设备类别为 `observe`、`touch`、`textInput`、`deviceNavigation`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseruntime"></a>

### `ctx.computerUse` — `ComputerUseRuntime`

Registry and execution facade for desktop Computer Use providers.

```ts cordis-catalog
/**
 * Reserve computer use for a provider that publishes its own tools.
 * Registered facade providers also occupy computer use, including unavailable ones.
 * The caller must remove its tools and await owned work before releasing this effect.
 * @param name Provider-owned name used in registration diagnostics.
 * @param readiness Provider-owned lifecycle snapshot; omission reports initializing.
 * @returns Effect disposer for this exact exclusive registration.
 */
register(name: ComputerUseProviderName, readiness?: () => ComputerToolReadiness): () => Promise<void>

/**
 * Register one provider for the calling plugin lifetime.
 * @param provider Provider implementation with a unique stable id.
 * @returns Disposer that removes the provider registration.
 */
registerProvider(provider: ComputerUseProvider): () => void

/**
 * Read provider initialization separately from desktop permission or action success.
 * @param signal Cooperative cancellation signal for facade capability probes.
 * @returns Current tool-catalog lifecycle or the selected facade descriptor.
 */
async readiness(signal?: AbortSignal): Promise<ComputerReadiness>

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

Types: [ComputerUseProviderName](device-control.zh.md#desktop-types)

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

## 开发备注

无。
