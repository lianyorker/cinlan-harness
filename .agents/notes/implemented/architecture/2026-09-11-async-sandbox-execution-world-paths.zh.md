# Agent Note: 异步沙箱准备与执行世界路径

Status: implemented

[English](2026-09-11-async-sandbox-execution-world-paths.md) | 中文

## 问题

限制解析可能需要在命令运行的文件系统与进程环境中执行异步工作。同步 argv 包装器无法表达这种准备及其取消。若前台截止时间在准备完成后才开始计算，命令的一部分就没有时间上限；若在准备结束前发布后台进程，取消操作就缺少完整的责任方。

工作区路径也属于该执行环境。在宿主侧规范化可能检查错误的文件系统，而对 `symlink/..` 做词法归一化可能选中与进程实际进入位置不同的目录。

## 决策

[沙箱提供方](../../../../packages/sandbox/sandbox/README.zh.md)公开 `confine(argv, policy, signal?): Promise<ConfinedArgv>`。消费方在 spawn 前等待准备，并向其传递取消信号。[Shell 执行器](../../../../packages/shell/shell/README.zh.md)公开 `start(spec): Promise<ShellProcess>`；`resolve(request)` 保持同步，在执行前应用默认值与策略。

同一前台截止时间覆盖限制准备、spawn 和执行。若在 spawn 前超时，返回 `timedOut: true`，输出为空、退出码与信号为 null，沙箱信息包含所选模式和 `denied: false`，不附带强制执行证据。仅完成准备不能证明 runner 实施了任何限制。限制准备期间的调用方取消会 reject，取消后才到达的准备结果不能启动命令。

原生启动完成前，子进程句柄就可能已经存在。当其 `done` 以当前截止时间信号的同一个中止原因 reject 时，本地 shell 执行器会在不传入已取消信号的情况下等待 `waitForExit()`，再返回超时或中止结果。无关失败与清理观测失败会继续传播；截止时间结果不会先于所管理进程范围的静止状态返回。

通用 `JobStart.run` 保持同步。[Bash](../../../../packages/shell/tool-bash/src/background.ts) 与 [PowerShell](../../../../packages/shell/tool-pwsh/src/background.ts) 的 `processJob` 适配器返回负责异步准备、取消、输出与结算的 hooks。取消会中止准备；任何延迟出现的进程句柄都会被终止，并在任务结算前等待其结束。子进程提供方 reject 时，本地后台执行器保留 `killed`、诊断与沙箱分类，然后不带信号地等待 `waitForExit()`，再结算 `ShellProcess.done`。退出观测失败会使 `done` reject；`processJob` 报告任务失败。后台工作没有执行器超时。[终端启动](../../../../packages/terminal/terminal-bash/README.zh.md)也会使用 open 信号等待限制解析，并在 spawn 终端前再次检查取消。

[沙箱策略](../../../../packages/sandbox/sandbox-policy/README.zh.md)原样保留执行世界的绝对工作区根目录，并拒绝相对的配置根目录。实施限制的提供方在文件所在环境中解析文件系统身份。[Bash 工具](../../../../packages/shell/tool-bash/README.zh.md)追加相对工作目录分量时不折叠符号链接或 `..`，且在 Harness 运行于 Windows 时保留 POSIX 根目录与分隔符。

## 考虑过的替代方案

**保持限制解析同步，或在准备完成后才开始计算截止时间。** 异步提供方需要可取消的准备，且准备与执行消耗同一前台时间预算。

**将通用任务准入改为异步。** Shell 工具已经负责 shell 准备。同步任务 hooks 可以负责其完整生命周期，无需改变其他任务生产方的准入。

**在共享策略中规范化路径，或在 Harness 宿主上归一化相对工作目录。** 只有执行提供方了解文件系统身份；保留路径分量可以避免改变依赖符号链接的遍历结果，或将 POSIX 根目录解释为 Windows 路径。

## 影响

提供方与消费方显式等待准备，请求解析与任务准入则保持既有职责。每条已 spawn 的命令保留自身的强制执行事实。本地 runner 选择、同步探测、Windows ACL 授权、私有临时目录权限与部分强制执行报告继续由提供方负责；异步签名不会使同步本地工作变得可抢占。

[可移植消费方决策](2026-07-28-portable-execution-world-consumers.zh.md)、[共享策略决策](../feature/2026-07-14-cross-family-fs-sandbox.zh.md)、[Windows 沙箱决策](../feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md)与 [SSH 提供方决策](2026-09-11-posix-ssh-runtime.zh.md)各自的架构和平台理由仍然有效。本文负责通用准备时序、取消与路径保留。

## 验证

所需证据区分准备期间的超时与调用方取消，拒绝取消后的延迟 spawn，保留逐进程强制执行事实，并证明前台取消会等待所管理的进程范围静止，任务取消会等待延迟句柄结算。后台提供方失败需要证据证明结算前所管理的进程范围已经静止，且退出观测失败时会 reject。路径证据覆盖拒绝相对配置、保留符号链接和父目录分量，以及 Windows Harness 上的 POSIX 根目录。源码测试与构建产物检查分别需要执行证据；原生 runner 行为需要特定平台的证据。
