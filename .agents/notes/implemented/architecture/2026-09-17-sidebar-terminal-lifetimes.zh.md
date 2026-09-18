# Agent Note: 侧栏终端进程与传输 scope 具有不同生命周期

Status: implemented

[English](2026-09-17-sidebar-terminal-lifetimes.md) | 中文

## Problem

终端标签、原生进程和当前流连接可以分别消失。把标签 id 当成进程 id，会让延迟关闭请求杀死替代进程。经私有 WebSocket 路由关闭还会让本可运行的原生终端依赖 HTTP 服务器；不等待 Client disposer 则会让旧激活在替换后继续持有传输操作。

## Decision

侧栏原生 Provider 拥有 PTY 创建、保留输出、输入、尺寸调整、确认、停放与终止。[侧栏终端 Service Definition](../../../../packages/terminal/sidebar-terminals/README.zh.md) 独立于 Web 服务器公开这些操作。经过身份验证的 [Remote Controller 与 Client 工厂](../../../../packages/api/sidebar-terminal-controller/README.zh.md) 在 Web 和 Desktop 中使用已有 Connection 通道。UI 登记向终端视图注入普通回调；功能 UI 不导入 Gateway 运行值，也不拥有第二套传输。

UI 终端具有 Session/标签目标、原生进程 id，以及独立的流 attachment id。重新附加到存活进程会更换 attachment，不会让旧 attachment 获得对替代进程的权限。输入、尺寸、额度和 release 操作指向已准入的 attachment。显式 UI 关闭必须提供精确的原生进程 id。Client 没有缓存进程 id 时，先执行只读检查；检查不能创建、取消停放、调整尺寸或延长保留时间。因此，过期或不存在的进程不会让关闭操作创建或终止另一进程。Agent 终端关闭保留其独立分配的终端 UUID。

内置终端标签的关闭钩子即使在渲染器从未挂载时，也调用对应的 UI 或 Agent 操作。标签注册表的关闭通知是同步的，因此异步关闭被拒绝时记录诊断，不产生未处理拒绝，也不声称原生终止已经完成。关闭流会释放其 attachment；显式进程关闭和 Host 拆除各自保留原生所有权。

每次侧栏 UI 激活从 Client 工厂取得一个传输 scope。scope 拆除保存同一 Promise，并持续被跟踪直到结束。Provider 撤回工厂时关闭准入并中止生命周期，然后等待所有活动或正在拆除的 scope；失败保留在聚合结果中。UI 拆除也等待自己的 scope。这样，并发 UI 拆除、Provider 卸载和重新初始化都保留清理责任。

终端输出采用带确认的有界帧。原生 owner、Controller 队列和通道分别限制自己保留或发送的完整值，包括各自的元数据。JSON 转义控制字符时，回放文本会显著膨胀；不能用未转义字符数推算容量。既有原生回放上限与默认传输限制允许完整保留记录通过真实身份验证的确认流程。取消和正常退出都会结束 iterator、Controller 操作及通道资源。

旧终端 WebSocket 端点和缺少校验的 JSON 关闭操作已移除。这些操作只有一条生产路径，调用方不能选择其他路由绕过原生进程标识检查。Desktop 保留 Web bundle 的唯一侧栏选择及重复 bundle 既有的自禁用规则；不为取得终端能力启动 HTTP 监听。

[侧栏组合决策](../feature/2026-09-10-worktree-sidebar-security-integration.zh.md) 继续拥有唯一侧栏和终端实现的选择。[可移植执行世界决策](2026-07-28-portable-execution-world-consumers.zh.md) 继续拥有核心文件系统/子进程一致性与终端清理。两者均不被取代；本文规定侧栏的进程标识与传输生命周期。[浮动工作区决策](2026-09-17-floating-workspace-command-ownership.zh.md) 拥有捕获的窗口/Session 目标。

## Alternatives considered

**仅按 Session/标签关闭。** 延迟请求可能在同一逻辑标签下找到新进程。关闭进程的操作必须检查原生标识。

**通过连接终端发现关闭对象。** 连接可能创建进程、取消停放或刷新保留期限。只读检查获取既有标识，不产生这些效果。

**同时保留私有 WebSocket 与 Remote 实现。** 独立的准入、身份验证、清理和关闭规则可能分歧。已有通道让两个应用使用同一组终端操作。

**在清理结束前丢弃正在拆除的 scope。** 后续 Provider 卸载会遗漏该等待操作，在它仍持有工作时报告完成。被跟踪并保存同一 Promise 的拆除让双方取得相同结束结果。

## Consequences

保存的 Shell 设置在下一次侧栏 UI 或 Agent PTY 创建时应用；实时 xterm 偏好影响当前渲染器。这些设置不改变核心 Shell 工具，也不在 Host 重启后恢复进程。能力探测在不启动 PTY 的前提下报告传输和原生 Provider 的可用性，并不保证之后的可执行程序启动成功。

真实 Loader 测试覆盖工厂发布、撤回、并发拆除和重新初始化。原生与 Controller 用例覆盖标识校验、无缓存关闭检查、缺失依赖与清理。默认通道用例通过原生尺寸的 DTO 帧、真实身份验证 ACK、正常退出及完整拆除，还原含控制字符的全部保留记录。UI 关闭测试覆盖未挂载渲染器和失败诊断。这些观察证明 owner 行为；整包 Web 与 Electron 检查仍负责证明应用集成。
