# 本地设备控制

[English](device-control.md) | 中文

## Prerequisites

使用包含 device-control profile 的构建。桌面控制需要支持 version-1 computer 协议的兼容 Orca CLI。移动控制需要对应 device 协议，以及可用的 emulator、simulator 或设备。Harness bundle 不安装 Orca、平台权限或设备镜像。

## Start an isolated profile

在不打开设备、不调用模型的情况下检查组合：

```sh
dsh --profile device-control --dump-config
```

启动其 Web 界面：

```sh
dsh --profile device-control
```

此 profile 使用标准 dsh 启动器，包含 Computer Use 和 Mobile Device bundle。普通 web 和 headless profile 保持不变。源码 checkout 构建完成后，以 `pnpm dsh` 代替 `dsh`。

## Configure the executable

Provider 行接受 `command` 可执行文件名称或绝对路径。默认是 `orca`，Linux 为 `orca-ide`。可执行文件不在 PATH 中时，在 profile 的 cordis.patch.yml 中设置此字段。覆盖行的完整 config 时保留已有 providerId。超时与大小限制见包 README：[Computer Use](../../../../packages/computer-use/computer-use-cinlan/README.zh.md) 和 [Mobile Device](../../../../packages/mobile-device/mobile-device-cinlan/README.zh.md)。

## Verify readiness

打开设置中的计算机控制或移动设备。重新检查会发起只读 Host 探测。未启用表示当前 profile 没有此能力；Provider 不可用会说明 CLI 缺失、响应不兼容、Provider 不可用或没有移动设备。Provider 已连接不代表允许发送输入。

所有观察与输入类别默认请求审批。操作前先观察，只使用当前 observation 标识，并验证操作后的状态。设置中显示的命令只启动 profile，不是安装器。

## Limits

本指南不把 fixture 测试通过当作真实平台自动化证明。使用输入工具前，请在目标桌面验证外部 CLI、OS 权限、应用焦点和模拟器状态。[Device control](../../../subsystems/device-control.zh.md) 负责就绪状态与生命周期语义。
