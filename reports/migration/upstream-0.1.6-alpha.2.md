# 官方 0.1.6-alpha.2 选择性集成记录

状态：选择性集成及相关本地验收完成，可审阅。Settings 和 Desktop 的保护路径保持原样；新增功能已经通过对应行为、构建和真实界面验证。下列基线失败、平台差异及未执行项不计为通过；没有提交、推送或发布。

## 固定版本与交付位置

- 本地基线：`763766ee8a8b076125b287464e1ef84c4a7f5222`。
- 官方目标：[dsh-v0.1.6-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2)，`ddefc45fbc7f8e46dd73185e68295696d1297887`。
- 共同祖先：`5dda764ed3aa172535a7967b06ff95d9cbfe536a`。
- 工作树：`D:/Company/cinlan/cinlan-harness-upstream-016`；分支：`sync/upstream-dsh-v0.1.6-alpha.2`；回滚引用：`backup/settings-native-763766ee8a`。
- 原工作树未写入，仍在 `fix/settings-native-acceptance`；原有未跟踪目录 `apps/desktop/coverage-floating/` 保留。包版本维持本地 `0.1.5-alpha.1`，不把选择性集成标成完整官方版本。

## 保留的产品行为

Settings 保留全页外壳、280px 分组导航、64px 顶栏、约 960px 内容区、1000/700px 响应断点、搜索、既有 CSS 和主题令牌；新增功能使用现有控件。`SettingsScope.mutate(): Promise<boolean>` 与 Host 接受后才保存成功的语义不变，不恢复已移除的 Design Studio 页面。

Desktop 保留 `dsh-app://`、framed pipes、启动页、运行时事务恢复、私有 pnpm/store、PID 所有权和更新路径。运行时插件管理的执行层拒绝 Desktop 写操作，返回 `management-required`。Web 管理器仅在存在真实 `ProfileContext` 时启用。

better-sidebar 的 `registerTab/openTab/updateTab/openFile` 接口不变；文件审阅和计划预览通过这些接口打开。官方 sidebar-right 仅作为可选适配。`conversation.chat.turnTail` 保持 chain/session；新增 `turnCards` 为 list/session，避免替换既有文件链接拦截器。

## 来源及适配

| 功能 | 官方来源 | 本地结果 |
|---|---|---|
| MCP 循环游标 | `594305ce19` | 每次同步拒绝重复的非空游标，保留 descriptors、取消和提交检查 |
| 子代理结束通知 | `29debb8b24` | 通知只转发非空文本；完整输出仍保留在子会话与前台结果 |
| 重复申请有效沙箱模式 | `61c548e200` | 已生效模式无需重复批准；真正权限扩大仍审批 |
| Fork 截断 | `973bea8204` | 从选定 turn/end 截断，保留本地 worktree/task 行为 |
| Messages 与 pi-ai 图像能力 | `7485d75e38`、`5ca77db865`、pi-ai 导入优化 `75a56be10c` 及目标标签修复 | 可选 Messages，保留 Chat Completions 默认、网关与用户模型；图像卸载只影响请求 |
| 子代理数量和深度设置 | `98ebcccf9e`、`cf06315851` | 并发默认 8，保留本地深度默认 3；显式配置优先；沿用本地设置卡片 |
| 运行时插件管理 | 目标标签 `packages/boot/plugin-manager`（含 `470d4aae11`、`9a83772560` 的权限修复） | 在既有 Plugins 页面增加管理标签；真实 profile 支持安装、批准构建脚本、启停与卸载；非管理环境显示本地化不可用提示 |
| 回合文件改动与 Diff | `b784e586ef`、`8225e18d70` | workspace/changes 只记录 turn，通过已认证 Connection Fetch 读取摘要和文件对比；优先 better-sidebar |
| 提交计划预览 | `3958f801e3` | 计划摘要、审阅动作与 Session 中记录的 callId 对应；通过本地侧栏查看正文 |

Session 格式保持 3。`workspace/changes` 为 required-on-read 事件，已加入生成的已知事件清单；没有修改已发布的 JSONL 代际文件。

## 本地兼容修正

- Host/Client 分面项目引用、Remote 生成声明、源码类型别名与汇总类型同步。交付物 Host 测试归入 `*.host.spec.ts`，防止两套 connection 声明混入 Client。
- 本地 Cordis 使用数组依赖声明；管理页通过 `ctx.inject` 跟随可选 remote 生命周期。侧栏服务也按可选消费者注册。
- 保留本地 Loader 事务回滚：新插件激活或导入失败时回滚新增运行时行，保留磁盘选择供修正后重试。相关测试使用独立服务名，并把保留的 pending 行与回滚的失败行分开验证。
- 安装脚本批准测试声明 pnpm 11.7.0，避免读取主机 PATH 上行为不同的 pnpm 10 或其他应用的私有依赖。
- 真实启动发现已有 voice-controller 生成的 Host/Remote 代码使用 zod 却未声明依赖；补齐运行依赖并重打包 Remote，修复 Host 加载和浏览器模块表中的未解析引用。
- SDK replay 在 Windows 把 cwd 原样写入 JSONL，导致非法反斜杠和整个 Loader 回滚；夹具路径替换改为 JSON 字符串转义，并把测试专用 llm-replay 链接到隔离 profile。父子代理场景现在可以完成，持久化会话一致；工具清单仍有 Bash/Pwsh 平台差异。
- 计划审阅 ARIA 预期明确更新为摘要、侧栏全文入口和批准后的持久卡片；浏览器额外验证了正文和批准链路。三个 expected Markdown 有变化，Session JSONL 未改变。
- profile watcher 在全部 exact-path 监听就绪后等待首次串行刷新，覆盖 boot 已应用配置与订阅建立之间的文件修改/删除。两个确定性测试在修复前失败、修复后通过；没有增加延时或放宽 CLI 预期。

## 已执行验证

| 验证 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile --offline --ignore-scripts` | 最终依赖变更后通过，397 个项目，pnpm 11.7.0 |
| `pnpm run build` | 通过（native、Host、Client、Web）；最终侧栏适配后的 `build:lib:client` 与 Host 类型检查也通过 |
| `pnpm run build:desktop` | 通过 |
| 核心修复 13 个测试文件 | 470 项通过 |
| LLM 兼容 20 个测试文件 | 604 项通过 |
| 管理页、计划、问题、交付物、Chat、模型能力 20 个文件 | 279 项通过；最后 7 个文件的侧栏兼容回归 65 项也通过 |
| 插件设置、模型选择、输入栏、Session 读取 13 个文件 | 315 项通过 |
| Host 插件管理器 | 46 项通过，包括 Desktop 拒绝、真实脚本批准、回滚和 watcher；最后与 6 项 profile 测试一起复跑 52 项通过 |
| workspace-changes | 43 项通过，1 项 Windows 权限场景跳过 |
| scaffold/profile-configuration | 最终共 10 项通过；另有真实 Host 的 scaffold 隔离用例 1 项通过 |
| 子代理 limits-composition | 3 项通过（真实 Loader） |
| 依赖声明、Cordis 配置、runtime closure、tsconfig paths | 通过 |
| Web Settings | 13 项通过；搜索、窄屏导航、权限、主题、字号、语言与持久化；原样式预期未刷新 |
| Web 原生浏览器设置 | 5 项通过，包括真实 Chromium、上传下载和隔离 profile |
| Web 插件管理 | 3 项通过，包括真实 live/startup profile、启停效果及外部 patch 监听；最后 watcher 修复后 live 用例再次通过 |
| Web 计划审阅 | 2 项通过；明确更新 ARIA 预期后用 replay 无写入复核通过 |
| Desktop Settings | 真实 Electron 验收通过；280px 导航、64px 顶栏、搜索、中文/英文、关闭/焦点恢复、持久化和进程清理 |
| 构建产物 | 43 个 companion 的 plain-Node Loader 校验通过；72 个 Client 包装配规则通过；Remote 与 SDK built e2e 各 1 项通过 |
| scoped lint | 212 个变更 TS 文件 + 最后 2 个回放用例通过，0 错误/警告 |
| 文档 | 413 个类型块及对应中文、17 个具名双语对（两组）、20 份文档链接/换行、29 项生成器测试、相关目录新鲜度通过 |
| `pnpm run website:build` | 最终文档通过构建，2923 个 fragment 引用全部解析 |
| `git diff --check` 与保护路径 diff | 通过；Settings shell/theme/save、better-sidebar、Desktop transport 源码无改动 |

核心和 LLM 的精确命令与 JSON 结果在 `.artifacts/upstream-0.1.6-alpha.2/run-logs/verification-a2a103/evidence.json`、`core/results.json`、`llm/results.json`。父代理命令与结果在 `.artifacts/upstream-0.1.6-alpha.2/verification.json`，界面证据在同目录 `ui-verification.json`，文档明细在 `run-logs/verification-a2a103/docs-evidence.json`。历史命令中的 `.tmp/` 已整体移到此处 `run-logs/` 保存；日志不混入可提交源码。测试采用相关文件过滤器，未执行全仓覆盖率或真实 API 消费。

## 验证限制与仓库基线问题

真实 Settings、管理页、计划审阅与 Desktop 验收已通过。先前发现的 YAML 表达式、zod 运行依赖及交付物强制依赖官方侧栏问题均已修复后重验。

CLI built-bin 28 项首次运行：22 通过、1 平台跳过、5 失败；其中 3 项的实际帮助输出成功，但 Node SQLite 实验提示破坏了 stderr 为空的断言；已用原工作树构建在隔离 DSH_HOME 中运行帮助命令复现同一提示，另外 2 项定位到热重载启动窗口：首次缓存读取到未应用的修改，初始 watcher 事件因内容相同被略过。修正为先建立所有监听，再等待首次串行刷新；两个确定性测试先红后绿，原来的两个 CLI 用例使用 `--retry=0` 复跑通过，真实 Web live 管理用例也复验通过。CLI 仍有上述 3 项基线提示断言失败，未全项标绿。

全仓 `lint:contracts-ready`、`doc-sync` 和 `verify-client-ui-i18n` 未通过；本次变更范围 lint 与相关文档检查通过。保留的基线问题包括 config generator 25 条声明违规（9 个未改动的源文件）、全局图中 36 个既有服务缺少角色映射、旧 voice README/Agent Note 格式、既有文档换行，以及 ui-settings-security 中 5 个既有硬编码标题。所有新增服务已补角色，未禁用规则或放宽全局类型设置。

SDK `subagent-continuable through` 的父子代理执行和持久化 Session 一致性通过，随后在工具清单比较失败：夹具预期 bash，Windows 提供 pwsh；后续 wire/UI 断言未到达，不计整个 replay 通过。Windows 不运行仓库排除的 POSIX Bash 测试；共享沙箱判断已通过。两项仍需 Linux/macOS CI；真实 API Messages e2e 未执行。

## 复验入口与界面证据

以下命令在独立工作树根目录运行，Web/SDK replay 先设置 PowerShell 环境变量 `$env:DSH_SNAPSHOT = 'replay'`：

```powershell
pnpm install --frozen-lockfile --offline --ignore-scripts
pnpm run build
pnpm run build:desktop
node apps/desktop/tests/settings.integration.mjs
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/settings-chrome.e2e.ts apps/web/tests/native-browser-settings.e2e.ts apps/web/tests/plan-review.e2e.ts apps/web/tests/plugin-manager.e2e.ts --maxWorkers=1
pnpm exec vitest run packages/boot/plugin-manager/tests/manager.spec.ts packages/boot/app-boot/tests/profile-configuration.spec.ts --maxWorkers=2
pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/sdk/sdk.snapshot.ts -t 'subagent-continuable through' --maxWorkers=1
pnpm run verify-built-package-invariants
pnpm run verify-client-packages
pnpm run website:build
```

SDK 命令在 Windows 预期仍会显示本文已记录的 bash/pwsh 工具清单差异；复验不要自动刷新会话或工具 schema 夹具。上面的命令块是复验入口，实际执行的分组、结果和首次失败见证据文件及本报告验证表。

已查看截图：`.artifacts/desktop-settings-Zrd0sf/settings-zh.png`、同目录 `settings-en.png` 与 `.artifacts/web-e2e-plugin-manager-management.png`。Desktop 结构与清理详情在同目录 `report.json`。

## 明确暂缓

官方 Office、内嵌浏览器与侧边对话和本地插件能力重叠，不重复挂载同类面板。官方薄 Web Desktop、全局运行时解析改造、协议默认切换、深度默认 1 和持久图像代际迁移均未采用；这些变化需要单独评估本地产品与数据兼容性。
