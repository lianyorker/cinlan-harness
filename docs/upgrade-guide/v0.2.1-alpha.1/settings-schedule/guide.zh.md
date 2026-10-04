---
kind: upgrade-guide
description: "设置页自动化入口改为使用官方 Schedule 服务。"
---

# 设置页 Schedule 迁移

[English](guide.md) | 中文

## 变更

v0.2.1-alpha.1 中，设置页入口打开官方 Schedule 任务管理器。它与 Schedule 侧栏和 Session 页面读取同一任务目录与投递历史，不再使用已退役的本地 automation controller，也不维护第二套任务存储。

官方 Schedule 会把提醒投递到任务原始 Session，支持 after、绝对时间、固定间隔、daily、weekly 和 cron 规则，并要求明确时区。任务创建仍由 Schedule 任务管理器和 schedule_create 工具提供；设置页入口负责跳转到该管理器。

已删除的 @deepseek-ai/dsh-settings-file provider 不再是支持的设置集成方式。设置表单来自活动 Loader entry Config 中的 volatile 字段，并持久化到 profile patch。

## 迁移

1. 升级后为每个 profile 启动一次，使 Web 组合挂载 schedule 和 ui-schedule。
2. 将本地 automation 定义重建为 Schedule 任务。旧 automation 可以新建 Session，而 Schedule 会投递到已有 Session；重建时必须选择目标 Session，不能直接导入定义。
3. 删除对 @deepseek-ai/dsh-settings-file 的直接依赖；测试和插件组合改用 @deepseek-ai/dsh-settings 以及基于 profile 的 Config 表单。
4. 打开 Settings 的 Schedule 入口检查共享目录。Schedule 侧栏和模型工具应看到同一批任务。

由于旧 automation 与 Schedule 的执行语义不同，现有本地 automation 文件不会自动导入。
