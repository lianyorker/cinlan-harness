# Agent Note: 原生 Work Items profile 与 Workspace 归属

Status: implemented

[English](2026-09-13-native-work-items-profile.md) | 中文

## 问题

复制包不代表 profile、生成式 Remote 或持久化 Web 流程可以运行。Work Item 关联必须遵循当前 Workspace 和 Session 生命周期，而不是保留第二套归档模型。

## 决策

可选 work-items profile 在 base 和 Web 之后组合独立 bundle。它挂载注册表、原生 GitHub/Linear Provider、模型工具、Remote controller 和 Settings 页面。两个 Provider 的写入开关默认关闭。Client 通过生成式 Remote 调用，不导入 Host 实现值。

关联使用已注册 Workspace 身份及其所属、未归档的 Session。异步读取后重复校验。删除并重建 Workspace 不会将旧关联转移到新身份。取消本地关联不要求 Provider 可用。

现有账本保留不可变预览和回执。确认不替换预览字段；中断的 running 标记恢复为 unknown，绝不自动重发。

## 考虑过的替代方案

**在每个 Web profile 中挂载。** 这会为未安装该能力的用户增加 Provider 与工具 schema。可移除 bundle 保留按需组合。

**为复制的调用方恢复 Workspace 归档字段。** 这会重复注册表生命周期。更新 Consumer 可保留唯一的删除与 Session 归档模型。

## 影响

此能力无需 Orca 即可运行。Provider 范围和凭据配置仍由部署持有。专用配置 UI、真实 GitHub/Linear 账户验证和模型对话录制场景不属于本批交付。账本不协调同时共享同一数据库的多个 Host。

## 验证

真实 Web 测试只替换外部 HTTP。它验证 Remote 读取、写入拒绝、关联跨 Host 重启保留、可选能力移除，以及 1680/1000/600px 布局与命中测试。built SQLite 进程测试验证回执重放及外部操作后退出不会导致重发。未修改真实外部工单。
