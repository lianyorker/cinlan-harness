# Agent Note: 原生 Android ADB Provider

Status: implemented

[English](2026-09-20-native-android-adb-provider.md) | 中文

## Problem

Mobile Device 需要不依赖其他应用运行时、云账号或用户目录的本地 Android 观察与输入。SDK 探测成功不代表已连接并授权设备，复用的 ADB transport 也不能继承旧观察 token。

## Decision

原生 ADB Provider 实现现有 Mobile Device 服务，保留官方工具与权限策略 Consumer。Mobile bundle 选择 Provider id adb。设备 id 定位精确 Android serial，命令定位核验后的 transport id。Generation 绑定可执行文件选择、transport id 与 Android boot id。变更消费一次观察 token，并在输入前重新核验身份和显示几何。设备变化不回退到其他已连接目标。

所有执行使用 Harness subprocess 参数数组，具备每命令期限、完整 stdout 上限、有界 stderr、取消及进程范围等待。观察拥有唯一命名设备 hierarchy 文件，并以独立期限尝试清理。每个操作固定可执行文件选择，避免并发设置变化重定向清理。输入文本与原始 ADB 失败内容不会出现在错误摘要中。

Provider 通过部署 command 配置或保存的 SDK 路径使用已有官方 Android platform-tools 安装，不分发二进制，也不编造安装源。Windows 只提供 Android；iOS 与模拟器启动仍不支持。独立移动运行时管理器拥有固定官方 SDK/helper 安装及显式人工 scrcpy 镜像。Web 设置与模型指引区分可执行文件存在和设备已授权。

原生资源管理器采用不可变 generation、完整文件 SHA-256 清单、原子 revision 比较及跨 Host 可执行文件 lease。Provider 观察/输入和 SDK/镜像操作在包含清理的完整生命周期内固定所选可执行文件。安装/移除/取消及精确镜像回执归通过认证的本地人工请求；delegated 或缺失 Gateway authority 被拒绝。托管存储不包含用户自定义 SDK 路径。scrcpy 明确接收选定的 ADB 与 server 路径，禁用设备控制和音频。

## Alternatives considered

**继续以外部应用 CLI 为默认。** 这使独立 Harness 部署依赖另一个运行时及配置。原生 Provider 直接调用 ADB。

**只按 serial 定位，不检查 transport generation。** 重新连接可能把旧观察关联到变化后的设备实例。因此重新验证 transport id 与 boot 身份；Android 仍无法提供原子的观察与输入语义。

**把任意文本传给 adb shell input。** ADB 会重新构造远端 shell 命令文本，Android input 也不普遍支持 Unicode。原生 Provider 接受文档列出的字面安全 ASCII 字符集、编码空格并拒绝不支持的输入，而不是修改内容后报告成功。

**仅检查 PNG 签名解析截图。** Sharp 完整解码检测损坏图像并限制像素；固定 IEND 标记检查同时拒绝解码器会接受的缺失尾部。XML 使用维护中的 fast-xml-parser，禁止外部声明并关闭实体扩展。

## Consequences

物理手机需要启用 USB 调试并明确授权 Host。设备发现可能启动共享 ADB server，Provider 不停止该 server。受保护截图或不可用访问性树可能失败。设备断开或 Host 异常退出可能遗留唯一命名 hierarchy 文件；正常取消仍使用独立调用信号尝试清理。未复制 donor 源码或二进制。

[设备 profile/就绪决策](../feature/2026-09-12-device-profile-and-provider-readiness.zh.md)继续负责能力分离与 profile 组合；本记录部分替换其移动 CLI 实现。[原生设置解析决策](2026-09-17-native-settings-runtime-consumers.zh.md)继续负责精确保存默认设备的选择。

## Verification

协议测试覆盖不可用设备、畸形身份与 XML、尺寸、activity 和完整 PNG 验证。Runner 测试覆盖字节限制、延迟可执行文件解析、取消、销毁、清理错误与可执行文件固定。Provider 测试拒绝旧 boot/transport/几何与不支持输入。真实 Loader 测试通过实际 Harness subprocess 服务与官方 mobile 工具运行受控外部 ADB 命令 fixture，包含权限拒绝与单次 token 消费；它不代表硬件验收。可选已有 ADB 真实测试只记录版本和清单。设备清单为空时明确缺少真实截图与输入验收。
