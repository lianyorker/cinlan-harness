# Agent Note: 客户端模块批次恢复与诊断

Status: implemented

[English](2026-09-23-client-module-batch-recovery.md) | 中文

## 问题

共享的启动 combo 可能在传输阶段拒绝，也可能执行后没有注册全部图 row。重新播放可能重复注册已经成功的 factory，而通用 Loader 消息无法把具体 row 的原因显示给启动页。

## 决策

\`ClientModuleSystem\` 按 URL 共享一个传输 Promise，批次传输拒绝时重试一次，并记住每个已经完成执行的 URL。批次仍缺少某条 row 时标记该批次失败，让该 row 改用自己的单资源 URL；已经执行过的批次不会为了另一条缺失 row 再次播放。单资源失败会在后续 import 中继续允许重试。依赖到达错误同时点名消费方和失败的依赖方。

加载器按图 row 记录最近一次 \`import()\` 或 \`prefetch()\` 失败，包括传输、注册、依赖级联和 factory 执行失败。成功操作与 \`invalidate()\` 会清除记录。 \`ClientModuleLoader.importError()\` 使用与 import 相同的 \`/client\` id 归一化规则暴露记录。

\`AppWebEntry\` 会继续收集 Loader entry 创建和等待阶段的失败，再统一审计全部 entry。审计优先使用模块记录的错误，因此无框架启动页显示可操作的 row 失败原因，而不只是 Loader 包装错误。

## 考虑过的替代方案

**为每条缺失 row 重放整个批次。** 顺序脚本可能已经注册前面的 row，却在目标 row 注册前失败；重放会触发重复注册，掩盖原始失败。

**一个批次失败就让整张图失败。** 宿主为每条 row 提供单资源响应，因此只隔离缺失 row 可以保留已经注册的插件，并允许其余图继续启动。

**只把 import 细节留在 console。** Loader 激活失败时启动页是用户可见的恢复界面；保留最近一次 row 错误，才能在不打开开发者工具的情况下识别传输、依赖和 factory 失败。

## 后果

损坏的启动批次最多产生一次重试，并为每条缺失 row 产生一次 fallback 请求；批次已经注册的 row 仍可使用。错误记录只存在于页面内，在恢复或失效后丢弃，不改变启动 wire 或持久化 Session 数据。与模块 row 无关的 Loader 错误仍使用原有诊断。

## 测试

客户端模块测试覆盖共享重试、批次 fallback、部分注册、已执行 URL 记忆、可重试的单资源失败、依赖 cause、factory 失败、记录清理及 \`/client\` 查询。Web 启动测试覆盖无 fiber entry 显示记录的 import 消息。两个包均运行 TypeScript 与 \`oxlint\` 检查；未涉及真实 API E2E。
