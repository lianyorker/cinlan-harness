# Agent Note: Compact orchestration settings disclosure

Status: implemented

[English](2026-09-22-orchestration-settings-disclosure.md) | 中文

## Problem

编排页在同一个设置分区中同时展示主机执行设置和已求值的预设诊断。首屏直接列出所有预设条目与引擎说明会降低扫描效率，但完全隐藏诊断又会失去解释工作流能力不可用原因所需的证据。

## Decision

页面使用一个主要能力卡片，包含简短状态摘要、可编辑的并行工具调用上限和重新检查操作。引擎详情以及每个预设的工作流、委派和引擎条目默认收在折叠说明中。设置搜索会在定位工作流限制或能力覆盖锚点前自动展开说明。卡片下方保留 Workflow、Parallel 和 Pipeline 三个简短示例，以匹配编排使用流程而不增加另一套配置界面。

主机设置镜像和清单投影继续负责持久化与能力语义。页面保留被拒绝写入后的输入草稿、只读和不可用状态、清单错误，以及已配置插件条目与已激活生命周期实例之间的区别。由于本包管理主机设置并报告由组成配置管理的能力，因此不复制 Orca 的技能安装流程。

## Alternatives considered

- **首屏渲染全部诊断条目。** 所有证据都可见，但设置页会过于密集，并且会重复搜索可到达的详情层级。
- **删除能力诊断，只保留并行度。** 页面更简单，但会丢失解释预设可用性和工作流归属所需的已求值清单信息。
- **复制 Orca 的安装向导。** 主机包没有安装权限或终端生命周期；加入该流程会错误表达预设组成配置和配置流程的所有权。

## Consequences

常用路径更短，详情仍可通过明确展开或搜索访问。自动化测试需要同时覆盖默认折叠和搜索触发展开。并行度行的快照会随缩短后的帮助文案变化；工作流和覆盖条目仍在展开后可见。

## Verification

`packages/client/ui-orchestration/tests/section.client.spec.tsx` 和 `packages/client/ui-orchestration/tests/apply.client.spec.ts` 覆盖紧凑卡片、示例、持久化、错误恢复和搜索展开。通过 `pnpm exec tsc -b packages/client/ui-orchestration/tsconfig.json --pretty false` 完成包级 TypeScript 构建检查。
