# @cinlan/client-ui-bot-studio

面向非技术人员的 Bot 组合：一个设置 section——Bot 名册、表单编辑器（人格、工具白名单、凭据 scope、排序）与变更审计。Bot 是 `bot-registry` settings 命名空间里的行；host 侧把它们投影为 Agent 预设。

[English](README.md) | 中文

## 挂载

```yml
- id: ui-bot-studio
  name: '@cinlan/client-ui-bot-studio'
```

## 行为

| 通道 | 路径 |
| --- | --- |
| 读 | `remote.settings.describe()` → `bot-registry` 命名空间的 `user` 段。 |
| 写 | `remote.settings.update('bot-registry', { bots: … })`——host 侧 revision 锁；整段合并。 |
| 收敛 | host 的 `BotRegistryService` 监听 `app-boot/config-reload`，把已存段落重新投影为 preset 注册。 |

表单在客户端做校验（id 形状、必填、列表形状）以提前反馈；host 对每次写入重新校验，UI 不可能绕过 [`@cinlan/bot-registry`](../../preset/bot-registry/README.zh.md) 的规则。凭据字段只承载 scope 名——表单和命名空间里都不存在密文。

## 已知局限与延后工作

- 每次保存整段合并 `bots` 数组；两个工作室并发编辑不同 Bot 会互相覆盖（单工作室假设）。
- 工具与凭据输入是普通名单；尚未提供对照实际插件/凭据注册表的选择器。
