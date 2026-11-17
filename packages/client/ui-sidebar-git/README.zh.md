# @cinlan/client-ui-sidebar-git

[English](README.md) | 中文

右侧栏 Git 审查页签：仓库变更、AI 差异审查与 PR 描述草稿。

## 功能

一个右侧栏页签类型（`git`），页面体：

- 经 `sidebarGit` Remote 命名空间读取仓库状态、所选变更集（已暂存 / 工作区 / 与基线比较）与比较基线；
- 经 `gitAi` Remote 命名空间按动作（`diff-review`、`pr-description`）发起 AI 生成，带取消、忙碌与超时状态；
- 草稿落在可编辑的 textarea 里，支持复制与受保护的重新生成（已编辑的草稿先确认再覆盖）；
- 会话或范围变更后丢弃迟到响应，生成期间仓库 HEAD 移动时给出提示。

生成的草稿仅用于预览：本包不会提交、推送或创建 pull request。

## 注册

- 向 `sidebarRightTabs` 注册 `git` 页签类型（含引导入口）。
- 贡献 `sidebar.right.pane.tab`（key `@cinlan/client-ui-sidebar-git`）页面体与对应的 `tab.title`。
- 声明 `sidebarGitReview` 文案命名空间（zh/en）。

## 配置

无插件配置。生成行为（开关、各动作配方、diff 预算、敏感文件过滤）属于 `@cinlan/git-settings` 持有的 `git-source-control` 持久设置命名空间；本包只是消费方。

## Known Limitations and Deferred Work

- PR 描述动作始终面向比较变更集；页面通过切换单选项实现，而非按动作独立选择范围。
- 复制使用 `navigator.clipboard`；无该权限的环境显示本地化的失败提示。

## Model Experience

不读取模型状态。生成提示词由 Host 侧 `@cinlan/git-ai-author` 构建；token 与 KV 缓存影响见该包说明。
