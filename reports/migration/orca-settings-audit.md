# Orca Settings 功能审查与原生迁移对账

审查日期：2026-09-13。参考目录：D:\Company\cinlan\orca；目标目录：D:\Company\cinlan\cinlan-harness。Orca 只读，不作为运行依赖，也不从其用户目录导入账户、Cookie 或私有配置。

## 审查范围与证据等级

本表覆盖 Orca Settings 的全部 32 个固定导航项和项目动态导航入口；重点追踪 Browser、Mobile Emulator、Computer Use、Security Research 的设置和后端实现。未逐行审计 Orca 全部业务逻辑，也没有在其 UI 中逐项操作。除本轮列出的测试证据外，“已有”只说明已读源码存在，不表示端到端验收通过。

导航来源：`D:\Company\cinlan\orca\src\renderer\src\hooks\useSettingsNavigationMetadata.ts`，SHA-256：c4f669895b355714565e0cc1190f94954d1d59737b8a850031f3f8e4d22a9554。Desktop、macOS 和 dev 标记控制可见性，项目列表另外动态生成。

**判定口径**：原生并验证／部分原生／只有界面或配置／仍依赖 Orca／未接入或未实现。暂存目录中的代码不属于已接入工作区；历史包名清单不证明功能等价。

## 导航级全量对照

下表目标 owner 路径以本项目 packages/ 为根；暂存区明确例外。原生与待补内容分开列出，不使用统一的“已迁移”标记。

| Orca id | Settings 功能 | 本项目 owner | 当前状态 | 验收要求 |
|---|---|---|---|---|
| agents | Agent 默认值、命令与运行环境 | preset/agent-presets、ui-agent-preset | 部分原生；预设管理已有，不等于外部 Agent 账户/运行环境管理 | 预设创建、选择、默认值、重启和撤回 |
| accounts | AI Provider Accounts 切换与用量 | llm、credentials、ui-settings-models | 部分原生；已有模型/凭证，不等同 Orca 账户池与用量管理 | 逐 Provider 验证切换、凭证隔离与计量 |
| orchestration | 多 Agent 编排 | coordination、workflow、subagent | 部分原生；无等价 Settings 管理面板 | 编排、取消、失败恢复与输出归属 |
| security-research | 安全工作流 Skill 安装、更新、freshness | security、bundle/security-research、api/security-research-controller、ui-settings-security | 部分原生；本轮补证据持久化与状态转换验证；授权执行接入/管理 UI 待补 | 见下方安全研究缺口 |
| computer-use | 桌面应用、窗口、观察与输入 | computer-use/computer-use-cinlan | 仍依赖 Orca；不是原生迁移 | Windows UIA/截图/输入闭环；macOS/Linux 各自平台验证 |
| voice | 麦克风、听写、模型下载/选择 | 保留旧目录及 .artifacts/migration-staging-recovery-20260913 | 未接入；不是可用工作区包 | 麦克风权限、模型校验、录音转写、取消、模型卸载 |
| orca-account | 账户与移动/远程共享 | 无对应产品账户服务 | 未实现；不移植 Orca 账户或云端依赖 | 独立身份体系明确后再设计 |
| setup-guide | 初始化检查表 | ui-settings-models/onboarding | 部分原生；只有模型初始化相关流程 | 安装状态与动作结果真实关联 |
| general | 工作区默认项和维护 | ui-settings-general、settings-file | 部分原生；非逐字段等价 | 字段保存、验证、重启生效时机 |
| integrations | GitHub/GitLab/Gitee 集成 | webhook/webhook-github；原生 Work Items 可选 profile | 部分原生；webhook 不是账户/任务集成 | 认证、权限、失败和解除关联 |
| mobile | 手机配对与远程连接 | 无对应移动客户端/配对服务 | 未实现；与手机模拟器严格区分 | 配对、撤销、连接重试和会话隔离 |
| automations | 定时 Agent 作业与可见性 | schedule、goal、ui-schedule | 部分原生；Session schedule 不等于全局作业系统 | 持久调度、时区、重启、不重复执行 |
| artifacts | HTML/Markdown 团队共享与链接 | artifact、attachment、ui-deliverables | 部分原生；本地保存不等于公开共享 | 完整性、权限、重启；外发另行授权 |
| git | 分支、base ref、归属与 Git AI | git、workspace-isolation、worktree-task、ui-better-sidebar | 部分原生；设置与托管平台动作不等价 | 工作区隔离、提交/撤回与失败恢复 |
| tasks | 任务来源、默认来源、可见性 | packages/work-items、api/work-items-controller、client/ui-work-items、cinlan-work-items bundle | 已原生接入可选 work-items profile；配置 UI、真实账户与模型对话录制仍待补 | Web 列表/详情、本地关联、重启、默认拒绝写入已验证；见后续报告 |
| terminal | Shell、终端呈现与会话 | shell、subprocess、ui-better-sidebar | 部分原生；保留现有 PTY，不迁入第二套默认终端 | PTY 启动/输入/重连/释放及凭证环境清理 |
| quick-commands | 全局/项目保存的终端命令 | interaction/commands | 未实现等价保存界面；Agent commands 不是用户命令库 | 保存、项目隔离与显式执行 |
| browser | 主页、搜索、缩放、路由、Cookie profiles、Agent Browser Use | browser/browser-playwright、bundle/cinlan-browser、ui-settings-security | 原生主页/搜索、Cookie JSON、文件传输与页面内记录已验证；完整 profile 管理仍未完成 | 设置持久化→重启→真实浏览器工具；Cookie/文件/网络能力另验 |
| mobile-emulator | 启用、可用性、Android SDK 路径、默认设备、Agent 控制 | mobile-device/mobile-device-cinlan | 仍依赖 Orca；SDK/默认设备只有说明 | 直接 ADB/AVD、simctl 实现；设置→Host→设备动作 |
| floating-workspace | 浮动终端/浏览器/Markdown tabs | ui-better-sidebar | 部分原生；内嵌 tabs 不等于系统级浮动窗口 | 布局恢复、资源释放、键盘操作 |
| appearance | 主题、缩放、侧栏、状态栏 | ui-theme、locale、ui-layout、ui-better-sidebar | 部分原生；已有主题/字号/侧栏 | 明暗主题、断点、键盘与持久化 |
| input | 输入与编辑行为 | ui-conversation、ui-chat | 部分原生；Enter/转录设置已有 | IME、提交行为、选择/编辑与恢复 |
| notifications | 原生通知与声音 | 未发现等价 Settings owner | 未实现等价功能 | 权限、去重、敏感信息最小化 |
| shortcuts | 快捷键绑定管理 | ui-commands、ui-better-sidebar 现有快捷操作 | 部分原生；无完整快捷键编辑器 | 冲突检测、保存、恢复默认 |
| stats | 产品与各 Agent 使用统计 | session-stats、session-telemetry、token-meter | 部分原生；计量不等于 Orca 多账户统计 | 来源、汇总和重启一致性 |
| ssh | 主机配置导入/保存/连接/测试 | execution-host-ssh 仅暂存 | 未接入；现有 executionHost 仅身份信息 | SSH identity→FS/subprocess/Git 同一执行环境 |
| servers | 远程运行时配对 | sdk、api/gateway、client/connection | 部分原生；RPC 不等于配对产品流程 | 认证、撤销、版本一致与重连 |
| developer-permissions | macOS 开发工具隐私权限 | 未发现等价原生权限服务 | 未实现；本机 Windows 无法完成 macOS 验收 | 真实 macOS Accessibility/ScreenCapture/TCC |
| advanced | 低层兼容性排错 | 现有插件 Config | 部分原生；不照搬另一个系统的开关 | 逐设置说明适用平台与作用点 |
| dev | 仅开发构建的调试界面 | experimental/inspector | 部分原生；不是同一工具集合 | 开发/生产隔离，避免默认暴露 |
| experimental | 实验功能开关 | experimental 插件组 | 部分原生；独立 opt-in，不迁移无 owner 开关 | 启用/卸载、失败恢复 |
| plugins | 安装、市场、授权预览、更新、回滚 | dsh plugin、ui-settings-plugins、plugin-inventory | 部分原生；npm/file 组合已有，GitHub marketplace 未闭环 | 校验、依赖安装、撤销/回滚与断电恢复 |

**项目动态设置**：Orca 为 project/repository 的多 Host setup 合并导航；Harness 已有 workspace registry、worktree task 与 isolation，不等于同一套项目设置。需逐项核对 Git hooks、runtime、base ref 与路径覆盖，而不是直接搬运 Orca Store。

**设计与 TUI**：当前 Orca 固定导航中没有独立 Design Studio 或 TUI 项。不能由旧截图推定当前 Orca 内置同名 Service。Harness 的 Design 页面仍是说明；Design Studio、Voice、SSH、TUI 候选仍在暂存区。Work Items 的原生接入、验证和限制见 [后续报告](native-work-items-continuation-20260913.md)。本轮不覆盖已存在的 cinlan-design Skill。

## 重点实现链路

### Browser

Orca 证据：`D:\Company\cinlan\orca\src\renderer\src\components\settings\BrowserPane.tsx`、`D:\Company\cinlan\orca\src\renderer\src\components\settings\BrowserUsePane.tsx`、`D:\Company\cinlan\orca\src\renderer\src\components\settings\BrowserSessionCookiesSection.tsx`。包括默认 URL、搜索引擎、缩放、链接路由、终端链接动作、会话 profile/host、Cookie 导入，以及 CLI/Skill 就绪步骤。其 CLI 步骤不应照搬为 Harness 前提。

Harness 原生链路：[Settings 注册](../../packages/client/ui-settings-security/src/client/index.ts) → settingsScope/SettingsController → settings-file → browser-playwright 的 browser-playwright 命名空间 → [自有 Provider](../../packages/browser/browser-playwright/src/index.ts) → tool-browser → 真实本地 Chromium。browserChannel、headless、viewportWidth、viewportHeight 保存并在重启后生效。部署专用 executablePath/storageDir 不通过此偏好表单变更。

本轮默认 [cinlan-browser bundle](../../packages/bundle/cinlan-browser/cordis.patch.yml) 选择 local/Playwright，不再挂载 browser-cinlan。旧适配器包仍在树中，未删；它不是本轮原生验收证据。原生主页/搜索、Cookie JSON 导入、上传下载、页面内访问记录及网络 metadata 已在 [Browser 续批](native-browser-operations-20260913.md) 验证。仍缺其他浏览器数据库直接导入、持久化浏览历史、profile 清单/重命名/删除、逐 Tab profile 切换、文本输入与滚动。侧栏 iframe 浏览器与 Agent Playwright 浏览器仍为不同 owner，不声称共享登录或页面。

### Computer Use

Orca 原生参考：`D:\Company\cinlan\orca\native\computer-use-windows\runtime.ps1`、`D:\Company\cinlan\orca\native\computer-use-linux\runtime.py`、macOS Swift package。Harness 已有 Service/Tool/Permission/过期观察保护，但 computer-use-cinlan 仍启动 orca 或 orca-ide。后续需独立 Windows Provider 和打包 runtime，再接权限检查与真实输入；macOS/Linux 必须各自验收，不以 Windows 成功替代。

### Mobile Emulator

Orca 证据：`D:\Company\cinlan\orca\src\renderer\src\components\settings\MobileEmulatorSettingsPane.tsx`、src/main/emulator/android 的 SDK discovery、device inventory、AVD boot、input commands、scrcpy 和 iOS backend。Settings 实际包含 enable、availability、androidSdkPath、mobileEmulatorDefaultDeviceUdid、Agent 控制配置。

Harness mobile-device-cinlan 仍是 CLI 包装。SDK 路径/默认设备没有持久化操作，AVD 创建/启停、simctl、应用安装启动、权限、日志与流式画面未接入。原生迁移应复用现有 Service/Policy/Tool，新增直接 ADB/AVD 与 simctl Provider，而不是更换命令显示名称。Mobile 远程配对不属于这项能力。

### Security Research

Orca 证据：`D:\Company\cinlan\orca\src\renderer\src\components\settings\SecurityResearchPane.tsx`、`D:\Company\cinlan\orca\src\renderer\src\components\settings\AgentSkillSetupPanel.tsx`。参考价值是 Skill 安装/更新/复查、freshness 和错误反馈，不等于 Findings 或授权管理后端。Harness 应优先复用自己的 assessment-scope、finding-session、artifact-local、vuln-kb 与 Skills。

本轮将 [security-research bundle](../../packages/bundle/security-research/cordis.patch.yml) 的内存 Artifact Provider 切换为已有本地持久化 Provider；原内存字节在原进程退出后不可恢复，不宣称自动迁回。空 JSON/Markdown 报告采用 Unix epoch，避免随时钟改变字节。

仍须完成：

1. **授权执行 P0**：assessment-scope-session 提供 authorize，但通用 shell、浏览器和网络路径没有全部消费它。空 grant 不等于所有工具被禁止，不能用提示词或状态卡代替强制执行。真实安全评估验收前必须覆盖同类执行路径与子 Agent 继承。
2. **权限配置 P1**：范围编辑/校验/持久化 UI 已接入独立 Settings Provider；既有 Session 绑定不覆盖、不扩大，高级 egress/凭证条目仍通过插件配置编辑。
3. **工具与 Skill P1**：Skill 目录可发现不代表其依赖的扫描器/MCP 已安装或可运行；安装、更新、校验与来源策略待补。
4. **Findings/报告 P1**：已有五种状态和 JSON/SARIF/Markdown exporter；Web 摘要、状态操作、受控下载及外发审批仍缺。artifact-local 保留标签不等于自动到期清理，也没有加密承诺。
5. **可选性 P1**：未挂载 bundle 时不贡献系统 preset，Settings 依据 roster 显示；bundle 内部分工具与提示词仍在 Host 全局作用域。后续需决定并验证普通 preset 与安全 preset 的隔离，不声称已经完成。

## 分批顺序与退出条件

- 第一批（本轮）：原生 Browser 组合、偏好持久化与真实浏览器工具验证；安全证据持久化、状态前置条件及报告字节验证。
- 第二批：Windows 原生 Computer Use 与 Android 原生 ADB/SDK/默认设备；分别补 Loader、权限、取消、截图及真实设备用例；macOS/iOS/Linux 条件能力单独标记。
- 第三批：安全授权执行全路径、scope 管理、Findings/报告 UI 和 Skill 安装更新，保留插件安装/卸载对称性。
- 第四批：Work Items → Design Studio → Voice → SSH → TUI；每族先对照当前公共接口再接 profile，不从暂存区批量复制后宣告完成。
- 第五批：GitHub 分发校验、依赖闭包、安装更新/回滚、跨平台打包和旧目录删除验收。

## 本轮验证

- 构建：pnpm run build 通过；生成 246 个 Client artifact。
- 发布与类型检查：pnpm run hygiene 的 16 项全部通过，包含 NodeNext（335 个包）、built invariant（41 个 companion）、constraints、publint、入口分类与 i18n。该结果不是 GitHub/npm 发布或完整安装验收。
- 聚焦单元与 Loader：14 个文件，191 项通过，1 项跳过。
- Web refresh/replay：3 个文件，8 项通过。浏览器保存偏好后跨 Host 重启保留；原生 Chromium 工具点击与 PNG 920×640 尺寸匹配；安全五种状态、无证据晋级拒绝、三个报告格式和 Artifact Provider 重建读取通过。
- 窄屏截图需等候真实控件 hit-test 就绪，不能只凭 scrollWidth 或动画中截图判断成功。1680/1000/600px 场景未发现内容横向溢出，600px 实测输入控件可命中。
- 全量 doc-sync 与 lint 未通过，剩余包括 Typert analyzer 的 members is not iterable、生成目录陈旧，以及 docs/dev 和暂存副本的文档/代码规范债务。本轮不自动修复无关文件；具体见 doc-sync-final.log 与 lint-all-final.log。
- 没有调用真实模型、没有输入操作系统桌面或手机设备，也没有发布包。
- 四个独立安全小 bundle 已改为真实 insert patch 并纳入源码构建；不再依赖手工 lib 占位。设计候选仍未接入，额外检查副本保留于 .artifacts/native-migration-20260913/unadapted-design-copy。

## 删除决定

sourceDeletionAllowed: false。保留 D:\Company\cinlan\cinlan-harness-integration、D:\Company\cinlan\cinlan-harness-integration-20260909、D:\Company\cinlan\cinlan-harness-staged-final-b84814d3。本轮不删除暂存候选、旧目录或未确认等价的原实现。

## 本次接续

2026-09-13 新增范围编辑与 report-download 权限下的三格式报告下载，详见本轮安全范围与报告验收记录。此许可不等于任意外发，也没有覆盖 finding_export 或全部 shell/network 路径。接续时误删了 exports/migration-staging/2026-09-13；已从三个保留源恢复 32 组、771 个候选源码文件到 .artifacts/migration-staging-recovery-20260913，哈希清单见 staging-recovery-20260913.json；没有删除前清单，不宣称完全一致。
