# Work Items

[English](work-items.md) | 中文

## 组合

[Work Items 包族](../../packages/work-items/README.zh.md) 将标准化读取和持久化写入与固定地址的 GitHub/Linear Provider 分离。[可选 bundle](../../packages/bundle/cinlan-work-items/README.zh.md) 为基于 base 的 Web profile 增加模型工具及 Web Remote/UI。

## 读取与本地关联

WorkItem 包含带 Provider 前缀的不透明 id、来源、标题、状态、HTTPS URL、标签、负责人及可选正文/时间戳。WorkItemPage 保留 Provider 游标和截断标记。选择时必须指定来源，或恰好只有一个可用 Provider；不可用或有歧义的配置会明确失败。

[controller](../../packages/api/work-items-controller/README.zh.md) 持久化显式 WorkItem/Workspace/Session 元组。已删除的 Workspace、已归档或不属于该 Workspace 的 Session 不能接收新关联。目标不可用时隐藏已有链接；删除并重建 Workspace 不复用旧身份。取消关联无需连接 Provider 即可清理过期本地记录。

## 写入状态

注册表持有不可变 WorkItemMutation 预览，并以 WorkItemWriteId 标识。Provider 写入默认关闭。启用后仍需独立的 prepareWrite 和 confirmWrite 调用；确认时重新检查范围及目标版本。回执跨顺序 Host 重启保留。

| 状态 | 含义 |
|---|---|
| prepared | 已校验预览，等待确认 |
| running | 已持久化发送标记；恢复时视为不确定 |
| succeeded | 已确认 Provider 回执 |
| failed | 已拒绝或尚未发送 |
| unknown | 外部操作可能已生效；绝不自动重发 |
| canceled | 未执行的预览已取消 |
| expired | 确认前预览有效期已结束 |

## 限制

[服务](../../packages/work-items/work-items/README.zh.md) 定义边界值、错误和持久化写入语义。[Settings UI](../../packages/client/ui-work-items/README.zh.md) 展示已有工单与显式本地关联，不创建 Session 或 worktree。凭据保留在 Host。
