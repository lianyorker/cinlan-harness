---
description: "在本地保存不可变且带 scope 的 artifact 对象，并对发布和读取执行有界校验。"
kind: "package-reference"
---
# @deepseek-ai/dsh-artifact-local

[English](README.md) | 中文

## 概述

在本地保存不可变且带 scope 的 artifact 对象，并对发布和读取执行有界校验。

## 目录

- [使用本包](#use-this-package)
- [Config](#config)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

`LocalArtifactStore` 是 [`@deepseek-ai/dsh-artifact`](../artifact) 的本地 provider。它把不可变 object 保存到 `<DSH_HOME>/artifacts/v1/objects`，把 metadata 保存到独立目录。临时文件采用 exclusive create，再通过 hard-link 提交，因此已发布 reference 不会指向部分写入或调用方路径。

Artifact id 是不透明的随机值。Metadata 保留包含 producer identity 的授权 scope，公共 reference 只暴露安全的 provenance 和完整性字段。安全 provenance 包含可选 deployment scope reference，因为持久化 Consumer 需要用它重建精确授权。发布和 metadata 加载会拒绝 provenance 与 authorization 的任何不匹配。读取会校验每个 scope 字段，在解析 JSON 前限制 metadata 大小，要求存储的 id 与请求的 reference 一致，在同一稳定的普通文件 handle 上完成打开与验证，在缓冲前执行 object 上限检查，拒绝 symlink 和路径替换，并验证 SHA-256 与记录的字节数。

在支持 POSIX mode 的文件系统上，object 与 metadata 目录会限制为 `0700`，文件通过 exclusive create 以 `0600` 创建；process umask 可以进一步收紧权限。Windows 无法通过 Node mode bit 提供等价的 owner-only 保证，因此新目录和文件会继承配置根目录或其最近既有父目录的 DACL。要求限制 Windows 访问的部署必须把 `root` 配置到一个 DACL 已仅授权预期 principal 的目录下。

## Config

| Key | 默认值 | 含义 |
|---|---|---|
| `root` | `<DSH_HOME>/artifacts/v1` | 私有 artifact 根目录；测试或部署存储可显式设置。 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 未设置 `root` 时使用的 Harness home。 |
| `maxBytes` | 100 MiB | 发布和读取的正整数上限，不得超过 runtime 的安全分配限制。 |

未知配置键以及显式设置为空白的 `root` 或 `dshHome` 会使 plugin 加载失败。调用方可以请求高于 `maxBytes` 的读取上限；provider 会先确认调用方上限是非负安全整数，再应用更小的部署上限。

## Model Experience

### Request context and condition

#### What the model sees

`LocalArtifactStore.publish` 和校验读取不会增加 model-visible 内容。独立的授权 converter 必须先校验 object，再生成 attachment 或已记录的文本结果。

#### Token effect

没有直接 token 影响；进入 model request 的有界结果由 converter 负责。

#### KV Cache effect

在 converter 发布 model-visible 结果前保持独立；之后由 converter 负责 request 前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- Object 会保留到未来的引用感知 cleanup Consumer 运行。
- 导出审批、静态加密、远程存储和审计记录属于部署或 policy 工作。
- 不发布 runtime invariant companion，因为每个 provider operation 都会执行发布、授权、边界与完整性校验。

<a id="dev-note"></a>
### 开发备注

Provider 必须从配置的 execution-host 服务获取 identity；调用方不能提供替代的 producer identity。
