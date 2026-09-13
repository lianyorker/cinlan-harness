# 安全研究续批：范围编辑与报告下载

日期：2026-09-13。接续会话：01a0988b-8241-7111-8217-a72371a8d2b3。

## 结论

本批完成范围编辑的 Settings 持久化与拒绝反馈，并提供经过独立 report-download 授权的 JSON、Markdown、SARIF 下载。真实 Web Host 已验证保存、非法配置拒绝、报告字节、撤销后拒绝和重启读取。整体 Orca 功能原生迁移尚未完成，不允许删除三个旧项目目录。

## 实现与边界

- `packages/security/assessment-scope-settings`：静态类注入 Settings，复用根授权 schema；根授权直接读取已提交配置，不通过异步 watcher 镜像。`assessment-scope-static` 保持静态配置行为。扩大根授权不扩大已有 Session，收紧或身份变化可能使旧绑定失效。
- `packages/client/ui-settings-security`：框架绑定的 Settings selector；编辑身份、时间窗、Execution Host、目标、排除项、动作和证据策略。草稿保留首次编辑 revision；显式 Remote 拒绝不会被恢复读取误报成保存成功。保存后刷新状态。高级 egress 和凭证引用保持原值，仍需在插件配置中编辑。
- `packages/security/assessment-scope`：增加默认不授予的 report-download 操作，专门允许向已认证 Harness 客户端交付报告。原 data-export、external-reporting 的精确出口要求保持不变；此操作不是按接收端 IP 进行授权。
- `packages/api/security-research-controller`：逐一校验报告中实际包含的目标，拒绝排除/未知目标及需要审批的决策；检查 Session 存活、不可变绑定、当前主机、有效期和证据策略。决策使用既有 Session event，返回前完成存储检查点并重新校验授权。默认限制 2000 个 Finding、4 MiB；并发 Session 变化或分页不前进拒绝整个报告，不返回截断内容。
- `packages/security/finding-export`：共享纯导出库。修复 tool-finding 运行时引用发布包中不存在的 `/src/*` 文件的问题，改用公开入口。报告保留自由文本，不实现脱敏，所以下载要求允许 none；不包含 Artifact 内容。下载文件没有自动过期与撤销控制。
- `SecurityReportExport`：显式 Session id 和格式；字节长度校验、inert Blob、替换/卸载释放 URL，卸载取消请求且忽略迟到响应。

## 实际验证

日志目录：`D:\Company\cinlan\cinlan-harness\.artifacts\security-settings-20260913`。

| 命令或场景 | 结果 |
|---|---|
| `pnpm run build`，最终 build-delivery.log | 通过，248 Client artifacts |
| 相关 package `pnpm exec tsc -b ... --pretty false` | 通过 |
| Controller / Scope Provider / UI 聚焦测试 | 8 文件、82 项通过；后续 schema 组合调整的 3 项另行通过 |
| Web replay：Security Research + Native Browser | 2 文件、10 项通过 |
| 最终 Web Security Research replay，web-delivery.log | 5 项通过，覆盖三格式真实下载字节与重启 |
| scoped oxlint，lint-delivery.log | 通过 |
| 双语文档 7 个命名配对 | 通过 |
| `pnpm run hygiene` | 首次 15/16；失败为两个 README 缺少 invariant 省略理由。补充后单独 `verify-package-invariants` 通过，没有将首次 aggregate 说成全绿 |
| `pnpm run test:gui` | 5648 通过、7 跳过、1 超时；超时为 better-sidebar 的真实 Git log 分页，5 秒用例预算。原命令单独复验通过，未改测试或宣称解决并发超时 |
| `pnpm run doc-sync` | 24/34，未通过；包含类型归属、JSDoc、生成目录与 docs/dev 双语/换行问题。新增 Provider 的 schema alias 静态解析问题已修正，config-catalog 仍受其他 5 处 JSDoc 阻塞 |
| `pnpm run lint:contracts-ready` | 未通过；全库诊断保留在 lint-repository.log，未扩大本批修复范围 |

Web 场景运行真实可选 bundle、Remote 和本地 Provider；未调用真实模型。新增 ARIA 期望在 `apps/web/tests/expected/device-capabilities/security.expected.md`。1680、1000、600px 检查表单内容宽度；未执行 macOS/Linux 或真实移动设备验收。

## 本次续批：统一工具授权

本批新增可选 assessment-scope-tool-policy Consumer，在 tools/pre-execute 对默认 bash、pwsh、web_search、web_fetch 与 Browser 工具执行授权，并以 ctx.tools.guard() 防止前置 listener 绕过拒绝。URL 效果要求目标与精确出口；Shell 使用显式 target_id 或唯一目标。finding_export 现在使用相同 report-download 决策，逐目标授权并在发布 Artifact 前完成 Session flush。

验证：相关 scope/controller/UI/package 测试 85 项通过，Web Security Research 与 Native Browser 回归 11 项通过，最终 build、constraints、verify-package-dependencies、verify-config-catalog --check、verify-package-invariants 与 scoped oxlint 通过。全量 doc-sync 与全库 lint 仍受既有债务阻塞。

## 暂存副本误删与恢复

本会话误删 `D:\Company\cinlan\cinlan-harness\exports\migration-staging\2026-09-13`。这不是迁移验收允许的清理，也不作为文档检查改进。

从历史会话恢复了原暂存操作的 32 个路径，并从三个保留的旧项目目录复制 771 个候选源码文件到 `D:\Company\cinlan\cinlan-harness\.artifacts\migration-staging-recovery-20260913`，核对了源与恢复文件 SHA-256。来源及哈希见 [恢复清单](staging-recovery-20260913.json)。node_modules、lib、dist 和链接未重建。缺少删除前完整哈希清单，所以不能声称与误删暂存副本逐字节一致，原 exports 路径也未伪装为原样恢复。

三个旧目录已确认存在，未删除：

- `D:\Company\cinlan\cinlan-harness-integration`
- `D:\Company\cinlan\cinlan-harness-integration-20260909`
- `D:\Company\cinlan\cinlan-harness-staged-final-b84814d3`

## 剩余工作

1. 默认 shell、network 和 Browser 模型工具已接入可选 assessment-scope-tool-policy；finding_export 统一要求 report-download。未列入默认集合的自定义 Consumers、任意命令文本中的目标推断，以及高级 egress/credential 配置仍需单独覆盖。本批不能代表所有效果已全局隔离。
2. 安全高级出口/凭证引用专用编辑、Finding 状态管理 UI、Skill 安装更新与真实工具就绪。
3. Windows/Android/iOS 原生设备 Provider；Design Studio、Voice、SSH、TUI；完整 Browser profile 管理及持久历史。
4. 完整 doc-sync、全库 lint、模型对话录制、跨平台与发布验收。

未 push、tag、release。新增 Agent Note 记录 scope/报告的决策；可复用经验先写入 runtime reverse-skill KB。项目没有 KB 镜像目录，未新增第二来源。
