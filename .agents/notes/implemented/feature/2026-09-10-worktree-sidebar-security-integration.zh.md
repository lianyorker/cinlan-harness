# Agent Note: Worktree、侧边栏与安全迁移的 Web 组合

Status: implemented

[English](2026-09-10-worktree-sidebar-security-integration.md) | 中文

## 问题

迁移在旧 terminal 和右侧栏栈旁引入了 Worktree Task、Workspace Isolation、替代侧边栏与 Security Research 包。在默认 Web bundle 中挂载所有实现会重复声明右面板与终端服务；让所有 row 都保持未激活又无法说明哪些包可以安全发布。

## 决策

Worktree Task 使用 Git-backed provider 在 `ctx.worktreeTask` 提供服务，并通过类型化 Host Remote controller 暴露。生命周期请求使用 Provider 签发的不透明 task id，由该 owner 解析路径并执行。[程序捕获提案](../../proposed/feature/2026-09-18-worktree-task-lifecycle-hooks.zh.md)单独允许通过带 revision 检查的默认值配置未来任务，其验收仍待完成。创建接受来源仓库，生命周期调用不能替换 checkout 路径或程序。在完整选定该产品路径之前，Worktree Task 与 Workspace Isolation row 在默认 Web 组合中保持未激活。

Worktree Task 的 setup 与 cleanup 和 Git 操作共用受管子进程执行器。Provider 为新任务捕获已配置的可执行文件与 argv，仅在 setup 成功后发布任务，并在回滚前等待命令及进程树退出。Setup 只在创建时执行。Cleanup 只由显式归档或删除触发，休眠、容量回收和启动恢复不调用它。执行 cleanup 前持久化 running claim，回收 checkout 前持久化成功收据；失败或未结算 claim 保留 checkout 供审查。归档后再删除不重复成功的 cleanup，未合并分支保持已归档状态。共享的取消、输出和时限约束避免钩子进程仍在工作时释放 checkout；进程结算未知会阻止自动重跑。Setup 和 cleanup 的外部副作用无法通过 checkout 回滚撤销。

默认 Web bundle 仅挂载 `ui-better-sidebar` 作为右侧 shell。该插件拥有原生 PTY 操作、终端展示、文件界面与可选 agent terminal 工具。[终端生命周期决策](../architecture/2026-09-17-sidebar-terminal-lifetimes.zh.md) 将终端传输交由共享 Remote Controller 与 Client 工厂；被替代的 `ui-sidebar-right`、`ui-right-sidebar`、`dsh-terminal`、`dsh-terminal-bash` 和 terminal-controller row 保持未挂载。它的工具 Consumer 通过注入的 `ctx.tools.define` 编译定义并注册返回值，在不增加未分类 Host runtime import 的情况下保留 Tools Service Definition 的 schema 校验。

`security-research` profile 组合本地 Execution Host identity、本地持久化 Artifact 存储、assessment scope、Session finding 持久化、漏洞提供方与工具、Security Skills 和 workflow prompt 指引。其默认 assessment grant 不包含 execution host、target、action、egress rule 或 credential；操作者必须提供独立、明确的授权 patch。可选组合包通过 `AgentPresets.registerSystemRoot` 贡献只读 Agent 预设。未挂载该组合包时，通用 Web 名单保持不变。Settings 仅在 `agentPresets/list` 报告该 id 后注册安全研究，不通过通用 Skill 模块或 Settings 包自身名称推断。

## 结果

迁移包仍可独立安装，但默认 Web 进程只激活一套右侧栏与终端实现。生成的 Typert 声明和模型工具目录仍属于发布产物。没有可独立观察所属关系的包不发布 invariant companion，并在其 README 中记录原因。

范围服务从空 grant 开始；只有查询该服务的消费者才执行该 grant。profile 不会限制任意 shell 命令。Artifact 字节持久化到本地，侧边栏 Browser 页面只接受经过验证的 HTTP(S) 地址，不提供跨源 DOM 访问。Worktree checkpoint commit 使用稳定的服务 identity，代表提供方拥有的快照，不代表用户编写的 commit。

## 考虑过的替代方案

**同时挂载全部迁移实现与前代侧边栏 row。** 拒绝，因为这些组合声明相同的右面板与终端职责。默认 bundle 选择一套完整实现，而不是依靠 Loader 顺序消解冲突。

**每次生命周期调用都接受浏览器提交的 checkout 路径或任意命令。** 拒绝，因为 Provider 记录的任务拥有 checkout 和捕获的程序。配置未来默认值是独立的 revision 操作，不允许逐次调用替换。

**发布非空 assessment grant。** 拒绝，因为 profile 不能推断目标授权。随附 grant 拒绝所有评估操作，直到操作者提供明确的 host、目标、操作、egress 和证据策略。

**发布空 invariant companion。** 拒绝，因为 companion 必须检查可独立观察的所属关系；服务存在性和固定注册元数据不满足要求。

系统根目录贡献跟随注册方 Cordis fiber。随附与显式配置根目录保留优先级，隐式用户根目录位于插件贡献之后。撤回贡献只影响发现名单，不删除文件或已有 standing composition。

[原生浏览器与证据决策](2026-09-13-native-browser-and-security-evidence.zh.md)负责本地 Artifact 持久化和原生 Browser 组合。

## 相关决策

[右侧栏 docking 记录](2026-09-04-right-sidebar-docking-infrastructure.zh.md)、[tab 类型记录](../architecture/2026-09-05-sidebar-tab-types-and-navigation.zh.md)与[文件树记录](2026-09-05-sidebar-text-preview-and-file-tree.zh.md)保留前代 docking 栈的设计依据。本记录仅取代其中“这些包拥有默认 Web 组合”的事实。Workspace Isolation lease 语义仍由[隔离记录](2026-09-09-workspace-isolation-leases.zh.md)负责；Worktree Task 是独立的任务提供方，不扩展 Workspace 记录。

## 测试

Worktree Task、侧边栏、Tools runtime 与安全设置的 focused suite 覆盖各包行为。包依赖、Client package、Client UI 本地化、TypeScript path、package invariant、package README、工具目录和 Cordis profile 检查覆盖组合元数据。GUI 与 Web replay gate 在发布前仍是必需检查。

setup 回归用例断言 checkout 内写入、argv 保真、重新激活不重复执行、非零退出或任一输出流超限后的回滚，以及带真实后代进程的取消和时限退出等待。当前执行与验收证据归[验收记录](../../../plans/settings-native-acceptance-status.md)所有。
