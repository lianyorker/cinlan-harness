# Agent Note: 本地语音听写垂直切片（sherpa-onnx，Ctrl+Shift+E）

Status: implemented

[English](2026-08-30-local-voice-dictation-vertical-slice.md) | 中文

## Problem

Cinlan Harness 没有任何离线语音转文本能力，而参考 Orca IDE 设置页自带一个语音分区（本地模型选择/下载 + Ctrl+Shift+E 按住/开关式听写手势）。本仓库任何地方都不存在 STT 引擎、模型分发、音频采集或听写插入代码，也没有既有 Agent Note 或包提供可直接复用的相关 seam。

## Decision

新的 `voice/` 包组交付一个 provider-neutral Service Definition 加一个 Provider，形态完全照搬 `mobile-device` 组（registry 类、`registerEngine`／`registerModel`、`HarnessError` 子类、不透明的 branded 模型 id）：

- **`@deepseek-ai/dsh-voice`** —— `ctx.voice` registry：`registerEngine`／`registerModel`、`listDefinitions`／`requireDefinition`，以及区分「没有挂载引擎」组合缺口与「模型尚未下载」逐模型状态的 `engineOrUndefined`。
- **`@deepseek-ai/dsh-voice-sherpa-onnx`** —— Provider。它只懒加载一次 `require('sherpa-onnx-node')` 并缓存结果，复用 `@deepseek-ai/dsh-client-ui-better-sidebar` 的 `pty-deps.ts` 里 `node-pty` 的降级模式：原生插件缺失或损坏永远不会导致插件加载失败，只有 `transcribe` 会失败（带上指名加载原因的 `VOICE_ENGINE_DEGRADED` 代码）。`engine-repair.ts` 同样复用 `pty-deps.ts` 的 `findProfileDir`／`buildRepairCommand` 一对，构建一条可粘贴的 `dsh plugin --profile "<name>" install` 命令，附带 `allowBuilds: sherpa-onnx-node: true` 的 pnpm-workspace.yaml 提示，通过 `engine.status` 路由方法提供。两个出厂模型——`sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23`（约 74MB）与 `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`（约 511MB），均来自上游 k2-fsa/sherpa-onnx 的 `asr-models` GitHub release——在注册参考模型清单的其余部分（Parakeet、更多 Zipformer 语言、Whisper）之前，先验证了完整链路。每个已知大小的模型通过可配置的并发 HTTP Range 下载，在每个响应分块都会重置的逐分段无进度超时限制下自动重试瞬时故障，失败后保留完整分段，将分段组装为临时 `.tar.bz2` 归档并按上游 release 的 `checksum.txt` 校验后切换到 `extracting`，并通过托管的 `ctx.subprocess` 调用平台原生 `tar -xjf ... --strip-components 1`，避免生产环境的纯 JavaScript 解码器持续占满 CPU；可注入的 JavaScript 解包器仍用于聚焦测试。每个模型由一个操作和 AbortController 统一拥有缓存检查、下载、解包与终态清理，并发调用方等待该操作。`models.remove` 会先取消并等待活跃工作结束，再删除所有缓存产物；Provider dispose 同样取消并等待活跃工作，但保留完整分段供续传。只有在解包结算后才写入 `.dsh-voice-ready` 哨兵；失败也只在部分缓存文件清理完成后才发布。只缺哨兵的旧完整缓存会在所有必需模型文件都验证为非空后被自动收养，避免重新下载；结算失败原因会保留到下一次重试。Provider 拥有一个基于通用 `ctx.webServer.register` seam（与 `@deepseek-ai/dsh-client-ui-better-sidebar` 的 `/sidebar/api` 所用同一个路由注册原语）构建的仅限回环的 `/voice/api` Host 路由（`engine.status`／`models.list`／`models.download`／`models.remove`／`transcribe`），配有自己复制的信任围栏与线上信封 helper（该包未导出它们）。
- **`@deepseek-ai/dsh-client-ui-voice-dictation`** —— 客户端插件：一个使用统一面板的语音设置分区，麦克风、引擎与模型行共享间距、分隔线和状态样式，并保留两个出厂模型。「引擎」子分区（`engine.status` 加载状态，降级时带可复制的修复命令——与 `@deepseek-ai/dsh-client-ui-settings-cinlan-capabilities` 的 `InstallHint` 用于 bundle 安装命令的同一个 `writeClipboard` 一键复制基元）与「模型」子分区（字节下载、明确的安装/解压进度、就绪/失败状态）的语音设置分区，外加一枚会从浏览器权限或 WebView 持久化回退恢复、且只在获得真实权限结果后才改变该回退的麦克风授权控件、一个通过 `conversation.input.right` 注册的始终可见麦克风按钮，以及一个文档级 Ctrl+Shift+E `keydown` 监听器。按钮和快捷键共用一个活动操作归属于发起会话的响应式 DictationController，启动/停止 `MediaRecorder` 采集，经 `AudioContext.decodeAudioData` 解码，用自带的线性重采样器重采样到 16kHz 单声道，并通过 `ctx.conversation` 把转写结果追加到当前会话的 composer 草稿——这正是 `ui-better-sidebar` 的 `conversation-draft.ts` 用于其 @-引用按钮的同一条通道（因同样的理由复制而非引入：该 helper 未被导出）。麦克风、「引擎」与「模型」行使用设置面板布局；「引擎」与「模型」各自独立读取、渲染自己的加载与错误状态，因此引擎降级永远不会阻塞模型列表（下载并缓存模型不依赖任何原生模块）。

`voice` 与 `voice-sherpa-onnx` 都挂载在 `@deepseek-ai/dsh-web-app` 的 `cordis.patch.yml` 里，与 `dsh-host-webserver`（Web profile 唯一的 Host+Client bundle）相邻；`ui-voice-dictation` 与其他通用 Client 插件（`ui-settings-general`、`ui-conversation`）一起挂载在同一个文件里。

## Alternatives considered

**用云端语音转文本 API 代替本地引擎。** 拒绝：用户直接要求听写必须完全离线可用。

**用 whisper.cpp 绑定代替 sherpa-onnx-node。** 拒绝：参考 Orca 设置页截图里的确切模型名（Parakeet TDT v2/v3、Zipformer Bilingual/Streaming EN/ZH/KO、Whisper Tiny）正是 sherpa-onnx 自己的模型目录命名习惯；sherpa-onnx-node 还通过 `optionalDependencies` 提供官方按平台预编译的原生插件，与本仓库 `node-pty` 的分发形态完全一致。

**直接用 AudioWorkletNode 采集原始 PCM，而不是 MediaRecorder + 解码。** 本次切片拒绝：MediaRecorder 无需自定义 worklet 脚本即可普遍支持，解码再重采样是一个体量小、可独立测试的纯函数；延迟更低的 AudioWorklet 采集路径推迟到加入流式部分转写支持时再做（见 `voice` 包的已知限制）。

**给 `voice` 配一个照搬 `mobile-device` Provider 选择机制的可替换多 Provider seam。** 拒绝：只有一个内嵌的本地引擎，不是部署要在运行时于多个竞争后端间选择；`registerEngine` 只接受一次注册，第二次会抛出。

## Consequences

用户可以下载任一出厂模型，重新打开设置而不丢失已知麦克风状态，并从 Ctrl+Shift+E 或可见的 composer 麦克风按钮开始/停止完全离线的听写。下载字节达到 100% 后，UI 会显示原生解压阶段，并最终收敛为就绪或保留的失败原因。原生插件降级时，设置页立即给出可执行操作——与终端和能力安装页面已经使用的「修复命令+复制按钮」同一套模式——而不是一次没有任何可见原因的静默 `transcribe` 失败。Host 路由、原生解压/缓存生命周期与降级逻辑，和客户端采集/编码/设置页/按钮逻辑各自独立单测；没有任何测试真正跑通几百 MB 的网络下载或真实原生插件。扩展模型清单、加入监听中提示、加入引擎状态重新检测控件、加入流式部分转写均按各包已知限制推迟到后续工作。

## Testing

`voice`：引擎/模型注册、重复注册拒绝、`engineOrUndefined` 降级信号。`voice-sherpa-onnx`：懒加载降级模式（`sherpa-deps.spec.ts`）、profile 检测与修复命令构建（`engine-repair.spec.ts`）、用真实微型 `.tar.bz2` fixture 覆盖下载/解压/失败/恢复状态转换（`model-cache.spec.ts`）、托管原生 tar subprocess 调用、挂载在真实 `WebServer` 上且包含 `engine.status` 与回环拒绝的 `/voice/api` 路由（`index.spec.ts`），以及 wire/trust helper。`ui-voice-dictation`：「引擎」就绪/降级/复制命令状态、「模型」下载→安装→就绪收敛及过期/失败处理、不会把媒体错误混作拒绝的跨 remount 权限持久化、会话拥有的可见 composer 麦克风按钮和 slot 生命周期、针对假 `MediaRecorder`／`AudioContext` 的采集-解码-重采样-编码、共享按钮/Ctrl+Shift+E 往返集成测试（假麦克风 → 假转写 → 假 `conversation.input.for(actx).setDraft`）、在延迟转写期间 dispose 以证明达到 quiescence 且不会发布过期草稿，以及 built `lib/client.js` 能完成语法解析并只注册一个匹配的 module factory。`apps/web/tests/settings-chrome.e2e.ts` 会启动真实 Web 组合，验证语音设置分区、跨设置 remount 的浏览器麦克风权限、静态平台图标出口，以及真实会话 composer 中的麦克风按钮。
