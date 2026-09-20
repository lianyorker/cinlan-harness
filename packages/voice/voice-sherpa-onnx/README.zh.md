---
description: "固定本地语音模型、Host 任务、已验证的模型代与原生识别。"
kind: "package-reference"
---
# Sherpa voice provider

[English](README.md) | 中文

## 摘要

`@deepseek-ai/dsh-voice-sherpa-onnx` 在 `ctx.voice` 上挂载本地 `sherpa-onnx-node` 识别与模型管理。它需要 `voice` 和托管 `subprocess`；Web 服务器可选。[固定目录](src/model-registry.ts) 包含六个模型，使用归档或逐文件 SHA-256 校验和。

## 目录

- [配置](#configuration)
- [资源生命周期](#resource-lifecycle)
- [传输与原生识别](#transports-and-native-recognition)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

将本插件与 [Voice 运行时](../voice/README.zh.md) 一起挂载。以下字段在加载时校验；字节数、时长、并发数与尝试次数必须是正安全整数。

| 字段 | 默认值 | 用途 |
|---|---|---|
| `cacheRoot` | `$DSH_HOME/models/voice` | 挂载时固定的绝对存储根目录 |
| `downloadSegmentBytes` | 8 MiB | 归档 Range 大小 |
| `downloadConcurrency` | 4 | 并发归档 Range 请求数 |
| `downloadMaxAttempts` | 4 | 每个 Range 或文件的尝试次数 |
| `downloadRetryDelayMs` | 1,000 | 指数退避的初始间隔 |
| `downloadRequestTimeoutMs` | 120,000 | 未收到响应字节的最长间隔 |
| `resourceLockTimeoutMs` | 10,000 | 跨 Host 锁的最长等待时间 |
| `resourceLockRetryMs` | 25 | 锁重试间隔 |
| `extractionGraceMs` | 5,000 | 托管 tar 终止宽限时间 |
| `extractionStderrBytes` | 65,536 | 保留的 tar 诊断字节数 |

<a id="resource-lifecycle"></a>
## 资源生命周期

下载、重新安装与更新立即返回 Host 任务。该模型已有运行中任务时，重复接纳会返回同一标识。客户端断开不会取消它。精确取消等待匹配任务结束并保留已安装代；过期或其他 Host 的标识无法取消替换任务。提供方释放先撤销操作，再仅取消并等待自身任务和识别器。任务进度与最终错误属于已挂载 Host，提供方重载时重置。

版本是固定下载清单与识别器配置的 `sha256:` 指纹。它不表示上游发布版本，也不发现上游版本。资源行包含已安装与可用指纹、脱敏源 URL、完整性状态及持久修订。替换期间、失败后或取消后，已就绪的旧代仍可使用。任务错误包含稳定代码与安全消息。

传输使用任务私有暂存目录。已知大小的归档采用并发 Range、有界重试和空闲超时；忽略 Range 的服务器可返回完整归档。独立文件使用相同的重试与超时设置，且必须匹配固定大小和 SHA-256。归档在托管原生 tar 解包前验证哈希。任务结束后删除暂存目录与传输分段；不提供跨任务续传。

存储在 `.resources/<modelId>` 下记录必需文件的哈希清单和不可变代。状态检查与识别器获取会验证这些字节。发布比较任务接纳时观察到的修订，在写锁内重命名已准备的暂存目录，并原子替换指针。即使已不存在，删除仍写入新的修订墓碑，防止旧任务在删除后重新发布。传输、校验或修订比较失败均保持活跃指针不变。

识别器在与发布和回收相同的锁下获取持久代租约。替换与删除仅回收没有活跃或未知所有者的非活跃代；识别器在原生释放后解除租约。明确属于已死亡进程的租约可回收。未知所有者、其他机器租约及可能复用的进程 ID 均保守保留字节。清理失败不会撤销成功发布。

保留旧 `<cacheRoot>/<modelId>` 目录。文件源缓存只有经过固定大小和校验和的精确验证，才能复制到受管存储。标记或非空归档解包结果无法证明来源，因此保持 `unverified`；显式下载或重新安装获取已验证的替代字节，但不删除旧目录。删除墓碑阻止后续自动重新收养。

<a id="transports-and-native-recognition"></a>
## 传输与原生识别

[身份验证控制器](../../api/voice-controller/README.zh.md) 是 Web 与 Desktop API。可选回环 POST 方法包括 `engine.status`、`models.list`、`models.download`、`models.reinstall`、`models.update`、`models.cancel`、`models.remove` 和 `transcribe`。两个适配器都校验请求并调度相同操作。旧路由检查回环与浏览器来源元数据；它不是身份验证机制。

原生插件按需加载。缺少插件不影响模型管理，并会提供引擎修复指引。转写要求已验证文件，并使用已安装代的识别器配置，即使目录指纹不同。原生推理是同步调用，无法中途打断；取消阻止结果返回，拆除等待其结算。

<a id="model-experience"></a>
## 模型体验

#### 模型看到什么

用户提交含转写文本的客户端草稿前，没有内容。

#### Token 影响

模型管理与原生识别不增加模型 token。

#### KV Cache 影响

资源操作不会改变模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

完整性检查在写锁内对模型文件计算哈希；`resourceLockTimeoutMs` 需要覆盖目标存储上最大模型的校验耗时。

进程在持有独占写锁时被终止，可能留下锁。竞争方超时且绝不抢占；恢复需要先确认写入方已退出，再删除锁。进程丢失后可能残留被中断任务的暂存目录。保留旧数据与未知租约有意以磁盘空间换取安全。

固定目录使用 GitHub 发布归档与固定提交的 `hf-mirror.com` 文件。不提供任意用户模型源或上游发布发现。不发布 invariant 伴随插件：存储变更直接验证其拥有的修订和租约关系，消费者读取权威存储。

## 开发者说明

[语音决策](../../../.agents/notes/implemented/feature/2026-09-14-voice-dictation-models-and-capture.zh.md) 记录完整性、取消与并发 Host 的取舍。
