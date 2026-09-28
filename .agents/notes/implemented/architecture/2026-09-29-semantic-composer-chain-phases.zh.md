# Agent Note: 输入框链式选取的语义阶段

Status: implemented

[English](2026-09-29-semantic-composer-chain-phases.md) | 中文

## Problem

Web 端 `conversation.composer` 链此前仅依据全局单一数值 priority 对候选者排序，并选取第一个返回匹配项的选择器。用户提问使用默认优先级 0，审批使用优先级 1，而只读子代理输入框使用优先级 -10。当用户查看一次性历史会话时，只读提示层会遮蔽下方待回答的问题和待审批项。

单一标量混淆了两个不同的决策：候选者是用于解决现有的等待交互还是用于限制开启新任务，以及同类语义候选者之间的局部偏好。依靠数值微调保留了跨无关领域的隐式耦合，并存在后续回归风险。

## Decision

链式插槽声明可通过 `phases?: readonly string[]` 定义领域自有的有序阶段元组。

在分阶段链式插槽中，`SlotSpec` 与 `SlotMap` 强制每次注册必须显式指定一个已声明的 `phase`。省略 `phase`、指定未声明 `phase` 或在未分阶段链上声明 `phase` 的注册均会在编译期与运行时明确报错。

`SlotCore` 优先按声明阶段的索引升序对候选者排序，随后按局部数值 priority 升序排序，并在平局时保持注册顺序稳定性。

`conversation.composer` 链声明 `phases: ['interaction', 'restriction'] as const`。提问与审批注册在 `interaction` 阶段，保留提问优于审批的次序。`SubagentReadOnlyComposer` 注册在 `restriction` 阶段。已有等待优先解决；一旦解决，只读限制重新显现。

## Consequences

- 语义主导成为结构性约束：交互解决始终先于新工作启动限制，无需脆弱的优先级魔数。
- 未分阶段的链保持完全向后兼容，沿用纯数值优先级排序。
- `SlotMap` 中的类型错误在编译期捕获所有客户端插件的阶段遗漏或类型不匹配。
- 仅限浏览器的选取机制不引入模型可见的 Token 开销、请求变更或缓存失效。

## Validation

- `packages/client/ui-slots`：单元测试验证阶段校验（拒绝遗漏、未知以及未声明阶段的插槽）、阶段索引对任意局部优先级的绝对主导、阶段内优先级排序及平局稳定性。
- `packages/client/ui-slots`：编译期类型测试验证合法的分阶段注册以及 `@ts-expect-error` 预期报错。
- `packages/client/ui-conversation`：`composer-phases.client.spec.ts` 中的集成测试证明 InputBar 回退、空闲时只读展示、提问优先于只读、审批优先于只读、`interaction` 内提问优先于审批、交互解决后恢复只读，以及 HMR 重新注册确定性。
