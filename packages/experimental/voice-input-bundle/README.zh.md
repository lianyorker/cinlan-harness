---
description: "已退休的实验性语音输入组合，保留供源码开发使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-voice-input-bundle

[English](README.md) | 中文

## 概述

此已退休 Bundle 组合语音服务定义、本地 SenseVoice Provider、带认证的 Remote 与浏览器麦克风控件。随包 profile 使用[内置听写](../../client/ui-voice-dictation/README.zh.md)；官方插件列表不包含此 Bundle。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

随包 Web 与 Desktop profile 使用「设置 > 语音」。加载 profile 时从已选 Bundle 列表移除此退休包，保留已安装的包与缓存资源。迁移细节见[升级指南](../../../docs/upgrade-guide/v0.2.1-alpha.1/builtin-voice/guide.zh.md)。保留的实验性源码不是随包听写路径。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

保留的 `cordis.patch.yml` 添加四个实验性语音条目，选择 `sensevoice-local` 作为默认识别器，并通过 `dshHomePath` 提供 Provider 缓存目录。浏览器贡献拥有其生成 Remote 的挂载；稳定 API Remotes 不导入实验性代码。随包 profile 不组合这些条目。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音输入子系统](../../../docs/subsystems/voice-input.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为录音与准备不进入模型请求；之后的文字由普通用户提交拥有。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此 Bundle 提供一个本地识别器。额外 Provider 使用不同 id 注册到同一服务；云端识别需要显式增加 Provider 与凭据配置。Bundle 不增加模型工具或修改智能体循环。
- 保留的源码需要 `sherpa-onnx-node` 及其平台原生运行时（含 ONNX Runtime）。模型准备产生独立的磁盘占用和下载量；原生包体积随平台和版本变化。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
