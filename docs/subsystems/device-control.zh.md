# Device control

[English](device-control.md) | 中文

## Composition

可选的 `device-control` profile 在普通 base 与 Web bundle 之上叠加 [Computer Use bundle](../../packages/bundle/cinlan-computer-use/README.zh.md) 和 [Mobile Device bundle](../../packages/bundle/cinlan-mobile-device/README.zh.md)。通用 `web` 和 `headless` profile 不会获得设备输入能力。[用户指南](../user/develop/practice/device-control.zh.md) 负责启动和配置说明。

## Observations and permission

[Computer Use](../../packages/computer-use/computer-use/README.zh.md) 使用应用、窗口和 observation 范围内的元素标识。操作消耗新鲜 observation 并返回操作后的 observation。[Mobile Device](../../packages/mobile-device/mobile-device/README.zh.md) 使用精确设备 id、归一化坐标、runtime generation 和一次性 observation token；修改后必须显式重新观察。

工具 Consumer 通过既有 tools 和 system-prompt 服务注册 schema 与稳定模型指引。所有观察和操作类别默认 ask。执行 guard 防止先执行的工具 listener 静默绕过配置策略。截图使用既有 Attachment 服务；输入文本不会在结果摘要中回显。

## Runtime readiness

[就绪控制器](../../packages/api/device-capabilities-controller/README.zh.md) 拥有 `deviceCapabilities/check`。它调用桌面 Provider 的 capabilities 方法或移动设备 Provider 的设备列表方法；既不发送设备输入，也不返回设备身份。

| Status | Meaning |
|---|---|
| `not-configured` | 当前 Host 未挂载所选服务 |
| `available` | 只读 Provider 探测成功；移动设备还须报告至少一个可用设备 |
| `unavailable` | Provider 无法选择、解析或探测，或者没有可用的移动设备 |

`reason` 是脱敏类别，不是 Provider 原始 stderr。Loader 激活、软件安装、Provider 就绪与操作权限是不同事实。[Settings 插件](../../packages/client/ui-settings-security/README.zh.md) 保留这些区别，并显示有效的 profile 启动命令，而不是没有实现的安装命令。

## Lifecycle

Provider 仅缓存成功的 executable 解析。CLI 缺失时，安装 CLI 或修复 PATH 后可直接重新检查，不需要重启 Host。调用方取消和插件卸载都会中断正在进行的 executable 查询及命令。CLI 失败不会阻止 Settings 外壳加载。外部 CLI 缺失属于明确的前置条件失败，不会返回占位成功。
