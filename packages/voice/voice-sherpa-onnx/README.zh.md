# @deepseek-ai/dsh-voice-sherpa-onnx

[English](README.md) | 中文

该 Service Provider 把 `sherpa-onnx-node` 挂载为 `ctx.voice` 上的本地语音转文本引擎，并拥有设置页与 Ctrl+Shift+E 听写客户端调用的 `/voice/api` 仅回环 Host 路由。六个出厂模型覆盖完整链路：两个流式 Zipformer 模型来自 [GitHub releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)（纯中文约 74MB，中英双语约 511MB），四个额外模型来自 [HuggingFace](https://huggingface.co) 经 `hf-mirror.com` 镜像下载（英文 Zipformer 约 92MB，双语 Paraformer 约 237MB，Sense Voice 约 240MB，Whisper tiny 约 153MB）。

## 降级模式

`sherpa-onnx-node` 的原生插件（以及其按平台分发的 `optionalDependency` 二进制）从不在模块顶层导入——`sherpa-deps.ts` 只懒加载一次 `require` 并缓存结果，与 `@deepseek-ai/dsh-client-ui-better-sidebar` 的 `pty-deps.ts` 中 `node-pty` 的懒加载模式相同。原生绑定缺失或损坏不会导致该插件加载失败：`models.list` 与 `models.download` 仍能工作（缓存状态与下载是纯 Node/fetch 逻辑，不依赖原生模块），只有 `transcribe` 会失败，并带上指名加载原因的 `VOICE_ENGINE_DEGRADED` 诊断。

`engine-repair.ts` 完全照搬 `pty-deps.ts` 的 `findProfileDir`／`buildRepairCommand` 一对：从这个插件模块向上走到最近的 DSH profile 根目录（回退到 `$DSH_HOME/profiles/web`），并构建一条可粘贴的 `dsh plugin --profile "<name>" install` 命令，附带 `allowBuilds: sherpa-onnx-node: true` 的 pnpm-workspace.yaml 提示。`engine.status` 路由方法把这条确切的修复提示提供给设置页的「引擎」子分区。

## 模型缓存

每个模型下载到 `$DSH_HOME/models/voice/<id>/`。已知大小的归档使用可配置的并发 HTTP Range（`downloadSegmentBytes` 默认为 8 MiB，`downloadConcurrency` 默认为 4），瞬时故障最多按 `downloadMaxAttempts`（默认 4）尝试，并从 `downloadRetryDelayMs`（默认 1,000 ms）开始指数退避，只有一个分段连续 `downloadRequestTimeoutMs`（默认 120,000 ms）未收到响应字节时才中止；中断后保留完整分段并只续传缺失分段；忽略 Range 的服务器会回退为整包响应。组装后的归档必须先匹配模型固定的上游 SHA-256，才能开始解压；校验失败会删除保留分段，避免下次重试再次使用损坏字节。归档字节先在 `downloading` 状态组装到临时文件；字节计数完成后切换为 `extracting`，生产环境通过托管的 `ctx.subprocess` 服务调用原生 `tar -xjf ... --strip-components 1`，不再用纯 JavaScript 解码器持续占满 Host CPU。测试仍保留可注入的纯 JavaScript 解包器，覆盖真实 bzip2+tar 流水线。每个模型由一个操作和一个 AbortController 统一拥有缓存检查、下载、解包与终态清理；并发调用方等待同一个操作。`models.remove` 会先取消并等待活跃工作结束，再清除缓存和保留分段；Provider dispose 同样取消并等待活跃工作，但保留完整分段供以后续传。只有在解包结算后才写入 `.dsh-voice-ready` 哨兵，失败也只在部分文件清理完成后才变为可见。旧 Host 已完整解压但只缺哨兵的缓存，会在重启时校验 encoder／decoder／joiner／tokens 四个必需文件均存在且非空后自动收养，不再重新下载。`models.list` 报告 `not-downloaded`、带字节进度的 `downloading`、`extracting`、`ready`，或保留到下次重试的 `failed` 原因。

## /voice/api 路由

五个方法，全部 POST，全部仅限回环（与 `@deepseek-ai/dsh-client-ui-better-sidebar` 的 `/sidebar/api` 相同的 DNS-rebinding／跨站防护，因为该包未导出这个 helper，所以是复制而非引入）：

- `engine.status` —— 原生插件的加载状态；`sherpa-onnx-node` 加载成功时为 `{ ok: true }`，否则为带可粘贴修复命令的 `{ ok: false, cause, command, profile, note }`。
- `models.list` —— 带实时缓存状态的出厂清单。
- `models.download` —— 启动（或若已在进行中则等待）一次可续传的分段模型下载。
- `models.remove` —— 取消并等待活跃安装结束，再删除已安装模型、保留的失败状态、组装归档和可续传分段。
- `transcribe` —— 解码一段 base64 编码的 16kHz 单声道 PCM float32 音频，返回其转写文本；要求目标模型已报告 `ready`。

## 模型体验

### 仅传输的 Provider

#### 模型看到什么

无。该 Provider 不贡献任何面向模型的文本；`/voice/api` 的 `transcribe` 方法结果在提示词发出之前就已经替换了 composer 键入内容。

#### Token 影响

无；该 Provider 不新增请求或结果 token。

#### KV Cache 影响

无；引擎加载、模型下载/缓存状态与转写从不进入模型请求前缀。

## 已知限制与暂缓事项

- **HuggingFace 模型使用 `hf-mirror.com`** —— 四个文件下载模型从 `hf-mirror.com` 而非 `huggingface.co` 下载，以在网络不可达地区提供可访问性；镜像 URL 硬编码在 `model-registry.ts` 中。
- **网络错误显示友好提示** —— `fetch failed` 等传输错误会被翻译为用户可读的消息，提示用户检查网络或开启代理。
