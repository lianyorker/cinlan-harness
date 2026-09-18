---
description: "通过 UTC 日期与路由筛选查看已记录轮次的用量、明确的统计缺口并导出 CSV。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

## 摘要

通过使用统计设置页，查看 UTC 时间范围内已记录的轮次和提供方报告的 Token 用量。可以按精确的提供方与模型筛选、手动刷新实时数据，并将当前显示的报告下载为 CSV。缺失的用量和不完整扫描会明确显示，避免将已知的零用量与不可用数据混淆。

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

使用统计入口位于“设置 → 实验”。日期均表示 UTC 零点：包含开始日期，不包含结束日期。初始范围包含今天和此前六个 UTC 日期。提供方与模型选项来自主机在路由筛选前观察到的精确标识；所选值会按原始字符串精确匹配。

统计单位为**轮次（Turns）**。Token 仅包含用量已知的完整轮次，尝试与重试次数由主机的规范用量统计提供。推理 Token 属于输出的一部分。缺失的可选缓存或推理用量保持不可用，实际为零的用量仍显示零。混合或未归属的路由会明确标示，不会推测计入筛选后的总量。

完整报告没有匹配轮次时显示空结果。不完整扫描未观察到匹配项时仍标记为不完整，零计数不代表没有使用量。覆盖信息包含已扫描及已跳过的会话、已检查事件、未归属轮次、主机完成时间以及本地化原因。缺少 Remote 服务时页面保留并显示不可用提示；查询失败时显示本地化的重试状态。

刷新会重新读取所选时间范围。下载 CSV 使用当前显示的原始结果，包含筛选条件、路由行、Token 分类及覆盖信息。加载中、日期无效、服务不可用或查询失败时禁止导出。CSV 标签跟随当前英文或中文语言，保留数值零，对多行标签加引号，并防止提供方或模型文本被电子表格解释为公式。

### 组合与配置

此包没有配置字段。Host 入口不执行操作；Client 插件在 `settings.section` 和 `settingsMetadata` 中贡献页面，节标识为 `usage`，分组为 `experimental`。外层应用提供设置插槽所有者、语言服务和经过身份验证的 Usage Remote。[使用统计 API 类型](../../api/usage-controller/src/types.ts)定义请求和报告数据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[注册逻辑](src/client/index.ts)拥有词典、设置元数据、一个查询源以及视图状态句柄。插槽声明的生命周期会同时移除和恢复元数据与页面。嵌套的 Remote 注入调用 `ctx.remote.usage.query(request, signal)` 并展开其 `RemoteResult`；缺少该依赖时不会创建替代服务。

[查询源](src/client/source.ts)拥有报告快照，并为每次请求创建一个 AbortController。被替代的请求无法发布结果；页面卸载会取消当前工作；插件销毁会清空监听器、取消未完成工作并等待结算。渲染器通过注入的 hooks 区域绑定稳定的可观察源。[视图存储](src/client/filters.ts)仅保存日期与路由选择，不保存主机数据，也不写入持久设置。

[页面](src/client/UsageSection.tsx)通过框架属性和普通回调接收数据。只有报告回传的请求与当前筛选条件一致时，页面才允许显示和导出。[CSV 投影](src/client/csv.ts)与路由表共享统计单元格，并在触发下载后释放临时资源。控件使用原生设置组件及语义主题令牌。

**运行时不变量：** 不发布伴随模块。此页面展示主机报告，不拥有独立的跨插件用量关系；请求顺序和注册清理由包内测试覆盖。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下参考文档分别负责设置组合、查询语义及框架数据流。

- [设置域](../ui-settings/README.zh.md) — 节元数据与插槽声明。
- [使用统计查询类型](../../session-query/usage-query/src/types.ts) — 精确用量与有界扫描字段。
- [客户端插槽](../../../docs/subsystems/slots.zh.md) — 框架钩子、视图存储和注入。

-----

<a id="model-experience"></a>
## 模型体验

无，因为此包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV 缓存影响

无；此包既不组装也不发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

报告受到已记录用量和主机有界扫描的限制。

- 刷新为手动操作；页面不订阅实时用量变更。
- Token 表示提供方记录的用量，不代表计费金额。此页面无法重建缺失或不完整的用量。
- 筛选仅匹配可精确归属的路由。混合路由或缺失归属可能使筛选后的报告不完整。
- 主机强制执行查询范围及扫描上限；范围被拒绝时需要调整所选日期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
