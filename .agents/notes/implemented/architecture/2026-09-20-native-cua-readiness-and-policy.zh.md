# Agent Note: 原生 CUA 就绪状态与权限策略

Status: implemented

[English](2026-09-20-native-cua-readiness-and-policy.md) | 中文

## Problem

已注册的桌面 Provider 不能证明 SDK 发现已经完成。原生 Cua Driver 工具不实现 facade 能力描述符，只识别六个 facade 工具名称的策略无法检查原生调用。Settings 需要真实的生命周期信息，不能据此宣称操作系统权限已授予或桌面输入成功。

## Decision

[电脑操作服务](../../../../packages/computer-use/computer-use/README.zh.md)在独占注册时接受可选的就绪回调。其就绪结果区分 Provider 拥有的工具目录与 facade 能力。缺少回调时报告 initializing。原生 Provider 仅在非空目录发现、工具注册和提示词注册完成后发布 ready。卸载立即撤销对外就绪状态；关闭失败保持 failed 并保留电脑操作占用，直到证实资源静止。启动失败后的成功回滚会在清理后释放占用。

[设备控制器](../../../../packages/api/device-capabilities-controller/README.zh.md)暴露可判别的电脑观察结果与脱敏生命周期原因。目录就绪、操作系统权限、审批和观察到的动作成功是独立事实。原生权限保持 unknown。CUA 工具保留上游 schema 和结果，不虚构 facade 动作 DTO。

[能力设置](../../../../packages/client/ui-settings-security/README.zh.md)将工具目录生命周期与权限状态分开显示。服务提供者启停控制使用精确配置的 Loader 条目 id 调用官方插件管理器，并显示其应用结果。设置不引入第二套启用标志或审批系统；启用服务提供者不会执行桌面输入。

[权限策略](../../../../packages/computer-use/computer-use-permission-policy/README.zh.md)对每个以 cua_driver_native__ 开头的工具应用统一的 native allow/ask/deny 决策，默认 ask，并覆盖未来新增工具。官方 pre-execute 决策与 monotonic executor guard 为同一次精确执行共享票据。更早的 waterfall allow 无法绕过 ask 或 deny。四个 facade 策略类别继续受支持。

[bundle](../../../../packages/bundle/cinlan-computer-use/README.zh.md)选择 cua-driver-native，仅挂载服务、策略与原生 Provider。SDK 固定为 @trycua/cua-driver 0.28.0，通过 npm 平台依赖分发，不引入独立 downloader、Orca CLI 或原生服务。显式的[公开实验包例外](../../../../scripts/experimental-package-policy.ts)允许发行组合，但不承诺上游工具稳定。

[注册决策](2026-09-12-computer-use-provider-registration.zh.md)保留桌面独占与共享桌面理由。[兼容性决策](2026-09-20-cinlan-cua-driver-compatibility.zh.md)保留 facade 和 MCP 生命周期归属。本记录仅取代其中的原生组合与策略事实。[设备就绪决策](../feature/2026-09-12-device-profile-and-provider-readiness.zh.md)保留移动设备、Settings 和 profile 归属。

默认 Web 与 Desktop profile 组合 Browser 和 Computer Use bundle，再应用[纯配置默认层](../../../../packages/bundle/web-capability-defaults/README.zh.md)，精确禁用 `browser-playwright` 与 `computer-use-cua-driver-native`。服务、管理、策略和已配置条目身份仍可供设置使用。用户 profile 补丁位于该层之后，因此官方插件管理器启用可覆盖默认值，无需第二套启用标志。显式 `browser` 与 `device-control` profile 保持提供方启用；Mobile 组合不变。已安装 Web 的精确 `[base, web-app]` 元组升级至默认栈，不重写用户补丁。Desktop 通过现有已验证暂存事务升级其拥有的内置前缀，保留已安装第三方 bundle 和补丁字节；相同发布版本在默认值不同时仍会协调。

## Alternatives considered

将 providerName 视为 ready 会在发现和卸载期间报告可用。将 CUA 映射为 facade 动作请求会丢失上游语义，且没有 Consumer 需要此转换。固定原生工具允许列表会使未来 SDK 工具缺少执行检查。当前证据不支持用自有 Windows Provider 替换 SDK：固定版本 SDK 发布 Windows x64 和 arm64 包。

## Consequences

主机拥有进程内原生运行时并承担原生崩溃风险。Windows 要求已登录的图形会话；UIPI 与上游后台拒绝仍有效。拒绝不授权前台重试。取消无法撤销已交付的输入。Wrapper 使用 MIT 许可；平台 payload 声明 MIT AND MPL-2.0，并保留 UniFFI N-API runtime notice。分发必须保留原生文件、notice、可选依赖和相对加载路径；这些细节由 [Provider 要求](../../../../packages/experimental/computer-use-cua-driver-native/README.zh.md)负责。

## Verification

服务、策略、API 和原生 Loader 测试覆盖就绪发布、默认审批、原生执行前拒绝、目录校验、取消及卸载期间的占用保留。Mock SDK fixture 验证这些集成行为，不证明桌面操作成功。通过 Harness Loader 的受控 Windows GUI smoke 与打包后的原生加载仍须单独验证；仅发现目录不能证明任何一项。
