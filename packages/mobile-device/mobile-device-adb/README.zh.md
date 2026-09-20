---
description: "以精确 transport 定位实现原生 Android ADB 观察与输入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-adb

[English](README.md) | 中文

## 概述

本 Provider 通过已安装的 Android Debug Bridge 可执行文件直接实现现有 Mobile Device 服务。支持连接的 Android 手机与模拟器，不执行 Orca、不读取外部应用用户目录、不下载 SDK，也不声明支持 iOS。

## 目录

- [配置](#configuration)
- [观察与输入](#observation-and-input)
- [生命周期与限制](#lifecycle-and-limits)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

Mobile Device 服务选择 Provider id `adb`。`command` 可配置已有 adb 绝对路径或 PATH 命令；否则读取当前 `mobile-device.androidSdkPath`，接受 SDK 根目录、`platform-tools` 目录或 adb 可执行文件。保存路径为空时使用 PATH 中的 `adb`。每个操作固定其可执行文件选择，设置变化不能重定向设备文件清理。可执行文件缺失或配置无效时在输入前失败。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `adb` | 注册表 id |
| `command` | 空 | 已有可执行文件覆盖 |
| `cwd` | Host 工作目录 | 子进程目录 |
| `commandTimeoutMs` | 30000 | 每命令期限，包含可执行文件解析 |
| `graceMs` | 3000 | 进程范围退出宽限 |
| `cleanupTimeoutMs` | 5000 | 独立设备文件清理期限 |
| `maxOutputBytes` | 1048576 | 完整文本响应与观察上限 |
| `maxStderrBytes` | 65536 | 诊断流上限 |
| `maxImageBytes` | 16777216 | 完整 PNG 字节上限 |
| `maxImagePixels` | 16777216 | 解码截图像素上限 |
| `maxTextBytes` | 4096 | 原生输入文本上限 |
| `swipeDurationMs` | 400 | Android 滑动时长 |

请从 [Android SDK platform-tools 官方页面](https://developer.android.com/tools/releases/platform-tools)取得平台工具。Harness 使用已有安装，不重新分发二进制，也不编造版本化下载 URL。SDK `adb version` 成功证明可执行文件能够运行；`adb devices -l` 独立报告已连接 transport。设备发现可能启动标准 ADB server，本 Provider 不持有或停止该 server。

<a id="observation-and-input"></a>
## 观察与输入

设备 id 是精确 `android:<serial>` 选择器。清单保留 offline 与 unauthorized 记录并标记不可用；在线设备必须包含有效 ADB transport id。命令通过 `-t` 定位核验后的 transport，不选择任意默认设备。Generation 绑定可执行文件选择、transport id 与 Android boot id。每次变更在验证和发送前消费最新观察 token；重试需重新观察。Provider 内每设备保留操作名额，防止观察与输入重叠。

观察将唯一 UI hierarchy dump 写入 `/data/local/tmp/dsh-ui-<uuid>.xml`，读取后通过有界清理命令移除。同时读取显示尺寸、当前 activity，以及可选原始 PNG 截图。XML 验证关闭实体扩展；PNG 在发布前完整解码。坐标把归一化 `0..1` 映射到观察到的像素网格。输入发送前重新检查 transport、boot 身份、旋转与显示尺寸。Android 没有原子观察与输入事务；其他操作方仍可能在检查与输入间改变页面内容。

原生文本输入接受 ASCII 字母、数字、空格与 `@_.:,/+=-`；空格采用 Android input 编码。Unicode、shell 语法、百分号转义和超长文本明确失败，不转发文本。导航按钮包括 `home`、`back`、`power`、`recents`、`enter`、`menu`、`volume_up`、`volume_down`、`tab`、`delete` 和 `escape`。服务不提供应用启动、任意 shell 执行或包安装。

<a id="lifecycle-and-limits"></a>
## 生命周期与限制

所有命令使用 Harness subprocess 参数数组、有界原始 stdout/stderr、取消和进程范围终止。失败消息返回固定错误类别，不泄露 ADB stderr 或输入文本。销毁时拒绝新工作、取消命令、以独立期限尝试清理已拥有的 hierarchy 文件，并等待在途操作。设备断开或 Host 异常退出可能遗留唯一命名的 hierarchy 文件；不会读取或删除持久用户文件。

<a id="model-experience"></a>
## 模型体验

### 现有移动工具

#### 模型看到什么

官方 Mobile Device 工具提供 Android 清单、验证后的 hierarchy/当前 activity 文本、可选截图附件和单次观察 id。现有权限策略分类继续负责授权。原生输入限制返回明确错误；Provider 不额外注册工具或系统提示词。

#### Token 影响

观察 XML 与 activity 文本受 `maxOutputBytes` 限制；截图由工具 Consumer 附加。清单与变更确认保留现有 mobile 工具格式。

#### KV Cache 影响

Provider 注册与运行时观察不独立修改请求前缀。工具 Consumer 持有稳定的 Provider 无关指引。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 不提供 iOS、模拟器安装/启动、Wi-Fi 配对、应用管理或 Unicode 输入。[移动运行时管理](../mobile-device-runtime/README.zh.md)拥有托管 SDK/helper 安装与显式人工镜像；观察不会启动 scrcpy。
- UI hierarchy 可用性取决于 Android UI Automator 与应用可访问性；受保护画面可能无法截图。截图不证明 hierarchy 完整或可交互。
- 真实硬件截图与输入验收需要连接并授权设备。无设备清单检查成功不证明这些操作可用。

### 开发备注

不发布 invariant 配套入口：精确目标、generation、token 消费、字节限制及进程静默退出由各自操作执行。实现使用维护中的 ADB、fast-xml-parser 与 Sharp；本包未复制 donor 源码或第三方二进制。
