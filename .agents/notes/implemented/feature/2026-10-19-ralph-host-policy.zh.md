# Agent Note: Host 拥有的 Ralph 准入

Status: implemented

[English](2026-10-19-ralph-host-policy.md) | 中文

## Problem

Ralph 工具位于 Agent 预设内，用户配置则由 Host 拥有。独立的预设开关会重复可用性状态，仅隐藏工具也无法阻止已选中的调用开始工作。

## Decision

[Ralph 策略入口](../../../../packages/workflow/tool-ralph/README.zh.md#host-policy)在 Host 层挂载一次，默认关闭。Web 的 Standard、PTC 与 Creator 预设要求该服务。可用性同步注册或撤回工具与固定的用户明确请求指导。执行器检查当前准入和注册代次，使用 Host 与预设轮数上限的较小值，并拒绝旧定义与晚到结果。关闭或卸载会向自己拥有的运行请求取消；调用方仍等待工作流结清并释放运行。

唯一的开发者工具设置分区通过既有配置表单提供开关和已保存的正整数轮数上限。修改设置不会启动工作流，也不构成调用 Ralph 所需的用户指令。不使用新增要求的独立组合保持既有显式启用行为。不改变 Session 事件、工作流协议或已发布数据格式。

## Alternatives considered

默认启用所有模型工具会削弱主动选择。在 UI 编辑预设 YAML 会形成多个策略所有者。只过滤 schema 而不检查执行器，会使旧定义绕过关闭。强制终止任意 worker 资源会违反既有工作流清理归属。

## Consequences

策略变更影响 Host 上所有绑定会话。调用在启动时捕获轮数上限；修改上限不重写在途运行，关闭则请求取消。测试使用固定工作流响应，不启动真实子 agent。覆盖 Loader 更新、准入、旧定义直接执行、忽略取消后的晚到成功、轮数上限、卸载、保存 profile 后重启以及原生设置反馈。真实模型与浏览器验收另行进行。
