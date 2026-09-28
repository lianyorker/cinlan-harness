# Agent Note: Sub2API 账户授权

Status: implemented

[English](2026-09-25-sub2api-account-authorization.md) | 中文

## Problem

Sub2API 账户凭据用于认证账户管理 API，而模型请求需要该账户签发的 API 密钥。把两者视为同一个凭据会把账户令牌持久化到模型路径、让提供方代码接触令牌，并在本地删除凭据时制造已经撤销签发方密钥的错误印象。

## Decision

Host 端 `llm-pi-ai` 插件只在注入 `dsh-authorization` 服务时，才在 `llm-pi-ai/sub2api` 下注册 `password` 流程。流程始终使用 `https://api.cinlan.online/api/v1`，请求 Cinlan 账户邮箱和密码；仅当登录响应要求双因素认证时才请求 TOTP 验证码。Account Settings 客户端把它呈现为一个 Cinlan 账户卡片；提供方与模型配置保持独立。流程不暴露二维码或设备登录接口；同一 Host 手机配对仍是由其配对界面负责的独立功能（[决策](../architecture/2026-09-20-same-host-phone-pairing.zh.md)）。

流程使用固定的 `https://api.cinlan.online/api/v1` 根，并调用 `/auth/login`、`/auth/login/2fa`、`/keys` 和 `/auth/logout`。创建密钥前先列出密钥，选择与已存值匹配或名称为 `Cinlan Harness` 且处于 active 状态的密钥；不存在可复用密钥时才用该名称创建。创建响应必须包含正的安全整数 id 和非空 key。

只把 `{ kind: 'api-key', key }` 写入 `llm-pi-ai/sub2api`。账户访问令牌与刷新令牌只留在内存中；流程在凭据 mutation 前校验返回的令牌，`finally` 代码块会把任何刷新令牌提交给退出接口。流程在列出密钥前、提交前及凭据 mutation 内部检查授权 signal。

提交失败或取消时，会为每次核对或删除请求使用独立且有上限的清理 signal，尝试删除新创建的密钥。只缺少 id 的响应可以通过返回的 key 值进行核对；无法读取的响应或没有安全标识的响应不会按名称删除，因为并发登录可能拥有该密钥。删除失败、所有权不明确、清理请求达到截止时间或刷新令牌退出失败会产生 `SUB2API_CLEANUP_FAILED`，并记录签发方可能仍保留残留状态。提交后的本地凭据读取不确定时也会报告清理失败，但不会删除密钥，因为无法确认本地所有权。授权服务会在流程的异步上下文中观察目标键的 `credentials/record-updated` 事件，并要求流程在该写入后调用 `session.commit()`。配置字段 `sub2ApiCleanupTimeoutMs` 限制每次补偿核对、删除密钥或退出请求，默认值为 10,000 毫秒。

Base bundle 在 `dsh-credentials-local` 和 `llm-pi-ai` 旁挂载 `dsh-authorization` 与 `dsh-api-account-controller`；web bundle 挂载功能自有的账户设置插件。控制器只投影已注册 flow 的元数据与凭据存在状态，为发起调用方提供私有 notice/prompt 流，并通过单向 Remote 命令接收 prompt 答案。按序列化后的 UTF-8 JSON 计算，完整快照最多为 256 KiB，单个帧最多为 64 KiB；32 帧队列只能丢弃 notice，并在控制帧无法容纳时关闭失败。Secret 答案在该命令之前只存在于组件本地；本地退出登录会说明它不撤销远程访问，并与同一键的授权操作串行化，包括已取消但 runner 尚未结算时继续保留的键。Account Settings 客户端只暴露固定 Cinlan flow，即使 Host 授权注册表仍可为其他组合保留 provider flow。Cinlan 账户流程不选择或配置模型路由；模型路由仍由显式的 `llm-pi-ai` 设置负责。

本决定扩展[凭据记录与授权流程说明](../architecture/2026-08-13-credential-records-and-authorization-flows.zh.md)中的通用凭据与授权所有权；该说明继续负责记录 union、流程结算和可选授权 seam。

## Alternatives considered

**把账户访问令牌或刷新令牌作为模型凭据持久化。** 这会把账户管理权限与模型网关消费的密钥混在一起，并使脱敏与轮换进入每次模型请求。流程只提交签发方 API 密钥。

**每次登录都创建新的远程密钥。** 本地删除不能撤销签发方密钥，因此重复登录会累积活动密钥。通过已存值或稳定名称列出并复用，使支持的流程面向单一密钥。

**把删除本地记录当作远程撤销。** 凭据服务没有签发方专用操作，不能声称远程密钥已撤销。流程只对失败尝试期间创建且能在不猜测并发所有者的情况下识别的密钥做尽力清理；清理未完成时明确报告残留状态。

**让账户登录配置模型路由。** 账户认证与模型路由由不同的所有者和生命周期负责。账户流程只保存签发方 API 密钥；模型路由仍由独立的 LLM 设置及其模型与协议契约负责。

## Consequences

成功登录不会把账户令牌写入设置、凭据诊断或 Session 数据。由于 Sub2API 的认证列表响应返回完整密钥，后续登录可以复用活动的签发方密钥。本地退出登录仍只删除本地记录；需要远程撤销时，操作员必须通过 Sub2API 撤销密钥。刷新令牌退出失败时，授权会以清理失败结束，而不会报告成功。

账户设置界面使进程内授权可达，但不会让尝试持久化。Prompt 期间进程或页面重启会取消调用方持有的流；runner 释放其保留键后才能发起新尝试，而不合作的 runner 会一直显示为忙碌，直到其结算或进程退出。服务器无限期失败或创建响应无法读取且没有安全标识后，远程密钥可能仍保持活动；错误码、UI 文案与日志明确表达此限制，而不是报告本地成功或签发方吊销。

## Verification

`packages/llm/llm-pi-ai/tests/sub2api.spec.ts` 覆盖固定 API 根地址、创建密钥、复用已存密钥、双因素登录、令牌、密钥列表和创建响应异常、缺少凭据、提交失败与提交状态不确定、缺少 id、删除失败、退出接口 HTTP 与超时清理失败、提交后通知失败及带远程清理的取消。`packages/llm/llm-pi-ai/tests/loader-composition.spec.ts` 通过 Loader 分别在有无授权服务时启动已发布插件，针对校验失败调用流程，并观察 pi-ai fiber 销毁后流程移除。`packages/api/account-controller/tests/controller.host.spec.ts` 覆盖 prompt 中继、无机密投影、UTF-8 输出的精确与超限值、控制帧队列耗尽、仅 HTTP(S) 的 notice 链接、取消、结算后命令拒绝、删除与授权串行化、仅本地删除、安全故障分类和卸载。`packages/client/ui-settings-account/tests` 覆盖流与一次性命令卸载、secret 遮蔽、attempt 身份帧拒绝、不吊销警告、安全链接和 Loader 组合。`packages/bundle/base/tests/base.spec.ts` 固定授权与 account-controller row 及依赖。
