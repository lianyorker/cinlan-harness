# @cinlan/bot-registry

[English](README.md) | 中文

面向非技术人员的 Bot 定义注册表。一个 Bot 是 agent preset `PresetDefinition` 的受约束投影：人格前缀、工具白名单、授权 scope 引用（[agent-preset-registry](../../preset/agent-preset-registry/README.zh.md)）。Preset 能表达的其余部分（插件名、配置块、JS 条件）没有对应的表单字段，因此无法经投影授予。

## 存储

Bot 行存在 `bot-registry` settings 命名空间——即 profile 的 `settings.yaml`，经 [settings 服务](../../settings/settings/README.zh.md)写入并享受其 revision 锁。段落形状：

```yaml
bots:
  - id: weekly-report-bot
    name: Weekly report compiler
    description: Summarize worktree commits every Friday
    persona: You compile the weekly report...
    tools: [tool-fs, tool-goal]
    credentials: [gitee-ro]   # authorization scope names, never secrets
    order: 10
roles:
  - subject: owner
    role: admin               # admin | builder | viewer
audit:
  - { at: 1762600000000, action: create, botId: weekly-report-bot, summary: '2 tools, 1 credential' }
```

服务在启动和每次 `app-boot/config-reload` 时重读命名空间，并把注册收敛到存储行：新增的 Bot 经 `AgentPresetRegistry.register()` 注册，移除的 Bot 注销，变更的 Bot 重注册。没有 settings 服务的组合（测试、最小 host）将段落保存在内存里；无法持久化时写路径会响亮失败。

## 治理

- **角色**：命名空间自带的 `roles` 表把守写操作（`putBot` / `deleteBot`）。`admin` 与 `builder` 可写；`viewer` 被拒并报出角色。没有匹配行时回退到 `defaultRole` 配置（默认 `admin`，即单用户 profile 的情形）。跨部门隔离在 v1 未定义——见 plan §7.3。
- **凭据**：Bot 行只存授权 scope 的引用名；密文留在 credentials/authorization 服务里。
- **审计**：每次成功写入都向命名空间的 `audit` 数组追加一行（时间、动作、字段摘要）。

## API

| 方法 | 行为 |
| --- | --- |
| `listBots()` | 全部已存的 Bot 行。 |
| `putBot(caller, bot)` | 校验、权限检查、持久化、收敛注册。 |
| `deleteBot(caller, botId)` | 权限检查、移除、收敛注册。 |
| `auditTrail()` | 审计数组，新的在后。 |
| `reload()` | 重读命名空间并收敛注册。 |

## 表单投影

`toPresetDefinition(bot)` 构造 preset 声明：一行 `@deepseek-ai/dsh-persona` 携带人格前缀，每个放行工具一行插件行，每个 scope 引用一行 `@deepseek-ai/dsh-credentials/grant`。`presetIdFor` / `botIdFor` 在 `bot-<id>` 的 preset 身份与 Bot 行之间互转。

## 已知局限与延后工作

- 人格原样前置；Bot 人格内暂无模板插值。
- 审计轨迹只记最后写入者语义：条目带动作与摘要，不带操作者身份。
