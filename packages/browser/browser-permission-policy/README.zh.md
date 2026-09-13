---
description: "Cinlan Harness Browser 能力包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-permission-policy

[English](README.md) | 中文

## 概述

本包负责持久化 Browser 能力中的一层职责，详细 service、provider、policy 或 tool contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

这个权限策略 Consumer 将持久 Browser 工具划分为相互独立的 observe、navigate 和 interact 决策。它同时贡献 `tools/pre-execute` 决策和匹配的 monotonic `ctx.tools.guard`，因此更早的 waterfall listener 不能强制允许绕过本策略的调用。

## 配置

| 键 | 默认值 | 工具 |
|---|---|---|
| `observe` | `ask` | `browser_list`, `browser_snapshot`, `browser_screenshot`, `browser_select_element`, `browser_capture_element`, `browser_history`, `browser_network`, `browser_downloads` |
| `navigate` | `ask` | `browser_open`, `browser_navigate`, `browser_home`, `browser_search`, `browser_back`, `browser_forward` |
| `interact` | `ask` | `browser_click`, `browser_close`, `browser_upload`, `browser_save_download` |

每个值必须是 `allow`、`ask` 或 `deny`。未知键和其他值会在插件设置期间失败。

`allow` 委托给剩余 policy chain。`ask` 返回 class-specific approval reason，并且仅允许该精确 `ToolExecution` 通过 monotonic guard。`deny` 会在 browser provider 运行前返回 class-specific denial。非 Browser 工具始终原样委托。

## 模型体验

### Permission 结果

#### 模型看到的内容

允许和获批的调用会产生常规 [`browser_*`](../tool-browser/README.zh.md) 结果。未继续执行的调用会通过 tool error 路径暴露相应 class 的 approval 或 denial 文本；本策略不增加 system prompt 或 tool definition。

##### Approval 与 denial 文本

```markdown
Allow this call to observe persistent browser tabs or page content?
Allow this call to open or navigate a persistent browser page and contact its destination?
Allow this call to interact with or close a persistent browser page?
Persistent browser observation is denied by policy.
Persistent browser navigation is denied by policy.
Persistent browser interaction is denied by policy.
```

#### Token 影响

只有被拒绝或未获批的调用会增加策略自有的 error-result token。允许和获批的调用不增加策略自有的模型内容。

#### KV Cache 影响

policy 结果追加在可复用请求前缀之后。改变 `observe`、`navigate` 或 `interact` 不会改变 prompt 或 tool definition。

## 已知限制与暂缓事项

- Policy 按 class 生效，不提供 URL、origin、page、element 或 session grant。
- `browser_close` 与 interact 共用一个 class，因为它会修改持久 Browser state，即使它不联系新 destination。
- 本策略不授权 OS Computer Use；desktop capability 需要自己的 decision 和 guard。


<a id="开发备注"></a>
### 开发备注

本包将 transport、policy 与 model-facing 职责保留在各自层；不要直接编辑生成 artifact。

No runtime invariant companion is published because ToolRuntime 在其执行生命周期内消费每项准入决定。
