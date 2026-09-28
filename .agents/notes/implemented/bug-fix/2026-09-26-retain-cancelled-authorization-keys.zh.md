# Agent Note: 保留凭据键直到已取消授权 runner 结算

Status: implemented

[English](2026-09-26-retain-cancelled-authorization-keys.md) | 中文

## Problem

过去，授权取消会把调用方解析为 `cancelled` 并立即释放每凭据保留，即使 provider flow 忽略 signal 并继续运行。此时，账户设置可以删除本地记录或启动替代尝试，而脱离的 runner 仍持有有效的 `ctx.credentials` 能力。该 runner 的迟到提交可能在成功删除后重新创建记录，或覆盖较新尝试的结果。

## Decision

取消具有两个结算点。面向调用方的 `begin()` promise 会迅速解析为 `{ status: 'cancelled' }`，因此 Remote 流或页面关闭无需等待不合作的 provider。授权服务会另外把该键保留在 running map 中，直到 provider 的 `run()` promise 结算。在此期间，`list()` 与 `describe()` 保持 `inFlight: true`，另一次 `begin()` 返回 `ALREADY_IN_FLIGHT`，账户控制器等 consumer 也继续拒绝本地删除。

`authorization/settled` 现在只在 runner 结束且键已释放后触发。由于调用方已经收到取消结果，迟到的 runner rejection 会被处理并以 debug 级别记录；最终结算仍为 `cancelled`。注册表订阅者会观察到保留及最终释放，因此长生命周期界面能够更新，而不会把调用方响应时间当作资源静止时间。

本决定只部分取代[凭据记录与授权 flow](../architecture/2026-08-13-credential-records-and-authorization-flows.zh.md)中的撤销释放选择。该说明中的凭据所有权、调用方持有的交互和已观察提交规则继续有效。[Sub2API 账户授权决定](../feature/2026-09-25-sub2api-account-authorization.zh.md)把保留的占用应用于本地删除与替代登录。

## Alternatives considered

**等待 runner 后再解析取消。** 这会保留单一结算点，但忽略 signal 的 provider 会无限期阻塞发起方 Remote 流、页面卸载或进程关闭路径。调用方响应与键释放需要各自的完成信号。

**立即释放，并在 credentials 服务内拒绝迟到写入。** credentials 服务不拥有授权尝试，而 flow 会有意通过其普通 API 写入。给每个凭据 mutation 添加隐藏尝试 generation 会把存储 seam 耦合到单个 consumer，且仍需通过 provider 库传播权限。

**删除取消后提交的任何记录。** 键一旦释放，服务就无法把已取消 runner 的记录与合法并发写入区分开；本地删除也不能撤销签发方密钥。保留独占键才是可执行的排序规则。

## Consequences

取消后始终不结算的 provider 会让其凭据一直显示为忙碌，直到 runner 结算或进程退出。这优于在授权写入方仍能修改凭据时报告键空闲，并把响应 `AuthorizationSession.signal` 变成明确的 provider 义务。调用方仍保持响应；本地删除仍如实；替代尝试不会被脱离 runner 覆盖；settled 事件也继续保证其点名的键已经释放。

## Verification

聚焦授权测试使用明确的启动与完成 barrier，证明取消在 runner 完成前返回、键保持进行中、替代尝试被拒绝、settled 事件不会提前触发，并在 runner 拒绝后发生释放及 `cancelled` 结算。
