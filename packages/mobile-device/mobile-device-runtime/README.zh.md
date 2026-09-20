---
description: "通过私有存储与显式人工操作管理 Android platform-tools 和 scrcpy。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-runtime

[English](README.md) | 中文

## 概述

Host 独立于 Mobile Device 工具启用状态管理固定的官方 Android platform-tools 与 scrcpy 发行版。设置页可以安装、重新安装、更新到较新的已审查目录版本、移除托管文件，以及打开或关闭精确设备的镜像窗口。管理器不贡献模型工具。

## 目录

- [资源](#resources)
- [配置](#configuration)
- [执行与所有权](#execution-and-ownership)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="resources"></a>
## 资源

目录固定 Windows x64 的 Android platform-tools 37.0.1 与 scrcpy 4.1。发行 URL、大小、SHA-256 摘要及上游许可链接均固定在目录中。Google 仓库提供的 SHA-1 与下载归档核验后记录其 SHA-256；scrcpy 的 SHA-256 来自官方 GitHub release API。新发行版需要审查后更新目录。安装要求明确接受链接中的上游许可。归档保留上游文件及 notices；Harness 不发布捆绑第三方二进制。

下载进入私有暂存目录，严格核验完整大小与摘要，拒绝不安全归档路径和链接，并在发布前运行有界原生版本探测。持久 revision 保护原子替换。发布前取消或失败保留原 generation；提交开始后发布优先于并发取消。关闭设置页仅停止观察，不终止 Host 拥有的安装。取消必须指定精确任务回执。

托管资源 generation 位于配置的私有存储目录中。执行前验证完整文件 SHA-256 清单。跨 Host lease 文件阻止使用中的可执行文件被替换或移除。其他 Host 不猜测 lease 是否过期，也不擅自删除；崩溃 owner 的恢复需要操作人员核验。移除仅退役已拥有的托管 generation；操作系统保留已加载二进制时报告清理失败。不会删除自定义 SDK 路径或终止共享 ADB server。

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `storageDir` | Harness home/mobile/runtime | 私有不可变组件存储 |
| `commandTimeoutMs` | 10000 | 版本与连接探测期限 |
| `installTimeoutMs` | 600000 | 完整安装期限 |
| `processGraceMs` | 3000 | 所有进程范围退出宽限 |
| `maxOutputBytes` | 65536 | 每流探测输出上限 |
| `maxExpandedBytes` | 268435456 | 完整 ZIP 展开上限 |
| `maxArchiveFiles` | 1024 | ZIP 条目数量上限 |
| `lockWaitMs` | 3000 | 跨 Host 存储锁等待 |
| `mirrorPollMs` | 1000 | 精确连接身份复查间隔 |
| `downloadProxyUrl` | 空 | 显式 HTTP(S) 代理；不导入系统代理设置 |

ADB 选择顺序为 Provider 显式 command、保存的 SDK 根目录/platform-tools 目录/adb 路径、已验证的托管 platform-tools 可执行文件，最后 PATH。原生 ADB Provider 在完整操作和设备文件清理期间持有所选托管 generation。SDK 检查使用相同选择。安装托管资源后，自定义 SDK 仍然优先。

<a id="execution-and-ownership"></a>
## 执行与所有权

Remote 资源与镜像管理要求通过认证的 trusted-local Gateway 调用方；缺少 authority 或 delegated authority 时在派发操作前拒绝。资源状态、可执行文件版本及已授权设备连接是独立事实。Offline 或 unauthorized 设备不能启动镜像。

显式人工镜像请求选择精确 Android serial，并核验 transport 与 boot 身份。Harness 以固定 `ADB` 和 server 路径启动 scrcpy，禁用音频与设备控制，并持有两个可执行文件 lease 直至进程范围退出。连接监视在 transport 或 boot 身份变化时关闭所拥有的进程。镜像回执仅标识该进程；关闭它不会停止其他 scrcpy 或共享 ADB server。进程运行不证明画面已成功渲染。

<a id="model-experience"></a>
## 模型体验

通过现有 Mobile Device 工具间接影响模型，其 Provider 使用选定的 ADB 可执行文件；资源和镜像控制归本地人工设置页。

#### KV Cache 影响

资源状态、下载进度和镜像回执不进入模型请求；现有观察保留其格式及 Provider 无关指引。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 托管安装目前仅支持 Windows x64。Provider 在其支持平台仍可使用已有自定义 ADB。不支持 iOS 运行时管理。
- 模拟器镜像、模拟器启动、Wi-Fi 配对、应用安装及手机远程访问是独立能力。管理器不会安装大型模拟器镜像或连接未知设备。
- Android 需要 USB 调试及明确设备授权。真实镜像画面与输入验收需要连接已授权设备；空清单不代表设备验收。
- Android 不提供从 transport 核验到 scrcpy 启动的原子事务。启动前检查身份并在运行中监视；其他本地操作方仍可在检查之间影响设备。
- 操作系统加载的 ADB 二进制或孤立 lease 可能阻止移除。管理器报告失败并保留所有权元数据，不终止外部共享 daemon。

### 开发备注

不发布 invariant 配套入口：存储 revision 检查、验证清单、可执行文件 lease 与进程退出由对应操作执行。ZIP 解码使用 yauzl；原子发布使用现有 Harness atomic-write 工具。
