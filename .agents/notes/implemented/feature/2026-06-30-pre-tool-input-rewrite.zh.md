# Agent Note: 工具执行前输入重写——一致性设计

Status: implemented

[English](2026-06-30-pre-tool-input-rewrite.md) | 中文

## Problem

[拦截扩展点 Agent Note](2026-06-30-interception-extension-points.zh.md) 将 `tools/pre-execute` 定义为一道针对执行的允许/拒绝/询问门禁，此时执行的身份标识已受保护、参数已被深度冻结。Claude Code 的 `PreToolUse` 钩子还提供了 `updatedInput`，因此忠实的桥接需要一个显式的重写机制。重写不能是对现有执行对象的可变逃逸口：它必须保持持久化历史、审计记录、展示层与实际执行值之间的一致性。

### 执行前参数的三个读取方

在 agent loop（智能体循环）中，工具调用的参数在工具执行之前就已提交到日志并被实时消费方读取：

1. **`assistant/message`** 在工具分发之前追加——它是 `deriveMessages()` 回放时的模型历史来源，因此携带模型自身输出的工具调用参数。
2. **`tool/call`** 是持久化的审计记录，在 `ctx.tools.execute()` 之前追加。
3. **面向人类的展示读取 `tool/call.arguments`**：UI 渲染器将这些参数传给 `presentResult`；`dsh-tool-bash` 从中派生卡片标题、rawInput、cwd 以及终端/后台处理方式。

如果只做执行层面的重写，UI 会显示一条命令而实际运行的是另一条，并且结果会对着错误的参数渲染。注册表通过以下方式防止这种失败模式：对 `arguments` 做 structured-clone 并深度冻结，将执行身份属性设为不可写，且不暴露任何可替换它们的测试 shim 或监听路径。重写设计必须维护这一受保护的身份边界，而非削弱它。

## Decision

重写是一个「身份标识创建前的一致性事务」。当监听器或钩子提供重写输入时，有效值在注册表构造其不可变的 `ToolExecution` 之前确定，并原子地反映到全部三个读取方：

- **`tools/input-rewrite` 瀑布流**：`ToolRuntime` 在创建执行身份和持久化事件之前暴露早期的 `tools/input-rewrite` 瀑布流事件。监听器返回 `ToolInputRewriteDecision`（`{ kind: 'proceed'; arguments?: unknown }`）。
- **审计追踪（`tool/call`）**：`tool/call` 审计事件记录重写后的参数，原始参数保留在可选的伴随字段 `originalArguments?: string` 中。
- **模型历史（`assistant/message`）**：agent loop 在追加到会话日志前就地更新 `assistant/message` 中的工具调用块，确保 `deriveMessages()` 忠实反映实际执行内容。
- **展示层**：UI 展示器（`presentCall`/`presentResult`）从 `tool/call.arguments` 读取重写后的参数，因此卡片、标题和 diff 与实际运行内容一致。
- **不可变执行**：`ToolExecution.arguments` 全程保持深度冻结且不可写；不存在任何可变后门。
- **桥接层去重**：方言桥接（`dsh-hooks-claude-code`）在 `tools/input-rewrite` 时运行 `PreToolUse`，按 `callId` 缓存结果并在 `tools/pre-execute` 中消费，确保钩子脚本严格只执行一次。

## Alternatives considered

### 为什么不直接修改执行对象？

允许 pre-execute 监听器赋值 `exec.arguments` 只能提供执行层面的重写，模型历史、审计和展示层不会随之改变。保持身份标识受保护使得这种局部行为不可表达。

### 为什么不追加单独的修正消息？

向历史追加一条合成的修正消息会改变对话轮次结构，使提示词前缀缓存失效，并且背离了 Claude Code 让重写直接替换调用参数的模型。

## Consequences

工具执行前输入重写在全部消费方之间保持原子一致。带有 `updatedInput` 的 Claude Code 钩子得到完全兑现，不再记录未兑现警告。`ToolExecution` 保持其受保护的不变量。若钩子拒绝调用，缓存的决策将在 `tools/pre-execute` 处拒绝且不重复执行脚本。所有审计线索均完整保留原始参数与生效参数。
