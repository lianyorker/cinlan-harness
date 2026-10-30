---
kind: upgrade-guide
description: "Security Research 保留 Session 权限，不再强制审批策略 never。"
---

# Security Research Session 权限

[English](guide.md) | 中文

## 变更

Security Research 预设原本在每次 Agent 启动时强制设置审批策略 `never`。它改为保留 Session 的权限选择。新 Session 使用部署及用户设置的默认权限预设；base 默认为 `workspace-write` 与 `ask`。已有 Session 的覆盖值不被重写。

## 迁移

1. 更新 Security Research 组合包后重启 Host。在设置中核对未来 Session 的默认权限。
2. 使用 Security Research 预设新建 Session，确认输入框显示配置的权限预设。使用 base 默认值时应显示工作区内修改权限。
3. 已有 Session 记录的 `workspace-write` sandbox 与 `never` 审批可能不匹配任何配置预设，因而仍显示 Custom。请显式选择当前 Session 所需权限；升级不会自动修改旧 Session。
