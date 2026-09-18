# 语音听写

[English](voice.md) | 中文

语音听写使用本地已安装模型转写解码后的音频片段。[语音服务](../../packages/voice/voice/README.zh.md) 拥有模型身份与提供方注册；[本地提供方](../../packages/voice/voice-sherpa-onnx/README.zh.md) 拥有原生资源、下载与推理。消费者负责麦克风采集和将转写文本插入输入框。

来源：[`packages/voice/voice/src/types.ts`](../../packages/voice/voice/src/types.ts)。以下类型归语音组所有，包括由传输 Controller 重新导出的类型。

## 模型身份与定义

定义描述已注册模型；缓存状态描述特定模型是否已安装。注册本身不会下载或加载模型。

| 类型 | 字段与含义 |
|---|---|
| `VoiceModelId` | 品牌化的精确模型选择器。重复注册会被拒绝；解析未知 id 时抛出 `VOICE_MODEL_UNKNOWN`。 |
| `VoiceModelKind` | `streaming` 或 `non-streaming` 识别器类别。两者都使用下文的最终转写 API。 |
| `VoiceModelDefinition` | `id`、采用上游命名方式的显示 `name`、`description`、`recommended`、`kind`、大小提示 `approximateBytes`、`download` 与 `architecture`。 |
| `VoiceModelDownload` | `type: archive` 携带 tar.bz2 的 `url` 与 `sha256`。`type: files` 携带 `entries`，每项包含 `name`、`url`、`sha256` 与预期 `bytes`。 |

`VoiceModelArchitecture` 选择模型缓存目录内的文件布局。路径标识该识别器所需的文件；语言字段配置对应架构。

| `type` | 必需字段 |
|---|---|
| `transducer` | `encoder`、`decoder`、`joiner`、`tokens`。 |
| `paraformer` | `encoder`、`decoder`、`tokens`。 |
| `whisper` | `encoder`、`decoder`、`tokens`、`language`。 |
| `sense-voice` | `model`、`tokens`、`language`。 |

## 安装与可用性

引擎可用性与模型缓存状态相互独立。缺少提供方时操作被拒绝；已安装的提供方则可以为不可用的原生引擎返回修复指引。

| 类型 | 字段与含义 |
|---|---|
| `VoiceEngineStatus` | `ok: true` 表示可用。`ok: false` 携带 `cause`、修复 `command`、可空的启动 `profile` 与说明性 `note`。 |
| `VoiceModelSummary` | 完整 `definition: VoiceModelDefinition` 加上 `status: VoiceModelStatus`。 |
| `VoiceModelRow` | 仅供显示的 `definition` 包含 `id`、`name`、`description`、`recommended` 与 `approximateBytes`，另有缓存 `status`；省略原生架构和下载配置。 |
| `VoiceModelsListValue` | 当前 `models` 数组，由 `VoiceModelRow` 条目构成。 |
| `VoiceModelsDownloadValue` | 共享安装完成后就绪的 `cacheDir`。 |

`VoiceModelStatus` 是以 `state` 区分的联合。下载完成与模型目录就绪是不同状态。

| `state` | 额外字段与含义 |
|---|---|
| `not-downloaded` | 无额外字段。 |
| `downloading` | `receivedBytes` 与 `totalBytes` 报告传输进度。 |
| `extracting` | `receivedBytes` 与 `totalBytes`；归档字节已下载完成，正在进行原生解压与目录验证。 |
| `ready` | `cacheDir` 标识已安装的模型目录。 |
| `failed` | `message` 描述安装失败。 |

## 转写与提供方生命周期

提供方接收解码后的采样，调用方单独提供取消信号。识别器释放原生资源后，结果才结算。

| 类型 | 字段与含义 |
|---|---|
| `VoiceTranscribeRequest` | `modelId: VoiceModelId` 与包含单个 16 kHz 单声道片段的 `samples: Float32Array`。 |
| `VoiceTranscribeResult` | `text` 中的最终转写文本；没有部分结果流。 |
| `VoiceEngine` | 稳定的 `id` 与 `loadModel(definition, cacheDir)`；后者返回就绪的 `VoiceRecognizer`，或因原生绑定不可用、模型文件缺失或损坏而拒绝。 |
| `VoiceRecognizer` | `transcribe(samples)` 返回 16 kHz 单声道 float32 PCM 的最终转写文本；`dispose()` 释放原生资源，且可安全重复调用。 |

[API Controller 的同名 `VoiceTranscribeRequest`](typert.zh.md) 是包含 `pcm16kMonoBase64` 的 JSON 请求。[共享传输解析器](../../packages/voice/voice/src/transport.ts) 在生成上述归语音组所有的请求前，验证规范的小端 float32 PCM、16 MiB 解码上限与有限数值采样。

`VoiceOperations` 为 `ctx.voice` 提供归提供方所有的回调。每个回调接收 `AbortSignal`；取消仅在所拥有工作静止后结算。

| 操作 | 要求 |
|---|---|
| `engineStatus` / `modelsList` | 返回引擎可用性，或当前显示列表与缓存状态。 |
| `modelsDownload` | 安装或等待单个模型的共享安装；取消任一等待方会取消该安装。 |
| `modelsRemove` | 取消模型工作，等待原生资源释放，再移除缓存与可续传部分。 |
| `transcribe` | 使用已安装模型转写解码后的采样，并在结算前释放识别器。 |

[运行时](../../packages/voice/voice/src/index.ts) 允许注册一个引擎与一组操作。每次注册返回释放器；撤销操作会立即阻止新分派。没有已注册操作时，调用以 `VOICE_UNAVAILABLE` 拒绝。`VoiceError` 携带开放字符串错误代码，不是封闭的错误代码联合。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvoice--voiceruntime"></a>

### `ctx.voice` — `VoiceRuntime`

Registry and execution facade for the local voice-dictation engine. Exactly one Provider may register (a swappable-multi-provider seam like mobile-device's is not needed today: there is one embedded local engine, not several competing backends a deployment chooses between at runtime).

```ts cordis-catalog
/**
 * Register one provider's management and transcription operations.
 * @param operations - Provider-owned callbacks, independent of transport.
 * @returns Disposer that immediately prevents new calls to this provider.
 */
registerOperations(operations: VoiceOperations): () => void

/**
 * Read the provider's native engine status.
 * @param signal - Caller cancellation.
 * @returns Availability and repair guidance; rejects when no provider is mounted.
 */
engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus>

/**
 * Read display metadata and current installation state.
 * @param signal - Caller cancellation.
 * @returns The provider's model roster.
 */
modelsList(signal: AbortSignal): Promise<VoiceModelsListValue>

/**
 * Download or await one model's shared installation.
 * @param modelId - Registered model identity.
 * @param signal - Cancellation of the shared installation.
 * @returns Ready cache directory after all installation work settles.
 */
modelsDownload(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelsDownloadValue>

/**
 * Cancel model work and remove its cache after resources settle.
 * @param modelId - Registered model identity.
 * @param signal - Caller cancellation before deletion begins.
 */
modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void>

/**
 * Transcribe decoded audio with the installed model.
 * @param request - Model identity and 16kHz mono float32 samples.
 * @param signal - Caller cancellation; native calls settle before resources release.
 * @returns Transcript after recognizer disposal.
 */
transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult>

/**
 * Register the local engine implementation for the calling plugin lifetime.
 * A second registration throws: exactly one engine may be mounted.
 * @param engine - the local speech-to-text engine implementation.
 * @returns disposer removing the engine registration.
 */
registerEngine(engine: VoiceEngine): () => void

/**
 * Register one shipped model definition for the calling plugin lifetime.
 * Duplicate ids throw: model identity is a composition-level contract.
 * @param definition - the model's display metadata and download source.
 * @returns disposer removing the model registration.
 */
registerModel(definition: VoiceModelDefinition): () => void

/**
 * List every registered model definition in registration order.
 * @returns the shipped model roster.
 */
listDefinitions(): readonly VoiceModelDefinition[]

/**
 * Resolve one registered model definition.
 * @param modelId - exact model id.
 * @returns the definition.
 * @throws {VoiceError} VOICE_MODEL_UNKNOWN when no such model is registered.
 */
requireDefinition(modelId: VoiceModelId): VoiceModelDefinition
```

Source: [`packages/voice/voice/src/index.ts`](../../packages/voice/voice/src/index.ts)
<!-- END GENERATED cordis-surface -->
