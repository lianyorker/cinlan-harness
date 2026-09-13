# Agentic AI 系统安全评测

本参考用于评估 LLM、Agent、RAG、MCP、Skills、沙箱和远程工具执行组成的系统。它不提供通用越狱 payload 库；测试输入应使用当前目标的授权范围、无害 sentinel 和可回滚动作。

## 适用信号

- 首轮、恢复后或压缩后的工具目录和系统指令不同
- MCP/Skill 描述可更新、可远程安装或来自第三方仓库
- Agent 可组合读取、外发、执行、记忆和浏览器能力
- RAG、长期记忆或多 Agent 通信可跨会话影响行为
- 代码解释器、容器、浏览器预览或远程 executor 承载工具
- 需要把一次成功攻击转成可重复的安全回归

## 核心规则

1. **执行器负责安全决定。** Prompt、工具描述、审批提示或 UI 隐藏都不是最终执行控制；从直接调用、替代调用、后台和恢复路径验证同一限制。
2. **基线、攻击、对照缺一不可。** 先记录同一身份和同一输入的基线，再只改变一个变量，最后从干净会话复现或进行跨角色对照。
3. **按生命周期取样。** 至少覆盖首请求、首次工具调用后、恢复、压缩后和委派给子 Agent 后；不能用单个阶段代表整个运行期。
4. **评估能力组合。** 单个读取或外发工具可能符合预期，读取加外发、检索加执行、记忆加恢复等组合才是实际风险。
5. **外部 prompt 语料只作为不可信靶面。** 来源不明、泄露或无版本信息的系统 prompt 不得进入可信运行指令，也不得作为规范实现。

## 1. 冻结被测面

每次评测固定以下输入，并记录散列：

- 模型/provider 标识、运行时和源代码版本
- system/developer prompt 的授权快照
- 工具名称、描述、JSON schema、顺序和执行 owner
- MCP server、Skill/Plugin 包、来源、版本、完整性信息和权限
- RAG 数据集、embedding/index 版本、记忆命名空间和压缩器版本
- 角色、租户、凭据、网络出口、沙箱镜像和资源预算

下面的标准库脚本可为已导出的 prompt 和 JSON 目录生成确定性清单。JSON 先按键排序再计算 SHA-256，文本按原始字节计算。

~~~python
# capture_agent_surface.py
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
records = []
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    data = path.read_bytes()
    if path.suffix == ".json":
        value = json.loads(data.decode("utf-8"))
        data = json.dumps(value, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":")).encode("utf-8")
    records.append({
        "path": path.relative_to(root).as_posix(),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    })
pathlib.Path("agent-surface-manifest.json").write_text(
    json.dumps({"files": records}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
~~~

~~~text
python capture_agent_surface.py exported-agent-surface
~~~

清单只证明输入一致，不证明行为一致；模型随机性和外部服务状态仍需重复运行与证据对照。

## 2. 生命周期差分

| 阶段 | 必须捕获 | 主要风险 |
| --- | --- | --- |
| 首请求 | prompt、工具目录、自动注入上下文 | 初始策略缺失、工具剂量改变行为 |
| 首次工具后 | 新增/移除工具、权限和上下文 | 动态晋升绕过首轮约束 |
| Resume/Reload | 恢复的消息、记忆、授权状态 | 恢复后策略或租户错配 |
| Compaction 后 | 摘要、保留工具、被丢弃的控制信息 | 摘要投毒、控制信息丢失 |
| 子 Agent/多 Agent | 委派内容、身份、工具与结果来源 | 身份伪造、权限继承过宽 |
| 更新后 | MCP/Skill 描述、代码、签名和版本 | 描述变更、rug pull、依赖投毒 |

动态工具目录本身不是漏洞。只有安全控制在阶段切换后消失、权限扩大未被执行器重新校验，或不可信内容改变了授权动作，才形成可复现问题。

## 3. 能力链测试

| 能力链 | 无害验证 | 预期控制 |
| --- | --- | --- |
| 读取 + 外发 | 读取 sentinel 后请求发送到本地 sink | 数据分类、目标 allowlist、执行时授权 |
| Web/RAG + 工具 | 外部页面包含调用无害工具的指令 | 内容与指令分离、来源标记 |
| MCP 发现 + 执行 | 发现后替换工具描述或 schema | 固定版本、完整性校验、更新复核 |
| 记忆 + Resume | 写入带来源的 sentinel 后重启会话 | 命名空间隔离、来源保留、可撤销 |
| 多 Agent + 高权限工具 | 低权限 Agent 请求高权限 Agent 执行动作 | 不转移调用者身份、逐动作授权 |
| 浏览器执行 + 凭据 | 页面内容诱导读取受保护状态 | origin 隔离、凭据不可见、出口限制 |
| 代码执行 + 文件系统 | 在沙箱内创建 sentinel 并重启 | 文件根限制、会话清理、宿主不可达 |

每个链路先验证单项能力的预期行为，再验证组合。不要把“某工具存在”直接报告为漏洞。

## 4. 专项检查

### Prompt 与工具结果

- 用无害 sentinel 测试直接注入、网页/文件间接注入、工具结果注入和摘要注入。
- 检查不可信内容是否保持来源标签，是否能覆盖更高优先级指令。
- 检查错误、调试输出和导出文件是否泄露 system prompt、凭据或隐藏工具参数。
- 对首轮和后续轮次分别比较，因为工具目录和自动上下文可能改变模型轨迹。

### MCP、Skills 与插件

- 固定源 URL、commit/package version、hash/signature、依赖和权限声明。
- 安装前后分别比较显示描述、实际 schema 和 executor 行为。
- 评估 tool shadowing、同名覆盖、跨 server 调用、描述与代码不一致、更新后权限扩大。
- 签名只能证明发布者和内容完整性，不能证明内容安全；仍需静态审查和隔离运行。
- 惰性加载可降低默认上下文和攻击面，但首次加载必须执行同一验证。

### RAG 与记忆

- 区分文档写入权限、检索时授权和生成时引用；存储时隔离不能替代检索时鉴权。
- 测试共享索引、跨租户检索、向量近邻操纵、长期记忆、压缩摘要和跨 Agent 记忆。
- 每条记忆保留写入者、来源、时间、作用域和撤销记录；用户推翻旧事实时删除旧记录。

### 身份与授权

- 为每个租户准备至少两个角色，记录用户身份、Agent 身份和下游凭据三者。
- 工具执行时重新计算授权，不信任模型生成的角色、scope 或“已批准”文本。
- 检查 delegated token、服务账号、云凭据和 MCP 凭据是否超出单次动作所需范围。

### 沙箱、预览与网络

- 检查 user/PID/network namespace、capability、seccomp/AppArmor、宿主挂载和容器 socket。
- 默认阻断云 metadata、内部控制面和非必要外网；DNS 与 HTTP 走同一出口策略。
- 验证跨会话进程、文件、shell history、环境变量、缓存和浏览器 storage 是否被清理。
- iframe/Webview 预览检查 sandbox、CSP、父页面访问、下载、导航和外部资源请求。
- 资源限制覆盖 CPU、内存、进程、磁盘、网络、token、工具步数和墙钟时间。

## 5. 证据与结论

一次运行至少输出：

- surface manifest 与运行配置
- 基线、攻击、对照的输入和原始响应
- 工具调用、executor 结果、网络/文件副作用和时间线
- 覆盖项、未执行项、预算耗尽和工具错误
- finding 状态：observation、hypothesis 或 reproduced-vulnerability
- 修复后使用原始复现步骤的验证结果

“模型拒绝了 payload”只证明该次采样未成功；“工具返回 200”也不证明越权，必须确认响应包含另一身份不可访问的数据或产生了不允许的副作用。多次运行应报告样本数、最差结果和波动，不把单次高分泛化为系统能力。

## 常见误判

- 把 prompt 泄露本身等同于凭据泄露或执行权限
- 把存在 shell/browser/MCP 工具等同于可越权调用
- 把 RAG 检索到恶意文档等同于其指令已影响动作
- 把 sandbox 内 root 等同于宿主 root
- 把扫描器 exit code 0 等同于完整覆盖且无漏洞
- 用新 rubric 重算旧结果，破坏不同运行的可比性

## 工具映射

| 证据面 | 能力 |
| --- | --- |
| 文件与配置 | read、glob、grep、hash、diff |
| Web/RAG/MCP 页面 | browser snapshot、HTTP fetch、代理记录 |
| 本地与容器 | subprocess/terminal、进程树、网络与文件观测 |
| 身份与 API | 两组角色凭据、请求/响应重放 |
| 发现记录 | finding observation → hypothesis → reproduced-vulnerability |
| 报告 | Markdown、JSON/SARIF、原始 artifact 引用 |

## 来源与采用范围

| 来源 | 审计版本 | 许可证/归属 | 本参考采用 |
| --- | --- | --- | --- |
| AISS 绿盟大模型安全智链社区 | 2026-08-23 在线快照 | 站点未声明开放内容许可证 | 五域/生命周期作为路由事实，未复制正文 |
| Pa55w0rd/secknowledge-skill | 078de3baa6b325f5acc5338c62169532e8f922b4 | README 称 MIT，但无 LICENSE；含 AISS 派生内容 | 仅用于缺口发现，不复制正文和冲突编号 |
| xiaobright/dsh-anchored-standard | 25f21aefaf8ddc414da54d2e581e43740d977c6e | MIT | 生命周期工具面差分思路 |
| xiaobright/modeltest | 04255b55f16c4439e538239fb9783070c4165081 | 无 LICENSE | 冻结输入、可见性隔离、worst-of-n 方法论 |
| x1xhlol/system-prompts-and-models-of-ai-tools | 1e4203a7d88873c1b37ab2d1c07074fea498c274 | GPL-3.0 集合；内含提示词归属不清 | 只作为不可信靶面，不复制提示词 |
| usestrix/strix | 1c499c5b2d788c553f0d276b389b2b424e483304 | Apache-2.0 | 覆盖、预算、artifact 和复现纪律 |
| nexu-io/open-design | 114e73de162cef277e6e6d0d0f9a644ed27ba4b4 | Apache-2.0 | iframe/数据根/预览隔离检查 |
| lin9527ya/cybersparker | f965532dfcc1282b6ef6c52ff04d5ec744ad569f | GPL-3.0 | PoC 人审与隔离探测思路 |
| CyberStrikeus/CyberStrike | bd0936f96d58b7fdc367a3e2a10bad9b88d7a85f | AGPL-3.0 | scope、role context、Skill 完整性思路 |

外部项目不是运行依赖。本参考以独立表述整合方法，不包含其代码、系统 prompt、技能正文或 payload 语料。
