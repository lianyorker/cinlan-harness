# Agent Note: Liveshare Work Items Provider 授权

Status: implemented

English | [中文](2026-11-07-liveshare-work-items-provider-grants.md)

## Problem

Liveshare 查看者使用独立的 `share-viewer` Peer 和 Remote access policy。手机配对来源白名单不会授权该 Peer，而 Work Items Provider 读取此前对所有分享查看者均为 owner-only。

## Decision

所有者为每份分享独立选择 Work Items Provider 来源。选择保存在 Owner 分享记录中；字段缺失时不授予任何来源。`workItems/list` 与 `workItems/get` 声明 Provider resource，viewer policy 只对所选来源绑定这两个 action。每次 Gateway 判定都会读取 Owner 当前记录，因此撤权持久化后下一次调用即失去访问。关联投影还要求当前 Peer 拥有 Workspace grant；返回 Session id 和 worktree 元数据还要求该 Peer 拥有 Session grant。关联变更以及外部写入预览、确认、取消和历史仍为 owner-only。

## Alternatives considered

**复用手机 tunnel 来源授权。** tunnel 和 Liveshare 使用不同的 Peer 身份、准入流程与生命周期记录。共用授权存储会跨越授权域，并使一个界面的撤权语义影响另一界面。

**只要分享授予 Work Items endpoint 就开放全部 Provider。** endpoint 级授权没有表达所有者想分享哪些已配置 Provider 数据。Provider resource 保留最小权限，并允许所有者独立撤销某个来源。

**为新增 Provider 选择功能之前写入的记录推断授权。** 旧记录创建时没有 Provider 授权决策。将缺少字段解释为空集合，可使旧记录继续保持私有，直到所有者明确选择来源。

## Consequences

所有者分享弹窗增加五个 Provider 复选框，并与其他分享权限一起保存。Provider 来源 ID 持久化为已知的有限集合。查看者只能读取和刷新已选来源；Gateway 仍拒绝关联变更与外部写入端点。Workspace 和 Session 元数据仅在当前 Remote 调用允许访问相应资源时投影。真实 Liveshare browser composition 验收仍待执行。

## Verification

Host 测试覆盖逐分享来源持久化、已选和未选 Provider 的判定、撤权、非法来源拒绝，以及所有关联和外部写入 action 的拒绝。Client 测试覆盖选择和保存 Provider。Work Items Controller 测试覆盖 Workspace 与 Session 元数据投影。真实浏览器 composition 验收归档到任务计划前，须运行包类型检查和定向测试。
