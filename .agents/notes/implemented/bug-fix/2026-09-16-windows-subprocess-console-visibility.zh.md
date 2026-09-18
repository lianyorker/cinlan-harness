# Agent Note: 在创建时隐藏 Windows 子进程控制台窗口

Status: implemented

[English](2026-09-16-windows-subprocess-console-visibility.md) | 中文

## 问题

GUI 宿主可以在没有附加控制台的情况下启动 shell 命令。私有 Windows Job runner 与其原生目标都会创建进程，因此任一次启动都可能打开可见控制台，导致后台工作期间短暂闪现窗口。

## 决策

私有 Node Job runner 使用 `windowsHide: true`。共享的普通进程与受限令牌进程创建在目标代码运行前，把 `STARTF_USESHOWWINDOW` 和 `SW_HIDE` 与标准句柄一起传入，包括匿名管道路径。控制台继承、恢复运行前的 Job 分配以及 stdin/output 归属保持不变。任何操作都不会隐藏已有父进程控制台，也不会抑制命令显式打开的窗口。

本实现适配官方 DeepSeek Harness 提交 [`f8b1309fe55ad29d54451886049d0c541be94d5a`](https://github.com/deepseek-ai/deepseek-harness/commit/f8b1309fe55ad29d54451886049d0c541be94d5a) 中的可见性改动。本地立即初始化的 Koffi 结构与现有 runner 协议继续负责实现；适配不添加上游控制描述符，也不改变绑定初始化。

[ACL 沙箱决策](../feature/2026-08-08-windows-acl-restricted-token-sandbox.zh.md)继续负责受限令牌策略与控制台隔离限制。[原生进程包含决策](../architecture/2026-08-28-subprocess-native-containment.zh.md)继续负责进程与 Job 归属。初始可见性设置没有取代这两项决策。

## 考虑过的替代方案

**只隐藏外层 runner。** 原生目标创建独立于 Node 的启动选项，因此也需要显式的初始可见性设置。

**移除每个进程的控制台。** 使用 `CREATE_NO_WINDOW` 或 `CREATE_NEW_CONSOLE` 的受限令牌创建已有 DLL 初始化失败记录。启动可见性保留控制台附加与继承的标准句柄。

**在 shell 启动后隐藏窗口。** 窗口可能在脚本执行前变得可见。创建时设置可避免这一时间区间。

## 验证

启动参数测试固定 runner 选项，以及普通、继承式受限令牌和管道启动的原生启动字段，同时保留创建标志与句柄清理检查。原生后代回归测试通过源码启动私有宿主，且只分离该宿主自身的控制台。使用普通继承 stdio 的后代必须保留控制台，并通过 `GetConsoleWindow` 与 `IsWindowVisible` 报告其处于隐藏状态。这样的隔离可防止已隐藏的测试宿主控制台掩盖缺陷：未修复时测试报告 `visible: true`。fixture（测试前置数据）在各受支持 Node 版本上使用现有 ESM 源码启动器，并在退出前等待 Job 完全停稳。

原生 ACL runner 套件在启用可见性标志的情况下验证两种文件模式、PowerShell 初始化、后代继承 stdio 与命名管道拒绝。C++ ABI 探针对照 Windows 头文件检查两个可见性常量。会话录制无法观察原生控制台窗口，transcript（文本记录）也没有变化；此回归由原生 Windows 证据负责。

## 后果

普通后台命令抑制附带的控制台窗口，同时保留后代控制台附加与进程清理。窗口可见性仍是初始请求，并不是阻止命令主动创建或显示窗口的策略。受限令牌下的控制台隔离仍不属于此改动。
