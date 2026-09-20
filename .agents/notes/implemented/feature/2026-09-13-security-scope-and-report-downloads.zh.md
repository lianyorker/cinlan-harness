# Agent Note: Settings 持有范围与认证报告下载

Status: implemented

[English](2026-09-13-security-scope-and-report-downloads.md) | 中文

## Problem

配置摘要不能编辑评估授权，报告按钮也不能把认证当作无限制导出许可。异步策略镜像可能保留已撤销权限；只校验第一个授权目标会遗漏报告内其他目标。

## Decision

可选 [assessment-scope-settings Provider](../../../../packages/security/assessment-scope-settings/src/index.ts) 直接从已提交 Settings 读取规范化根授权。静态 Provider 仍可在没有 Settings 时使用。Settings 修改验证完整授权并使用修订号栅栏；网络出口与凭证引用可以原子提交，空列表不授予权限。凭证引用仍为环境变量名称，内联秘密值会被拒绝。[受管资源决策](2026-09-20-managed-security-skill-resources.zh.md)负责安全研究 Settings 页面；该页面管理技能资源，不提供范围编辑器或报告控件。

Session 绑定保持不可变。扩大根授权不会扩大已有 Session；不兼容的身份变化或范围收紧可能使已有绑定失效。实现不覆盖已记录授权，也不静默重新绑定旧 Session。

report-download 操作授权通过既有认证 Harness 客户端通道交付报告，包括经过认证的远程客户端。它与任意外发 data-export、external-reporting 不同，后两者保留精确网络出口要求。Host 校验每个 Finding 目标、Execution Host、有效期、审批要求与证据策略；返回字节前 flush 授权决策，并在等待后重新校验授权。点击下载不会把待审批变成已审批。

纯 finding-export 库为人工 Consumer 生成 JSON、Markdown、SARIF；模型工具仍使用自己的导出器。报告保留元数据文本，不执行脱敏。人工 Consumer 需要授权接受 none，并按数量和字节限制拒绝整个报告，而不是截断内容。[认证报告 BFF](../../../../packages/api/security-research-controller/src/index.ts) 返回受限字节和媒体元数据；交付策略不要求资源页提供报告控件。

## Alternatives considered

**通过 Settings watcher 镜像根授权。** watcher 在 Settings 提交后异步执行，会产生可避免的旧授权窗口。

**为认证下载虚构网络出口。** Remote API 没有提供已验证的接收端点。独立操作可以授权已知交付通道，不削弱外发导出策略，也不声称验证了接收方。

**将失败恢复读取当作成功的 Settings 修改。** 写入被拒绝后，读取仍可能恢复；显式修改结果与修订号栅栏用于区分已提交授权与仅被观察到的状态。

## Consequences

报告可以到达既有 Gateway 允许的任一认证 Harness 客户端，此操作不是按 IP 限制交付。下载后的文件没有自动过期或撤销机制，自由文本 Finding 可能包含敏感信息。范围身份变更可能要求新建 Session；Execution Host id 仍遵循挂载 Provider 的生命周期。

可选 assessment-scope-tool-policy 拦截配置中的 shell、网络和 Browser 模型工具名称。唯一目标回退、无 Agent 调用、页面目的地解析与审批后重新校验仍存在授权缺口；它不限制任意 Shell 命令、直接 Provider 调用或浏览器子资源。

Finding 状态操作、全部 shell/browser/network 执行守卫、原生设备 Provider 与完整迁移验收仍需单独完成。finding_export 模型工具仅在挂载 assessmentScopeSessions 时校验 report-download，且缺少人工 Consumer 的 flush 后授权复查；它不是统一的导出授权策略。其他 Finding 读取和状态转换仍遵循各自的状态与证据前置条件。

## Verification

保留的 [Settings Provider 测试](../../../../packages/security/assessment-scope-settings/tests/provider.spec.ts)覆盖已提交授权、修订号栅栏、非法授权拒绝与网络出口/凭证引用原子修改。[报告 BFF 测试](../../../../packages/api/security-research-controller/tests/reports.host.spec.ts)覆盖多目标、排除、未知目标、待审批决策、flush 期间撤销、取消、分页、限制及保持不变的外发出口要求。[可选 Web 组合场景](../../../../apps/web/tests/security-capabilities.e2e.ts)通过 Host API 检查 Settings，比较三种报告格式，在 Host 重启后恢复范围，并断言资源页没有范围/报告控件。其完整 Web 执行属于独立发布证据；已删除的编辑器和 Blob 下载 UI 测试不能作为该页面的证据。

[原生证据决策](2026-09-13-native-browser-and-security-evidence.zh.md)与 [Browser 操作决策](2026-09-13-native-browser-operations.zh.md)继续有效，其独立 Provider 和证据归属规则未被替代。
