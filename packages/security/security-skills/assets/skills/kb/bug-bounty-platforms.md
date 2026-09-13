# Bug Bounty 平台参考

> 本文件整合主流 Bug Bounty 和漏洞响应平台的评级标准、报告格式、API 接口，供安全工作流和 Finding capability 参考。

---

## 评级体系对照

### 统一映射表

| 级别 | HackerOne | Bugcrowd VRT | Immunefi (Smart Contract) | CVSS v3.1 | 补天 | 漏洞盒子 |
|------|-----------|--------------|---------------------------|-----------|------|----------|
| Critical | Critical | P1 | 5-Critical | 9.0–10.0 | 严重 | 严重 |
| High | High | P2 | 4-High | 7.0–8.9 | 高危 | 高危 |
| Medium | Medium | P3 | 3-Medium | 4.0–6.9 | 中危 | 中危 |
| Low | Low | P4 | 2-Low | 0.1–3.9 | 低危 | 低危 |
| Info | Informational | P5 | 1-None | 0.0 | 信息 | 信息 |

---

## HackerOne

**报告数据模型（API v2）：**
- `title` — 漏洞标题
- `state` — 报告状态：`new` / `needs_more_info` / `pending_program_review` / `retesting` / `resolved` / `triaged` / `duplicate` / `informative` / `not_applicable`
- `severity.rating` — 定性评级：`critical` / `high` / `medium` / `low` / `informational`
- `severity.score` — CVSS v3.0/v3.1/v4.0 数值分数
- `weakness` — CWE 关联（`external_id` 如 `cwe-352`，`name` 如 `Cross-Site Request Forgery (CSRF)`）
- `cve_ids` — 关联 CVE ID 列表
- `attachments` — 证据附件
- `bounties` — 赏金记录
- `summaries` — 可选摘要（team 或 hacker 提供）

**CVSS 计算：** HackerOne 提供 CVSS 3.0（自定义实现）、3.1（标准）、4.0 三种计算器。程序可选择任一或组合使用。

**报告提交要素：**
1. 资产类型选择
2. Weakness（CWE）选择
3. 严重性评级（手动或 CVSS 计算器）
4. PoC（漏洞描述 + 复现步骤 + 影响）

**API 文档：** https://api.hackerone.com/hacker-reference/

---

## Bugcrowd VRT (Vulnerability Rating Taxonomy)

**版本：** v1.19（2026-07），开源 JSON 格式

**分级：** P1 (Critical) → P5 (Informational)

**分类层级：** Category → Sub-Category → Variant（三级嵌套）

**顶层分类（部分）：**
- `ai_application_security` — AI 应用安全（对抗样本注入、AI 误分类攻击、实现漏洞）
- `server_security` — 服务器安全
- `client_side_security` — 客户端安全
- `mobile_application_security` — 移动应用安全
- `api_security` — API 安全
- `business_logic` — 业务逻辑
- `insecure_direct_object_reference` — IDOR（P4–P1，上下文依赖）

**上下文依赖：** 标记为 "Varies" 的条目优先级取决于上下文。例如 IDOR 可从 P4 到 P1。

**VRT → CVSS 映射：** Bugcrowd 平台支持 VRT 到 CVSS 的自动转换。

**JSON 源：** https://github.com/bugcrowd/vulnerability-rating-taxonomy

---

## Immunefi 严重性分级 v2.3（Smart Contract 专用）

**Smart Contract 分级：**

| 级别 | 影响 |
|------|------|
| **5-Critical** | 治理投票操纵、直接盗窃用户资金/NFT、永久冻结资金/NFT、MEV、未授权铸造 NFT、可预测 RNG 滥用、协议资不抵债 |
| **4-High** | 盗窃未申领收益/版税、永久冻结未申领收益/版税、临时冻结资金/NFT |
| **3-Medium** | 合约因代币资金不足无法运行、区块填充获利、Griefing、盗窃 gas、无界 gas 消耗 |
| **2-Low** | 合约未能交付承诺收益但不损失价值 |
| **1-None** | 最佳实践 |

**赏金计算：** 通常为风险资金的 10%，上限为程序声明的最大 Critical 赏金。可升级/可暂停合约仅考虑首次攻击（1 小时窗口内）；不可升级/不可暂停合约考虑累积重复攻击影响。

**多影响提交：** 如果一个漏洞导致多个严重级别的影响，选择最高严重级别。每个修复对应一个独立报告。

**Web/App 分级（非 Smart Contract）：** Critical = 不需要用户操作的资金损失 / 私钥泄露；其他 Critical 影响 = 固定 $5,000。

---

## 补天（Butian）

**漏洞类型：**
- **通用漏洞** — 第三方软件/应用/系统漏洞（如 ECShop SQL 注入、Discuz XSS）
- **事件漏洞** — 特定网站的具体漏洞（如某网站命令执行、某电商订单泄露）

**处理流程：**
1. 漏洞提交 → 补天审核（1 个工作日）→ 厂商认领（7 天等待）→ 确认 → 奖金发放（7 个工作日）
2. 专属 SRC：审核 → 厂商复审（一周内）→ 奖金确认；超一周未审核自动通过

**奖励类型：** 现金奖励、虚拟积分（荣誉币 RYB、库币 KB）、荣誉奖励

**排行榜：** 战神榜（有效漏洞数前十）、赏金猎人（月度奖金前十）、火眼金睛（准确率前十）

**提交规范：** https://www.butian.net/Article/content/id/543

---

## 漏洞盒子（VulBox）

**模式：** 公益 SRC + 专属 SRC + 众测

**评级：** 严重 / 高危 / 中危 / 低危 / 信息，基于 CVSS v3 评分

**CVSS 计算器：** https://www.vulbox.com/cvss — 提供完整的 CVSS v3 基础分 + 环境分计算器，支持攻击向量(AV)、攻击复杂度(AC)、权限要求(PR)、范围(S)、可用性影响(A)、机密性需求(CR)、完整性需求(IR) 等全部度量指标

**漏洞提交必填字段（V3.1+）：**
- 漏洞 URL/位置（例：`https://www.vulbox.com/user/submit-1000`）
- 影响参数（例：SQL 注入点 `id`）
- 漏洞原始请求包（完整 HTTP request）
- 漏洞 Payload（例：`'><script>alert('payload poc for xss.')</script>`）
- 复现步骤（完整操作过程）
- 补充说明（非必填，详细可加分）

**评级标准示例（KYSRC/HBSRC/MIoTSRC 通用模式）：**

| 级别 | 典型漏洞 |
|------|----------|
| **严重** | 直接获取核心系统权限（命令执行、远程溢出）、大量用户核心数据泄露、严重影响业务逻辑漏洞 |
| **高危** | 业务服务器权限（webshell、任意代码执行）、核心 DB SQL 注入、批量盗取用户身份信息、越权访问后台 |
| **中危** | 需交互获取用户信息（存储型 XSS）、任意文件操作（读/写/删除/下载）、绕过限制修改用户资料、敏感信息文件泄露 |
| **低危** | 非重要信息泄露、URL 跳转、较难利用的 XSS、普通 CSRF |

**通用评级原则：**
1. 同一漏洞源产生的多个漏洞计为一个（同域名/IP = 同一漏洞源）
2. 前后关联漏洞合并处理，按最高级别奖励
3. 边缘/废弃业务系统降级处理
4. 利用条件苛刻的漏洞降级处理
5. 已获取系统权限（webshell）后禁止下载源代码审计，需事先联系审核员
6. 弱口令：同一系统多用户弱口令只确认第一个

---

## 阿里云先知（Xianzhi）

**模式：** 企业 SRC + 众测平台 + 通用软件漏洞情报收集

**特点：** 与阿里云生态集成，支持云安全漏洞（ECS、OSS、RDS 等配置错误和权限问题）

**资产分级：** 超级资产 / 关键资产 / 核心资产 / 一般资产 / 边界资产 / 边缘资产 — 不同资产等级对应不同赏金

**漏洞等级（企业 SRC）：**

| 级别 | 基础分 | 典型漏洞 |
|------|--------|----------|
| **高危** | 60-100 | 直接获取系统权限（RCE、webshell、SQL 注入获取权限）、重要业务拒绝服务、核心 DB SQL 注入、批量修改任意账号密码、绕过认证访问管理后台、SSRF 获取内网信息 |
| **中危** | 30-50 | 需交互的存储型 XSS、核心业务 CSRF、普通越权操作、普通逻辑缺陷（不限次数短信发送） |
| **低危** | 10-20 | 本地拒绝服务、客户端明文存储密码、路径遍历、反射型 XSS、普通 CSRF、URL 跳转 |

**通用软件漏洞评分（第六期）：**
- 最终得分 = CVSS 3.1 基础分 × 40% + 威胁及利用评分 × 60%
- 严重 [9.0-10.0] / 高危 [7.0-9.0) / 中危 [4.0-7.0) / 低危 [1.0-4.0)
- 仅收取高危、严重的前台 RCE 漏洞

**漏洞降级规则：**
- 需用户权限且无法注册账号 → 降一级（可任意登录除外）
- 需管理员权限 → 通常降两级
- 满足特定条件才能触发 → 酌情降级
- 影响版本有限 → 默认降一级

**处理流程：** 提交 → 先知评估（5 个工作日）→ 确认等级和奖金（24 小时内）→ 企业收录（15 天自动收录）→ 白帽子确认 → 奖金发放（3 个月内到支付宝）

**通用原则：**
1. 同一漏洞源多个漏洞计为一个
2. 第三方产品漏洞只给首位提交者，等级不高于中危
3. 同一漏洞首位报告者计分
4. 未修复前被公开的漏洞不计分
5. 网上已公开漏洞不计分
6. 同一报告多个漏洞按最高级别计

---

## 春秋云测（Chunqiu）

**模式：** 众测 + CTF 竞赛 + 安全能力认证

**特点：** 偏向实战攻防演练，支持渗透测试靶场和竞赛场景

---

## Synack

**模式：** 私有众测（邀请制），Synack Red Team (SRT) 1500+ 认证研究员

**准入门槛：** 5 步审核流程，历史通过率 < 10%。支持认证快速通道（Priority Pathways）：
- **OffSec** — OSEE / OSCE³ / OSWE / OSEP / OSCP（Web + Host 技术审核豁免）
- **CREST** — CCT INF (Host) / CCT APP (Web)
- **HackTheBox** — CWEE / CPTS / CWES (Web + Host)
- **SANS** — GXPN / GWAPT / GRTP / GPEN
- **PortSwigger** — BSCP (Web)
- **AI 专项** — OSAI / COAE / GOAA（必须配合 Web 或 Host）

**赏金范围：** 常规 mission $25-50，ad-hoc mission $100+，漏洞 $500 至数千美元（2020 年均值 $600-900）

**风险优先级框架（非纯 CVSS）：**
- 确认可利用性（exploit feasibility）优先于静态严重性评分
- 结合 EPSS（Exploit Prediction Scoring System）估计实际被利用概率
- 考虑因素：外部可访问性 vs 内部隔离、活跃利用指标、资产关键性、合规/合同风险、补偿控制强度
- 区分 score-driven（基础评分→阈值升级）vs risk-driven（证据支撑→风险判定）方法

**Coverage Analytics：** 提供研究员活动透明度 — 哪些 web/host 资产被测试、测试性质、流量证据，支持审计和合规报告

---

## OpenBugBounty

**模式：** 公益开源 Bug Bounty，任何网站均可报告，无注册要求

**接受漏洞类型：**
1. 托管 Bug Bounty 程序的漏洞（遵循程序特定指南）
2. XSS 和部分 Web 应用漏洞（非侵入式手段发现，适用于任何网站）
- **不接受** SQL 注入、RCE 等危险类型（需直接发送给厂商邮箱）
- **不存储** 危险类型漏洞报告

**验证时效：** XSS 等简单漏洞约数天；复杂漏洞（如 Improper Access Control）约 10 天

**披露流程：** 基于 ISO 29147 协调披露指南，漏洞修复后公开披露

**拒绝原因统计：** 99.9% 被拒漏洞属于不接受类型（如 SQL 注入、HTTP 头配置错误）或无法复现

---

## CyberSparker（参考平台）

**核心能力：**
- 攻击面测绘：公网/内网资产发现，支持 fscanx 输出导入，6 种输入来源（txt 文件、测绘平台 fofa/quake/hunter/zoomeye/shodan、历史任务）
- 漏洞扫描：Python 脚本 + Nuclei 1w+ YAML PoC，ceye dnslog 无回显验证
- AI 生成 PoC：URL 爬取 → HTML 清洗 → Markdown → 思考模型生成 PoC
- 指纹识别：产品指纹绑定 PoC，减少无效发包
- 目录扫描：扫描过程中识别产品 + 自动漏洞扫描

**技术栈：** Python 3.11+ / Django 4.1 / PostgreSQL 17 / Redis 7 / Celery 5.4 / gevent

---

## CyberStrike / CyberStrikeAI（参考平台）

**核心能力：**
- 5 个 AI Agent：Cloud Security / Internal Network / Red Team / Web Application / Bug Hunter
- 100+ Kali Linux 工具集成（MCP 协议）
- 角色制测试：12+ 预定义安全测试角色（渗透测试、CTF、Web 应用扫描、API 安全、二进制分析、云安全审计等）
- 技能系统：20+ 预定义安全测试技能（SQL 注入、XSS、API 安全等）
- 攻击链图谱、风险评分、逐步回放
- 知识库：向量搜索 + 混合检索
- 漏洞管理：CRUD、严重性跟踪、状态工作流、统计导出
- 批量任务管理：任务队列、顺序执行、状态跟踪

**技术栈：** Go / SQLite / MCP（HTTP/stdio/SSE）

---

## 通用 Bug Bounty 报告写作规范

**来源：** Bug Bounty Playbook + Bugcrowd 文档 + CERT/CC CVD 指南

**标准报告结构：**

1. **Title** — `[漏洞类型] in [具体位置] allows [攻击者能做什么]`
   - ❌ `XSS found on login page`
   - ✅ `Stored XSS in profile bio field allows arbitrary script execution in victim sessions`
   - ✅ `IDOR on /api/v2/invoices/{id} exposes any customer's billing records`

2. **Summary** — 两句话：第一句说明漏洞是什么、在哪里；第二句说明攻击者能做什么（业务语言，非技术术语）

3. **Environment** — 受影响的软件版本/模型、环境配置

4. **Reproduction Steps** — 编号步骤，精确可复现
   - 使用确切 URL，不写「导航到设置页面」
   - 包含确切 payload，不写「输入 XSS payload」
   - 注明所需账号状态（登录、角色、对象所有权）
   - 如有时序要求，明确说明
   - 每步一个操作

5. **Impact** — 业务影响而非技术观察
   - ❌ `An attacker could execute arbitrary JavaScript`
   - ✅ `Any authenticated user who visits a profile with a malicious bio will have their session cookie exfiltrated, allowing full account takeover without user interaction beyond viewing a profile`

6. **Evidence** — 截图、原始 HTTP 请求/响应（Burp 而非浏览器 dev tools）、复杂/时序敏感漏洞的视频
   - 如需证明数据外泄，仅使用自己账号的数据

7. **Suggested Fix** — 可选但增加可信度，1-2 句修复建议

**报告写作核心原则：** 为疲惫、时间紧迫的 triager 写报告 — 10 分钟内能理解漏洞、复现、定级、决定是否升级。每多花一分钟找复现 URL 或解码 payload 就多一分被拒风险。

**争议处理：**
1. 等 24 小时再回复（即时回复通常过于情绪化）
2. 承认对方立场但不同意：「I understand the concern is about exploitability in practice.」
3. 提供一个改变局面的证据，不是一堆理由
4. 以具体请求结尾：「Would you be willing to reopen if I can demonstrate session hijacking from this XSS?」

**CERT/CC CVD 报告要素：**
- 确切软件版本/模型
- 发现方式（使用的工具、发现时在做什么）
- PoC 代码或复现说明
- 理想情况下提供补丁建议
- 影响描述和攻击场景
- 时间约束（如计划在会议公开）

---

## 可提取的集成方向

1. **Finding 严重性映射** — 将 Finding 的 CVSS 评分自动映射到 HackerOne/Bugcrowd/Immunefi/补天/漏洞盒子评级，支持多平台报告生成
2. **Bug Bounty 报告模板** — 为 `docs-generator` 技能添加平台专用报告模板：
   - HackerOne API v2 JSON 格式（title + severity + weakness CWE + cve_ids + PoC）
   - 补天 Markdown 格式（漏洞类型 + 通用/事件 + 复现步骤 + 影响）
   - 漏洞盒子结构化格式（URL + 影响参数 + 原始请求包 + Payload + 复现步骤）
   - Immunefi Smart Contract 格式（影响级别 + 攻击场景 + 赏金计算）
   - 通用 Bug Bounty 报告结构（Title + Summary + Environment + Reproduction + Impact + Evidence + Suggested Fix）
3. **VRT 分类法** — 引入 Bugcrowd VRT 三级分类（Category → Sub-Category → Variant）作为 Finding 的 weakness 分类参考
4. **Immunefi Smart Contract 分级** — 为 Web3/智能合约安全场景添加专用严重性分级（5-Critical 到 1-None）
5. **先知资产分级模型** — 引入资产关键性分级（超级/关键/核心/一般/边界/边缘）影响漏洞最终评级
6. **Synack 风险优先级框架** — 结合 EPSS + 可利用性确认 + 资产关键性 + 补偿控制，超越纯 CVSS 评分
7. **补天/漏洞盒子/先知 API 集成** — 可选的漏洞提交 API consumer，将 Finding 自动提交到国内平台
8. **CyberSparker 攻击面测绘流程** — 资产发现 → 指纹识别 → PoC 绑定的自动化流程可作为 `attack-chain` 技能的参考增强
9. **CyberStrike 角色制测试** — 角色定义 + 技能绑定的模式可参考用于 agent preset 的安全角色配置
10. **通用报告写作规范** — 将 Bug Bounty Playbook 报告结构集成到 `docs-generator` 技能，确保生成的报告符合 triager 期望
11. **漏洞降级规则引擎** — 将先知/漏洞盒子的降级规则（需用户权限降一级、需管理员权限降两级、影响版本有限降一级）实现为 Finding 评级修正逻辑
