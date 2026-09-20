---
description: "桌面观察和输入的审批与不可绕过的执行检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use-permission-policy

[English](README.md) | 中文

## 概述

批准或拒绝 facade 动作及完整的原生 Cua Driver 工具目录。默认值为 ask，executor guard 将策略准入绑定到同一次工具执行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个权限策略 Consumer 通过一个 `native` 决策覆盖原生 Cua Driver 目录，并将六个 facade 工具划分为相互独立的观察、指针、键盘和无障碍变更决策。它同时贡献 `tools/pre-execute` 决策和匹配的 monotonic `ctx.tools.guard`，因此更早的 waterfall listener 不能强制允许绕过本策略的调用。

## 配置

| Key | 默认值 | 工具 |
|---|---|---|
| `native` | `ask` | 所有 `cua_driver_native__*` 工具，包括未来的目录新增项 |
| `observe` | `ask` | `computer_list_apps`, `computer_list_windows`, `computer_observe` |
| `pointer` | `ask` | `computer_pointer` |
| `keyboard` | `ask` | `computer_keyboard` |
| `accessibilityAction` | `ask` | `computer_accessibility` |

每个值必须严格为 `allow`、`ask` 或 `deny`。未知 key 和其他值会在插件设置时失败。

`native` 匹配 `cua_driver_native__` 前缀，包括未来的上游新增工具。`allow` 会委托给剩余 policy chain。`ask` 返回对应 class 的审批原因，并且只允许该精确 `ToolExecution` 通过 monotonic guard。`deny` 会在 Computer Use Provider 运行前返回对应 class 的拒绝。非 Computer Use 工具始终原样委托。

<a id="model-experience"></a>
## 模型体验

### Permission 结果

#### 模型看到的内容

允许和获批的 facade 调用会产生常规 [`computer_*`](../tool-computer-use/README.zh.md) 结果；原生调用保留 Cua Driver 结果。未继续执行的调用会通过 tool error 路径暴露所配置 class 的审批或拒绝文本；本策略不增加 system prompt 或 tool definition。

##### Approval 与 denial 文本

```markdown
Allow this native computer-use call to observe or control the local desktop?
Allow this call to observe local desktop applications or window content?
Allow this call to click, scroll, or drag in a local desktop application?
Allow this call to send keyboard or clipboard input to a local desktop application?
Allow this call to perform an accessibility action or set a desktop element value?
Native computer use is denied by policy.
Desktop observation is denied by policy.
Desktop pointer input is denied by policy.
Desktop keyboard or clipboard input is denied by policy.
Desktop accessibility mutation is denied by policy.
```

#### Token 影响

只有被拒绝或未获批的调用会增加策略自有的 error-result token。允许和获批的调用不增加策略自有模型内容。

#### KV Cache 影响

Policy 结果追加在可复用请求前缀之后。修改 permission 决策不会改变 prompt 或工具定义。

## 已知限制与暂缓事项

- 原生工具共享一个决策；策略不会从上游名称或 schema 推断动作风险。
- Policy 按 class 生效，不提供 application、process、window、element、action name、coordinate 或 session grant 粒度。
- `computer_keyboard` 同时覆盖字面输入、clipboard paste、按键和快捷键；本策略不能分别批准这些子动作。
- 本策略不授权 Browser、Mobile Device、emulator、simulator、麦克风、扬声器、Speech/Audio 或网络操作。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
