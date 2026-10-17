# Agent Note: Harness M3 验证

Status: implemented

[English](2026-10-13-harness-m3-validation.md) | 中文

## 问题

Electron 初始化本地配置、日志、会话与工具对象，Web Host 则使用独立的 Cordis 服务。初始化成功不能证明这些对象与 Host 之间存在对话或执行链路。里程碑计划混合了本地模块集成与应用级验收。

## 决策

M3 证据区分两条路径。真实文件的子进程夹具验证[本地模块](../../../../apps/desktop/src/harness/README.zh.md)。[随附 Web 组合测试](../../../../apps/web/tests/harness-closed-loop.e2e.ts) 从浏览器提交经过现有 Agent loop 和平台 shell，观察下一次模型请求中的工具结果，并验证回复与 Session 事件。只有外部模型适配器是确定性的。

本地 Session 状态事件区分 idle、error 与 completed；从 paused 进入 active 记录 resumed。这些事件属于进程内实现，不是已发布的 Cordis Session 格式。

## 考虑过的替代方案

**在本地 Harness 目录中另建 LLM、MCP 或 IPC 服务。** 本次验证工作不采用：Host 已有这些服务，第二套实现不能证明与随附应用的集成。

**把终端或启动冒烟视为完整验收。** 不采用：这些测试缺少浏览器提交、模型工具调度、后续请求与持久事件。

**刷新失败的历史快照。** 当录制中的 bash 调用在 Windows 预设不可用或控件已经漂移时不采用：刷新预期输出会保留执行失败，而不是验证预期效果。

## 结果与代价

本地夹具既是可运行示例，也是集成回归，不成为另一条应用启动入口。Web 测试无需 provider 凭据即可验证真实下游执行，但不能验证实时模型行为。Host-process 测试使用夹具子进程验证进程 IPC，不验证 Electron 窗口。历史回放失败保留为独立证据，不重写现有 Session generation。
