# 安全研发模块对比分析

> 分析对象：cinlan-harness 各副本目录的安全研发实现差异
> 日期：2026-09-09

## 总览

| 目录 | 版本 | security 包数 | 安全 skills | 漏洞知识库 | Finding 系统 | Assessment Scope | 安全工作流 |
|------|------|---------------|-------------|-----------|-------------|-----------------|-----------|
| **cinlan-harness** (main) | 0.1.5-alpha.1 | 0 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **integration-20260909** | 0.1.3-alpha.1 | 1 (`security-skills`) | ✅ 25 个 | ❌ | ❌ | ❌ | ❌ |
| **staged-final-b84814d3** | 0.1.0-rc.8 | 11 | ✅ 25 个 | ✅ | ✅ | ✅ | ✅ |
| **recovery** | — | 0 | ❌ | ❌ | ❌ | ❌ | ❌ |

## 各目录详情

### 1. cinlan-harness（main，0.1.5-alpha.1）

完全没有安全研发模块。上游 deepseek-harness 的最新 fork，packages 里没有 `security` 包组。只有通用的 `SAFETY.md` 安全声明。

### 2. integration-20260909 / integration-260909（0.1.3-alpha.1）

只有 `security-skills` 一个包——安全技能的打包注册器，没有配套的安全基础设施。

#### 25 个安全 skills

| 分类 | Skill | 说明 |
|------|-------|------|
| 渗透测试 | `pentest-tools` | Nmap/Nuclei/SQLMap/FFUF/Burp 等 20+ 工具链 |
| 渗透测试 | `attack-chain` | 攻击链编排 |
| 逆向工程 | `reverse-engineering` | 通用逆向（二进制/APK/WASM/firmware/自定义 VM） |
| 逆向工程 | `ida-reverse` | IDA Pro 逆向分析 |
| 逆向工程 | `radare2` | radare2/r2 命令行分析 |
| 逆向工程 | `js-reverse` | JavaScript 逆向（签名定位、CDP/Hook） |
| 逆向工程 | `apk-reverse` | APK 逆向 |
| 逆向工程 | `mobile-reverse` | Android/iOS 逆向 + Frida/Objection |
| 漏洞利用 | `pwn-chain` | 栈溢出/堆利用/内核 pwn 全链路 |
| 漏洞利用 | `patch-diff-exploit` | N-day 补丁差分到武器化 |
| 漏洞利用 | `firmware-pentest` | 固件/IoT 渗透（OWASP FSTM） |
| 漏洞利用 | `binary-diff` | 二进制 diff 分析 |
| 防御规避 | `edr-bypass-re` | EDR/AV 绕过（unhook/direct syscall/AMSI patch） |
| 恶意软件 | `malware-analysis` | 静态+动态分析、IOC 提取、YARA/Sigma |
| 供应链 | `supply-chain-security` | SBOM、依赖分析、CI/CD 审查、容器扫描 |
| LLM 安全 | `llm-security` | prompt injection、tool-use 边界、模型供应链 |
| API 安全 | `api-security` | API 安全评估 |
| 辅助 | `browser-automation` | 浏览器自动化 |
| 辅助 | `cinlan-design` | Cinlan 设计 |
| 辅助 | `cinlan-record-browser-gif` | 浏览器 GIF 录制 |
| 辅助 | `diagram-generator` | 图表生成（Mermaid/Graphviz/PlantUML） |
| 辅助 | `docs-generator` | 技术文档生成 |
| 辅助 | `templates` | 模板 |
| 辅助 | `kb` | 知识库 |
| 辅助 | `scripts` | 脚本（bootstrap/refresh） |

**缺失**：没有 finding 系统、漏洞知识库、assessment scope、安全工作流 prompt——skills 是孤立的。

### 3. staged-final-b84814d3 / staged-final-install（0.1.0-rc.8）

最完整的安全研发体系，11 个安全包形成完整闭环。

#### 3.1 安全技能层（`security-skills`）

与 integration 相同的 25 个 skills，但有完整基础设施支撑。

#### 3.2 安全工作流引擎（`security-workflow-prompt`）

注入 `security:workflow` system prompt（order 116），定义 5 阶段安全工作流：

1. **Recon & Attack-Surface Mapping**：按 Web/API、Cloud/Infra、Source Code、Mobile、Binary/Firmware 分类，并行调度专业扫描器（semgrep/nuclei/nikto/ffuf/trivy/prowler/npm audit/apktool/jadx/binwalk 等）
2. **Record**：通过 `finding_record` 记录扫描结果，自动去重（rule + targets + locations 指纹）
3. **Triage & PoC Validation**：`finding_query` 过滤 → `vuln_read`/`vuln_query` 查 CVE → 构建 PoC → 执行验证 → 盲洞用 OOB 确认 → `finding_transition` 状态流转
4. **Fix & Retest**：修复后重跑原始 PoC 验证 → `finding_transition` 到 remediation
5. **Report**：`finding_export` 导出 SARIF/Markdown 报告，发布为 Artifact

#### 3.3 Finding 系统

| 包 | 名称 | 职责 |
|----|------|------|
| `finding` | `@deepseek-ai/dsh-finding` | Finding Service Definition：状态机、指纹去重、Session 事件持久化 |
| `finding-session` | `@deepseek-ai/dsh-finding-session` | Session 集成：projection 查询、事件回放 |
| `tool-finding` | `@deepseek-ai/dsh-tool-finding` | 模型工具：`finding_record`/`finding_query`/`finding_transition`/`finding_export`（SARIF/Markdown/JSON） |

**Finding 状态机**：

```
observation → hypothesis → reproduced-vulnerability → remediation
                    ↓
              unresolved
```

- **确定性去重**：基于 canonical identity（rule + targets + locations）指纹
- **Session 持久化**：finding 变更通过 `finding/change` Session 事件持久化
- **Projection**：compact projection 支持 byState 统计和分页查询
- **导出**：SARIF（机器可读）、Markdown（人工审查）、JSON

#### 3.4 漏洞知识库

| 包 | 名称 | 职责 |
|----|------|------|
| `vuln-kb-service` | `@deepseek-ai/dsh-vuln-kb-service` | Service Definition：`ctx.vulnKb`，多 provider 注册 |
| `vuln-kb-nvd` | `@deepseek-ai/dsh-vuln-kb-nvd` | NVD Provider：NVD REST API 2.0 + OSV.dev，CVSS 解析 |
| `tool-vuln-kb` | `@deepseek-ai/dsh-tool-vuln-kb` | 模型工具：`vuln_query`/`vuln_read`，字节限制 256KB |

- **数据源**：NVD REST API 2.0 + OSV.dev API
- **查询**：按 CVE id、包名、版本、生态系统
- **CVSS**：使用 `@turingpointde/cvss.js` 解析 CVSS 向量
- **无 API key**：基础查询受速率限制，无需 key

#### 3.5 Assessment Scope 授权系统

| 包 | 名称 | 职责 |
|----|------|------|
| `assessment-scope` | `@deepseek-ai/dsh-assessment-scope` | Service Definition：授权模型、目标、egress、凭证引用 |
| `assessment-scope-session` | `@deepseek-ai/dsh-assessment-scope-session` | Session 集成 |
| `assessment-scope-static` | `@deepseek-ai/dsh-assessment-scope-static` | 静态 Provider：operator 配置提供不可变 root grant |

**8 阶操作顺序**：

```
reconnaissance → active-validation → credential-use → persistence-change
→ exploit-execution → destructive-operation → data-export → external-reporting
```

- **目标类型**：hostname、ip-address、url-prefix、artifact-scope、service
- **Egress 控制**：protocol（http/https/tcp/udp）+ purpose（model-provider/web-search/target-access/artifact-export）+ 目标绑定
- **凭证引用**：只接受 ref，不接受 inline secret
- **时间约束**：`notBefore` / `expiresAt` 毫秒级时间窗口

#### 3.6 里程碑文档（`里程碑.md`）

记录 13 个已知问题和改进计划，关键项：

- **无限思考 bug**：工具错误后 agent 不停转（`agent-loop` 缺 `maxSteps`/`maxConsecutiveErrors`）
- **`cinlan` CLI 撞名**：与 orca IDE 的 `cinlan` 命令冲突
- **架构过重**：子 agent 自动编排需审计
- **系统提示词收敛**：plan-mode 文案漂移、persona 模板重复

### 4. recovery

仅包含核心运行时包（boot/session/core/interaction/code-runtime），无任何安全研发模块。

## 迁移建议

若要在当前 cinlan-harness (main) 上恢复安全研发能力，需从 staged-final-b84814d3 迁移：

### 必需包

| 来源 | 包 | 依赖 |
|------|-----|------|
| `packages/security/` | 全部 11 个包 | — |
| `packages/artifact/` | finding 导出依赖 | — |
| `packages/execution-host/` | finding 工具依赖 | — |

### 配置集成

- `pnpm-workspace.yaml`：确认 `packages/security/*` 在 workspace globs 内
- `cordis.yml` / bundle presets：注册 security 插件
- `tsconfig.base.json`：添加 security 包的路径映射
- `vitest.config.ts`：添加 security 包的测试覆盖

### 注意事项

- staged-final 版本是 `0.1.0-rc.8`，main 是 `0.1.5-alpha.1`，需确认 API 兼容性
- `AGENTS.md` 差异 58 行，需合并安全相关的规则
- `tsconfig.base.json` 差异 436 行，需确认路径映射不冲突
