# staged-final-b84814d3 → main 完整同步清单

> 分析对象：staged-final-b84814d3 相对于 cinlan-harness (main) 的全部差异
> 日期：2026-09-09
> 已分析项见：`security-modules-analysis.md`、`settings-ui-analysis.md`、`browser-device-control-analysis.md`

## 总览

staged-final-b84814d3（0.1.0-rc.8）比 main（0.1.5-alpha.1）多出 **11 个顶层包组**、**6 个 client 包**、**12 个 bundle 包**、**2 个 api 包**，以及若干散落在共享组中的包。main 也有 staged-final 没有的新功能。

---

## 一、已分析的同步项

| 类别 | 文档 | 状态 |
|------|------|------|
| 安全研发（security-skills/finding/vuln-kb/assessment-scope/security-workflow） | `security-modules-analysis.md` | ✅ 已分析 |
| 设置 UI（全页面模式 + ui-settings-cinlan-capabilities） | `settings-ui-analysis.md` | ✅ 已分析 |
| 浏览器/桌面/移动设备控制（browser/computer-use/mobile-device） | `browser-device-control-analysis.md` | ✅ 已分析 |

---

## 二、待同步的顶层包组

### 1. Artifact（产物管理）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `artifact/artifact` | Service Definition (`ctx.artifact`) | 5 文件, 10.8KB |
| `artifact/artifact-local` | 本地文件系统 Provider | 3 文件, 25KB |

产物管理能力：模型工具产出物的持久化和检索。

### 2. Coordination（任务协调）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `coordination/coordination` | Service Definition (`ctx.coordination`) | 4 文件, 14KB |
| `coordination/coordination-local` | 本地执行器 | 2 文件, 32.7KB |
| `coordination/coordination-subagent-executor` | 子代理执行器 | 2 文件, 9.7KB |
| `coordination/tool-coordination` | 模型工具 | 2 文件, 19.9KB |

任务协调能力：跨工具的异步任务编排，支持子代理执行器。integration 的 `tool-browser-element-capture` 依赖此能力。

### 3. Design Studio（设计工作室）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `design/design-studio` | Service Definition | 3 文件, 11KB |
| `design/design-studio-local` | 本地 Provider | 2 文件, 11.4KB |
| `design/design-studio-prompt` | 系统提示词 | 2 文件, 4.5KB |
| `design/tool-design-studio` | 模型工具 | 2 文件, 10.4KB |

设计工作室能力：UI 设计和原型生成。对应设置页面的 `design` 能力（matcher: `/design-studio|cinlan-design/i`）。

### 4. Execution Host（远程执行主机）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `execution-host/execution-host` | Service Definition | 3 文件, 18KB |
| `execution-host/execution-host-bind` | 绑定层 | 2 文件, 17.7KB |
| `execution-host/execution-host-local` | 本地执行 | 2 文件, 8.2KB |
| `execution-host/execution-host-ssh` | SSH 远程执行 | 9 文件, 128.3KB |

远程执行主机能力：通过 SSH 在远程机器上执行命令。SSH 包是最大的单个包（128KB）。

### 5. Git（版本控制操作）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `git/git` | Service Definition (`ctx.git`) | 3 文件, 5.2KB |
| `git/git-local` | 本地 git Provider | 2 文件, 16.5KB |
| `git/tool-git` | 模型工具 | 2 文件, 9.5KB |

Git 操作能力：模型可通过工具执行 git 命令。

### 6. Voice（语音识别）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `voice/voice` | Service Definition (`ctx.voice`) | 3 文件, 8.2KB |
| `voice/voice-sherpa-onnx` | Sherpa-ONNX Provider | 9 文件, 50.2KB |

语音识别能力：基于 sherpa-onnx 的本地语音转文字。

### 7. Examples（示例应用）

| 包 | 说明 | src 大小 |
|----|------|---------|
| `examples/acp-demo` | ACP 协议示例 | 3 文件, 9.7KB |
| `examples/agent-spine-demo` | Agent Spine 示例 | 2 文件, 15.2KB |
| `examples/jsonrpc-demo` | JSON-RPC 示例 | 5 文件, 4.2KB |

示例应用：开发参考用，非生产包。

---

## 三、待同步的 client 包

| 包 | 说明 |
|----|------|
| `client/runtime` | 运行时客户端 |
| `client/ui-better-sidebar` | 改进版侧边栏 |
| `client/ui-brand-cinlan` | Cinlan 品牌 UI |
| `client/ui-design-studio` | 设计工作室 UI |
| `client/ui-voice-dictation` | 语音听写 UI |

---

## 四、待同步的 bundle 包

| 包 | 说明 | 已分析 |
|----|------|--------|
| `cinlan-browser` | 浏览器能力 bundle | ✅ |
| `cinlan-computer-use` | 桌面控制 bundle | ✅ |
| `cinlan-mobile-device` | 移动设备 bundle | ✅ |
| `security-findings` | 安全发现 bundle | ✅ |
| `security-skills` | 安全技能 bundle | ✅ |
| `security-workflow` | 安全工作流 bundle | ✅ |
| `vuln-kb` | 漏洞知识库 bundle | ✅ |
| `cinlan-codex-tui` | Codex TUI bundle | ❌ |
| `cinlan-tui` | TUI bundle | ❌ |
| `cinlan-web` | Web bundle | ❌ |
| `design-studio` | 设计工作室 bundle | ❌ |
| `execution-host-ssh` | SSH 执行主机 bundle | ❌ |

---

## 五、待同步的 API 包

| 包 | 说明 |
|----|------|
| `api/codex-app-server` | Codex 应用服务器 |
| `api/codex-app-server-harness` | Codex 应用服务器 harness 适配 |

main 用 `api/session-controller`、`api/settings-controller`、`api/workspace-controller`、`api/workspace-files` 替代了这些。

---

## 六、共享组中的差异包

### 仅 staged-final 有

| 组 | 包 | 说明 |
|----|-----|------|
| `code-runtime` | `code-runtime-python` | Python 代码运行时（main 放在 `experimental/` 下） |
| `guard` | `turn-budget-policy` | 轮次预算策略 |
| `host` | `apiproxy` | API 代理 |
| `interaction` | `codex-tui` | Codex TUI 交互 |
| `interaction` | `tui` | TUI 交互 |
| `preset` | `agent-execution-guidance` | 代理执行引导 |
| `session` | `session-persistence-sqlite` | SQLite 会话持久化 |
| `subagent` | `tool-subagent-report` | 子代理报告工具 |
| `test-support` | `acp-snapshot` | ACP 快照测试 |
| `web` | `web-permission-policy` | Web 权限策略 |

### 仅 main 有

| 组 | 包 | 说明 |
|----|-----|------|
| `credentials` | `authorization` | 授权能力 |
| `experimental` | `agent-team` 等 9 个 | 代理团队、检查器、webworker 等 |
| `llm` | `deepseek-llm-api-extensions` | LLM API 扩展 |
| `llm` | `plugin-package-inventory-deepseek` | 插件清单 |
| `session` | `session-format` 等 7 个 | 会话格式迁移 |
| `subagent` | `subagent-claude-code`、`subagent-codex` | Claude/Codex 子代理 |
| `subprocess` | `win32-process` | Win32 进程 |
| `test-support` | `session-snapshot` | 会话快照测试 |
| `util` | `crypto`、`deque` 等 7 个 | 工具库扩展 |

---

## 七、Native / Apps 差异

| 目录 | staged-final | main |
|------|-------------|------|
| `native/desktop` | ✅ | ✅ |
| `native/landlock-run` | ✅ | ✅ |
| `native/desktop-host` | ❌ | ✅ |
| `native/system` | ❌ | ✅ |
| `apps/cli` | ✅ | ✅ |
| `apps/web` | ✅ | ✅ |

main 新增了 `native/desktop-host` 和 `native/system`（Landlock 启动器重构）。

---

## 八、根文件差异

### 仅 staged-final 有

| 文件 | 说明 |
|------|------|
| `knip.json` | 死代码检测配置 |
| `tsconfig.client.json~` | 客户端 tsconfig 备份 |
| `SAFETY.md` / `SAFETY.zh.md` / `SAFETY.i18n.yaml` | 安全说明文档 |

### 仅 main 有

| 文件 | 说明 |
|------|------|
| `vitest.bench.config.ts` | 基准测试配置 |
| `vitest.expected.config.ts` | 期望测试配置 |

---

## 九、文档差异

staged-final 有而 main 没有的文档（全部是新增能力的文档）：

- `docs/artifact.md` / `.zh.md` / `.i18n.yaml`
- `docs/browser.md` / `.zh.md` / `.i18n.yaml`
- `docs/computer-use.md` / `.zh.md` / `.i18n.yaml`
- `docs/coordination.md` / `.zh.md` / `.i18n.yaml`
- `docs/design.md` / `.zh.md` / `.i18n.yaml`
- `docs/execution-host.md` / `.zh.md` / `.i18n.yaml`
- `docs/git.md` / `.zh.md` / `.i18n.yaml`
- `docs/mobile-device.md` / `.zh.md` / `.i18n.yaml`
- `docs/security.md` / `.zh.md` / `.i18n.yaml`
- `docs/tui.md` / `.zh.md` / `.i18n.yaml`
- `docs/anti-trace-module.md` — 反追踪模块
- `docs/trace-risk-assessment.md` — 追踪风险评估
- `docs/opsec-guard.ps1` — OPSEC 守卫脚本
- `docs/AI-COMMON-PROMPT.full.en.md` / `.zh.md` — AI 通用提示词

main 有而 staged-final 没有的文档：
- `docs/agent-team.md` / `.zh.md` / `.i18n.yaml`
- `docs/webhook.md` / `.zh.md` / `.i18n.yaml`
- `docs/conversation.md` / `.zh.md` / `.i18n.yaml`
- `docs/slots.md` / `.zh.md` / `.i18n.yaml`
- `docs/todo.md` / `.zh.md` / `.i18n.yaml`
- `docs/web-client.md` / `.zh.md` / `.i18n.yaml`
- `docs/sidebar-right.md` / `.zh.md` / `.i18n.yaml`
- `docs/client-resources.md` / `.zh.md` / `.i18n.yaml`
- `docs/dynamic-cordis.md` / `.zh.md` / `.i18n.yaml`
- `docs/github-review.md` / `.zh.md` / `.i18n.yaml`
- `docs/mcp-memory.md` / `.zh.md` / `.i18n.yaml`
- `docs/network-proxy.md` / `.zh.md` / `.i18n.yaml`
- `docs/deepseek-llm-api-wire-extensions.md` / `.zh.md` / `.i18n.yaml`
- `docs/adding-a-remote-api.md` / `.zh.md` / `.i18n.yaml`
- `docs/adding-a-session-format-version.md` / `.zh.md` / `.i18n.yaml`

---

## 十、同步优先级建议

### P0 — 核心能力（影响产品功能）

| 项 | 包数 | 说明 |
|----|------|------|
| 安全研发 | 5 包 + 5 bundle | 安全工作流、漏洞知识库 |
| 浏览器/桌面/移动控制 | 12 包 + 3 bundle | 三大设备控制能力 |
| 设置 UI（全页面） | 3 包 | 非弹框设置 + Cinlan 能力页面 |

### P1 — 重要能力扩展

| 项 | 包数 | 说明 |
|----|------|------|
| Coordination | 4 包 | 任务协调，browser-element-capture 依赖 |
| Execution Host | 4 包 + 1 bundle | SSH 远程执行 |
| Git | 3 包 | 模型可执行 git 操作 |
| Artifact | 2 包 | 产物管理 |
| Voice | 2 包 | 语音识别 |
| Design Studio | 4 包 + 1 bundle | UI 设计工作室 |

### P2 — UI/UX 增强

| 项 | 包数 | 说明 |
|----|------|------|
| ui-better-sidebar | 1 包 | 改进版侧边栏 |
| ui-brand-cinlan | 1 包 | Cinlan 品牌 UI |
| ui-design-studio | 1 包 | 设计工作室 UI |
| ui-voice-dictation | 1 包 | 语音听写 UI |
| client/runtime | 1 包 | 运行时客户端 |

### P3 — 基础设施/开发支持

| 项 | 包数 | 说明 |
|----|------|------|
| TUI (codex-tui/tui) | 2 包 + 2 bundle | TUI 交互 |
| Codex App Server | 2 包 | Codex 应用服务器 |
| Examples | 3 包 | 示例应用 |
| turn-budget-policy | 1 包 | 轮次预算 |
| apiproxy | 1 包 | API 代理 |
| agent-execution-guidance | 1 包 | 执行引导 |
| session-persistence-sqlite | 1 包 | SQLite 持久化 |
| tool-subagent-report | 1 包 | 子代理报告 |
| acp-snapshot | 1 包 | 测试支持 |
| web-permission-policy | 1 包 | Web 权限策略 |
| code-runtime-python | 1 包 | Python 运行时（main 放在 experimental） |

### P4 — 文档/配置

| 项 | 说明 |
|----|------|
| 10 组能力文档 | artifact/browser/computer-use/coordination/design/execution-host/git/mobile-device/security/tui |
| 安全文档 | anti-trace-module、trace-risk-assessment、opsec-guard |
| AI 通用提示词 | AI-COMMON-PROMPT.full |
| knip.json | 死代码检测 |
| SAFETY.md | 安全说明 |

---

## 十一、注意事项

1. **版本差异**：staged-final `0.1.0-rc.8` → main `0.1.5-alpha.1`，main 已有 session-format 迁移、subagent-claude-code/codex、win32-process 等 staged-final 没有的新功能
2. **依赖兼容性**：staged-final 的包依赖 `@deepseek-ai/cordis` peer，需确认 main 的 cordis 版本兼容
3. **invariant 体系**：staged-final 所有包都有 `invariant.ts`，main 的 invariant 体系可能不同
4. **code-runtime-python**：staged-final 放在 `code-runtime/`，main 放在 `experimental/`——需确认位置
5. **pnpm-workspace.yaml**：staged-final 有 `native/desktop`、`examples`，main 有 `benchmarks`、`native/system`——workspace 配置需要合并
6. **main 独有功能不应丢失**：webhook、agent-team、session-format 迁移、deepseek-llm-api-extensions、win32-process 等是 main 的新功能
7. **Element Capture**：integration 有 staged-final 没有的 browser element capture，如需此功能需从 integration 补入
