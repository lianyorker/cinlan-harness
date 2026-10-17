# Agent Note：安全研究工作区命令

Status: implemented

[English](2026-10-13-research-workspace-commands.md) | 中文

## 决策

研究预设把启动和普通问题视为常规对话，而不是针对目标的评估请求。只有请求的分析依赖无法获得的对象时才要求样本文件。

[工具策略](../../../../packages/security/assessment-scope-tool-policy/README.zh.md) 允许部署配置的精确 shell 命令在 Session 工作区中执行，无需评估授权。[组合包](../../../../packages/bundle/security-research/cordis.patch.yml) 选择基础目录与 pnpm 开发命令。实际评估操作保留默认空 grant，需要配置范围。下游守卫和 sandbox policy 保持独立。

## 理由

空评估 grant 无法为普通工作区开发识别已授权的主机或目标。要求 `pwd` 提供目标会阻止 Agent 发现自己的工作区。显式命令项区分可信开发操作与评估效果，无需从任意 shell 文本猜测目标。

全局禁用范围 Consumer 会放行无关网络与评估效果。宽泛的 shell 解析会引入没有依据的安全分类器。精确匹配改为信任部署的工作区脚本与命令环境；文件系统隔离仍由 sandbox 负责。

## 验证

策略测试覆盖精确匹配、子目录、不存在或外部目录、排除参数及无效配置。随附 Web 组合检查策略激活、组装研究 persona 快照、通过有守卫的工具链执行 `pwd`、使用空 grant 拒绝复合命令，并验证侧栏终端。这些检查不调用真实模型提供方。
