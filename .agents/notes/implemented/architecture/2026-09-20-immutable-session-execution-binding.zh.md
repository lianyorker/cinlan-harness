# Agent Note: 不可变的 Session 执行绑定

Status: implemented

[English](2026-09-20-immutable-session-execution-binding.md) | 中文

## 问题

保存的 SSH 目标和成功的目录检查不能标识 Agent 使用的 provider。只记录路径的 Workspace 还可能混淆不同机器上的相同路径，而可变的全局选择器可能将既有 Session 的后续操作移到另一台主机。即使 Agent 的 Shell 位于远端，独立的文件系统、终端和 Git 消费者也会使这种歧义显现。

[可移植执行消费者决策](2026-07-28-portable-execution-world-consumers.zh.md)确立成对的文件系统与进程 provider。[执行世界路径决策](2026-09-11-async-sandbox-execution-world-paths.zh.md)确立异步准备与 provider 拥有的路径解析。两者继续有效：本决策增加持久选择和准入所有权，不替代这些 provider 规则。

## 决策

Workspace 拥有本地绑定或不可变 SSH 部署快照，以及规范目录。身份包含执行位置与目录。由执行感知组合准入的每个 Session 都在必读的执行事件中记录捕获的选择；既有已知且受执行管理的 Session 没有该事件时表示本地。不选择执行 Host 的 profile 保留原有本地 Session 生命周期。该事件独立于继续描述谱系的 Session origin。Session 持久化仍由控制端 Host 拥有，不会为了增加选择元数据而重写已提交的 JSONL 世代。

Agent 准入在挂载消费者之前获取捕获的部署。目标注册表在 setup 前预留授权，并排斥普通目标编辑与移除，直到同步发布提交或作用域回滚释放预留。发生竞争的变更返回可重试的 conflict，不会在持久事件写入后使目标失效。即使新日志已经能从存储读取，待发布的准入仍拒绝按 Session id 查找执行环境；只有对应的已发布 Agent 可以暴露准备好的租约。冷查找在每次 await 期间固定准入代次以及 Agent/provider 身份。代次变化会使查找重新开始或提供对应的已发布租约，因此在远程发布前捕获的空观察值不能随后选择本地执行。远程 provider 和消费者共享显式 Cordis 隔离标签；隔离服务不存在时，远程查找不能解析到本地 provider。动态 API 消费者使用租约和严格的上下文服务查找。相同快照可以共享连接与子进程所有权，而 Agent 的文件系统策略、Shell 默认值、PTC、Git 和终端注册表属于其私有执行作用域。

保留的租约标识一个连接实例，传递连接丢失，并在最后一个持有者释放后等待 provider 清理完成。活动 Session 操作保留准入时的上下文，不重新解析保存的目标。冷 Session 解析持久快照及记录的权限状态。断开会拒绝新工作并使回执失效，不会切换到本地 provider。Node、helper 和 PTC bootstrap 路径属于已验证的远程部署，不属于控制端可执行文件或源码树。

托管运行时激活保留显式记录的前驱配置，使升级前捕获的 Session 可以恢复。普通目标编辑清除这段历史；信任或凭据变化不会隐式授权旧快照。这一区分保留已安装世代，但不把每个历史目标修订号都视为有效。安装所有权与执行租约分离。

客户端创建 Workspace 只提交选定目录与目标 id/修订号。Host 捕获不可变部署并执行准入；客户端提供的部署字段不能绕过目标验证。UI 展示捕获的端点与修订号，使既有 Workspace 持续标识其拥有的部署。

## 考虑过的替代方案

第二套 Agent RPC 服务会复制 Session 权限主体、权限处理和重放。复用官方 provider 保留既有 Agent 循环与持久所有者。仅有 UI 的目标选择器缺少发布事务，会使 FS、PTY 和 Git 指向不同环境。只持久化目标 id 会让后续编辑重新定位既有 Session。保留全部目标历史会在普通编辑后继续保留过期的信任与凭据引用。

## 影响

Workspace schema 迁移显式且单调递增；兼容的前驱记录默认本地，不改变旧 Session 日志。远程 Session 准入需要理解执行环境的预设；在无法保留消费者所有权时拒绝替换远程预设。使用控制端路径语义的项目指令、文件系统技能发现、worktree 隔离和任务 provider 在实现其消费的远程执行语义之前拒绝操作。

验证采用生产 Loader 装配、真实目标存储与 Agent 准入，仅控制外部 SSH 对端。它区分本地和远程根目录，覆盖成对 provider、目标修订竞争、取消、断开与销毁，并比较持久选择和准入的 Agent 环境。部署的 helper、原生 PTY 与 PTC 执行仍需要独立的真实端点证据。Windows 传输 fixture 通过不代表支持 Windows 远程端点。
