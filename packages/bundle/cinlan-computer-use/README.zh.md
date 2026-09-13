---
description: "默认请求审批的可选桌面控制 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-computer-use

[English](README.md) | 中文

## 概述

默认请求审批的可选桌面控制 profile bundle。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

`@deepseek-ai/dsh-cinlan-computer-use` 是一个通过 Cinlan CLI 提供本地桌面 Computer Use 的可选 profile patch bundle。请在 [`@deepseek-ai/dsh-base`](../base/README.zh.md) 之后添加；它不会加入 base bundle，也不会进入未明确点名它的 profile。

[`cordis.patch.yml`](cordis.patch.yml) 挂载 [`@deepseek-ai/dsh-computer-use`](../../computer-use/computer-use/README.zh.md)，将 Provider 固定为 `cinlan`，挂载 [`@deepseek-ai/dsh-computer-use-cinlan`](../../computer-use/computer-use-cinlan/README.zh.md)，安装 [`@deepseek-ai/dsh-computer-use-permission-policy`](../../computer-use/computer-use-permission-policy/README.zh.md)，并通过 [`@deepseek-ai/dsh-tool-computer-use`](../../computer-use/tool-computer-use/README.zh.md) 暴露六个分组的 [`computer_*`](../../computer-use/tool-computer-use/README.zh.md) 工具。Provider 保留其包级默认值：`orca` executable（Linux 上为 `orca-ide`）、协议探测、有界 subprocess 输出、一个本地 session 命名空间和本地 runtime 环境 tombstone。

Bundle 的默认策略面向具备 approval 能力的 profile，并采用最小权限：观察、指针、键盘和无障碍变更全部为 `ask`。后续 profile patch 可以用部署特定决策替换完整的 `computer-use-permission-policy` row config。Provider override 应放在 `computer-use-cinlan` row；patch 会替换该 row 的完整 config，之后省略的字段使用 Provider 包默认值。

<a id="model-experience"></a>
## 模型体验

### 本地桌面 Computer Use 工具

#### 模型看到的内容

Bundle 存在时，模型会收到 `computer_list_apps`、`computer_list_windows`、`computer_observe`、`computer_pointer`、`computer_keyboard` 和 `computer_accessibility`，以及 [`@deepseek-ai/dsh-tool-computer-use`](../../computer-use/tool-computer-use/README.zh.md#model-experience) 拥有的稳定桌面 guidance。未获批准的调用会返回权限策略包拥有的 class-specific approval 文本。

#### Token 影响

工具 schema 和 Computer Use guidance 会增加固定的请求前缀贡献。应用、窗口、无障碍树、动作和可选截图结果取决于具体操作。

#### KV Cache 影响

Bundle 与子包配置固定时，前缀保持稳定。添加或移除 bundle，或者修改会改变 schema 或 prompt 的工具配置，会从请求前缀中的对应位置起使复用失效。

## 已知限制与暂缓事项

- **需要 base 服务** - bundle 要求 profile 提供 subprocess、attachment、system-prompt 和 tool 服务，通常由 `dsh-base` 提供。可选的 LLM 路由元数据会为支持图片的模型启用截图采集；缺少该元数据时，观察仍保留无障碍树并跳过截图。
- **每个操作默认都询问** - 没有 approval answerer 的界面会拒绝 Computer Use 调用，直到其 profile 提供不同的显式策略。
- **Cinlan CLI 可用性属于外部条件** - 配置的 executable 必须已安装、已认证，并提供协议版本为 1 且支持应用与窗口列表的 `computer` 命令。
- **Bundle 不是桌面应用** - 它向现有 CLI 或 Web profile 贡献由 CLI 支撑的能力，不交付 Windows、macOS 或 Linux 原生客户端外壳。
- **其他设备家族保持独立** - 该组合不增加持久 Browser、Mobile Device、Android/iOS emulator 或 simulator、Speech/Audio、麦克风、扬声器、STT 或 TTS 能力。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
