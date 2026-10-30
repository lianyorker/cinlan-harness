# Agent Note: Relay 部署与 Cinlan 身份是独立前提

Status: implemented

[English](2026-10-21-relay-deployment-account.md) | 中文

## 问题

内置 Director 地址不能证明操作者已部署私有 Relay。DeepSeek Platform 凭据不能证明账户页面所显示的 Cinlan 登录状态。推断任一事实都会启用不可用的连接方式，或将访问权限绑定到另一个账户。

## 决策

[手机 Host](../../../../packages/bundle/cinlan-remote-tunnel/src/host.ts)要求显式部署配置，并读取与 Cinlan 账户页面相同的 AccountController 投影。未配置的 operator 响应隐藏内部地址。已配置用户保留自定义 Director 和区域选择。新建 Host 使用本地模式；已保存的连接方式不被覆盖。

Cinlan 凭据记录变化会同步使 Relay 代次失效、关闭 Relay 连接并清理重连定时器与邀请。后续连接尝试和 Relay 请求读取当前账户投影。直连和已注册设备凭据保持不变。

## 考虑过的替代方案

**从非空 URL 或连接状态推断部署。** 此判断无法区分内置默认地址与已配置但离线的服务。

**在客户端永久禁用 Relay。** 这只隐藏不可用部署，既不支持已配置安装，也不能执行 Host 访问检查。

## 影响

操作者必须先显式配置部署才能启用 Relay，操作见[升级说明](../../../../docs/upgrade-guide/v0.2.1-alpha.1/cinlan-mobile-connection/guide.zh.md)。已存 Sub2API 凭据代表本地登录，不是额外的云端身份验证，也不能替代 Director 注册策略。

## 验证

Host socket 测试覆盖未部署、账户不匹配、退出与重连。客户端测试覆盖不可用、未登录及已配置状态；真实 Loader 测试覆盖凭据事件、旧读取和卸载。冷启动 Web 检查确认未配置说明只显示一次，内部地址隐藏。公网 Relay 和真实账户登录仍未验证。
