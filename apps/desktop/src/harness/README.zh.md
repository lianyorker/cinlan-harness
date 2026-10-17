# Desktop 本地 Harness 模块

[English](README.md) | 中文

## 范围

这些模块在 Electron 主进程中初始化，不提供 Web Host 的 Cordis 配置、持久 Session、模型适配器或工具。应用对话和执行使用现有 Host 服务；本地集成测试不能证明两套实现已连接。

## 配置与日志

`loadHarnessConfig(projectPath)` 依次合并默认值、全局配置、用户配置与项目配置。Windows 全局配置位于 `%PROGRAMDATA%/cinlan-harness/config.json`，其他平台位于 `/etc/cinlan-harness/config.json`；用户配置位于 `~/.cinlan/config.json`，项目配置位于 `<projectPath>/.harness/config.json`。缺失文件被跳过。`${VAR}` 引用递归展开，未设置的变量展开为空字符串。已有文件不可读或 JSON 无法解析时加载失败。解析字段没有运行时 schema 校验。

`createLogger` 支持 JSON 和 pretty 格式，输出到配置的目标文件或 stdout。子 logger 继承上下文与输出目标。声明的 compact 格式目前使用 JSON 输出；轮转字段未实现轮转。不要记录包含 API key 的配置对象。

## 会话与工具

`MemorySessionManager` 创建、查找、列出和删除进程内会话。上下文更新合并顶层字段，读取返回浅拷贝。状态赋值记录 `idle`、`started`、`paused`、`error` 或 `completed`；从 paused 进入 active 记录 `resumed`。每次显式状态赋值都会记录事件，即使状态没有改变。未实现转换限制或持久化。事件数组读取返回浅拷贝，不提供深层不可变性。

`MemoryToolRegistry` 替换同名工具，注销不存在的工具不产生效果。执行返回工具结果；工具缺失或执行被拒绝时返回 `success: false` 与错误消息。参数定义仅用于描述：注册表不校验参数、不执行 sandbox policy，也不会自动追加 Session 事件。调用方必须显式编排这些操作。

## 验证示例

可运行的[集成夹具](../../tests/fixtures/harness-integration.ts) 加载真实配置文件，通过已注册工具写入便笺，更新会话，记录生命周期和工具事件，并输出带关联字段的 JSON 日志。对应[测试](../../tests/harness-integration.spec.ts) 拥有隔离的 home 和工作区，在子进程退出后验证文件与日志。它是测试夹具，不是应用启动入口。

```sh
pnpm exec vitest run apps/desktop/tests/harness-config.spec.ts apps/desktop/tests/harness-logging.spec.ts apps/desktop/tests/harness-session.spec.ts apps/desktop/tests/harness-tools.spec.ts apps/desktop/tests/harness-integration.spec.ts
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/harness-closed-loop.e2e.ts
```

Web 测试启动随附组合，提交浏览器输入，通过真实 Agent loop 执行平台 shell，将结果送入第二次模型请求，并验证回复与 Session 事件。只有外部模型适配器是确定性的；该测试不验证真实 provider 或 Electron IPC。
