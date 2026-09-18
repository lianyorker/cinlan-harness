# Agent Note: SSH 检查不建立远程 Session 权限

Status: implemented

[English](2026-09-17-ssh-inspection-authority.md) | 中文

## 问题

SSH 端点可访问，不能确定 Session 在哪里执行或可以使用哪些远程路径。保存别名、完成认证、收到 worker 问候分别证明不同事实。传输断开也不能证明操作已停止。将这些观测当作同一个已连接标志，可能误标本地执行，或让延迟响应影响替换后的连接。

## 决策

[目标所有者](../../../../packages/execution-host/execution-host-targets/README.zh.md) 将带 revision 的别名记录与活动连接实例分开。保存的目标 id 保持稳定；每个已接受的 worker incarnation 与连接 generation 标识一个活动对端。根目录引用和目录结果保留此标识。准入及响应处理拒绝已退役的 generation。

OpenSSH 通过既有配置别名拥有认证与主机信任。连接使用批处理模式、严格 known-host 检查，且不转发 Agent。固定远程命令调用受支持的 `dsh --profile execution-host` profile，由远程用户预先安装并配置。[独立组合](../../../../packages/bundle/execution-host-app/README.zh.md) 提供 worker 及其显式本地 Provider，不包含 Web 服务器、Agent 组合或模型凭据。

[Worker](../../../../packages/execution-host/execution-host-worker/README.zh.md) 在 Loader 提交后通过公开 AppReady 参与启动，并通过 AppExit 关闭。版本化 stdio 消息仅声明有界目录检查。导出根目录必须显式配置，默认为空列表。连接器先协商 incarnation，并成功检查实际导出的根目录，随后才报告就绪；问候或空根目录列表不满足此要求。

取消等待原 worker 操作结束并确认结果。截止时间或传输断开使确认不可得时，报告 outcome-unconfirmed。拆除保留清理所有权，卸载后阻止替换准入，并退役陈旧 worker。已完成取消 id 的保留有界，因此过期 id 不能证明历史结果。

[Controller](../../../../packages/api/execution-host-controller/README.zh.md) 与 [原生页面](../../../../packages/client/ui-settings-hosts/README.zh.md) 经现有认证 Remote 通道公开记录、显式连接操作和受根目录约束的检查。默认主机、切换确认及隔离行不保存偏好，因为没有远程 Workspace 或 Session 执行权限来消费这些值。既有 execution-host 来源服务继续标识当前进程；选择目标不会替换该标识。[可移植执行世界决策](2026-07-28-portable-execution-world-consumers.zh.md) 继续要求文件系统与子进程 Provider 属于同一执行世界；目标检查不安装或替换这些 Provider。

## 考虑过的替代方案

**将选中主机视为当前执行主机。** UI 选择不能迁移 Agent、重建其环境或授权其文件。将来源信息与目标选择分开，防止把本地工作标为远程。

**自动安装 worker 或开启额外 HTTP 监听。** 安装软件与定义远程导出范围需要独立、显式的部署选择。已配置 profile 与经过认证的 SSH stdio 使这些选择可见。

**在传输关闭时报告取消成功。** 连接丢失不提供操作结束证据。显式不确定结果保留 Host 实际知道的事实。

## 后果

SSH 目标管理不提供远程 Agent 调度、远程 Session 默认值、操作系统守护进程安装或通用远程命令执行。Worker 输出结果有界，但文件系统 Provider 在截断输出前会枚举整个目录。包含关系检查无法针对并发恶意路径替换保持原子性，因此配置根目录需要可信文件系统拓扑。精确限制与配置归包 README 所有。

验证使用原生 OpenSSH，连接具有独立私钥、known-host 文件和真实 worker Loader 组合的隔离服务器。不同目标标记、认证拒绝、根目录检查、generation 检查、取消结束、传输丢失不确定性及卸载均不联系用户服务器。Controller 组合覆盖经过认证的 Web、共享 Fetch 与 WebSocket 通道。受支持 CLI profile 及完整浏览器和桌面验证仍属于单独产物检查。
