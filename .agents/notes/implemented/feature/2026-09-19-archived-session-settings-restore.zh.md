# Agent Note: 归档 Session 恢复保留 Workspace 状态所有权

Status: implemented

[English](2026-09-19-archived-session-settings-restore.md) | 中文

## 问题

已归档 Session 需要易于找到的恢复操作，同时保持历史、Workspace 顺序和当前对话不变。客户端也可能在较新的恢复或推送基线之后收到较旧的归档响应，使已恢复的行再次呈现为已归档。

## 决策

[已归档会话设置页](../../../../packages/client/ui-settings-unarchive-sessions/README.zh.md) 拥有独立的个人分组菜单条目、本地化的公开搜索元数据，以及列表、搜索和恢复操作。它使用现有设置外壳与共享控件。页面将归档 id 与已加载的 Session 摘要及 Workspace 成员关系关联；缺失摘要不产生行。[功能导航决策](../architecture/2026-09-19-feature-settings-navigation.zh.md) 继续负责通用菜单策略。

恢复遵循 `uiWorkspace` → Workspace Controller → Workspace Registry。注册表将现有归档集合中的移除操作与其他写入串行化，保留 Workspace 成员关系及顺序，仅在持久写入成功后发布。不存在的 id 无需写入便成功；移除不需要检查 Session 是否存在。恢复从不打开 Session 正文，也不改变日志代际。已发布的 Session 格式 3 及其已提交文件保持不变。

Client 模型为归档与恢复请求共用一个序号。后续请求、推送的归档集合或替换基线会取代较旧的一元响应。恢复更新可观察归档集合，不会选中或打开恢复的 Session。

## 考虑过的替代方案

**恢复时打开 Session。** 恢复属于可见性操作。将其与导航合并会替换当前对话，并为设置页增加无关操作。

**重写 Session 数据或移除 Workspace 成员关系。** 现有归档集合已经负责可见性。重写历史或成员关系会改变独立的持久数据，并丢失记录的位置。

**安装每个成功的一元响应。** 较旧响应可能晚于较新的归档状态到达。接受它会暂时撤销已完成的恢复。

## 后果

恢复的 Session 通过现有归档过滤视图重新出现，当前选择保持不变。页面无法恢复已加载 Session 列表中缺失的归档 id；注册表调用者仍可移除该 id。聚焦测试覆盖持久化、幂等性、成员关系不变、流更新、请求竞态、搜索、本地化与贡献释放。浏览器恢复路径需要匹配的 Workspace Remote 生成产物，以及挂载该页面的组合。
