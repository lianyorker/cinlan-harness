---
description: "通过显式启用的 HTTPS 手机配对连接现有桌面 Host 与 Session。"
kind: "package-reference"
---

# @deepseek-ai/dsh-remote-access

[English](README.md) | 中文

## 概述

本包负责直连 HTTPS 监听器、一次性配对邀请、持久化设备授权以及限定 Session 的 Gateway 策略。桌面端通过类型化 RemoteAccessHost 能力提供现有更新准入和配对页面资源。本包不启动第二个 Host 或 Session 写入者。

## 配置与权限

监听器默认关闭。本地启用前应设置 host、port、advertisedOrigin、tlsCertificatePath 和 tlsPrivateKeyPath。缺少 TLS 路径或 Host 能力时，状态为 not-configured，且不打开端口。配置证书的日期、主机名、密钥或地址无效会使启用失败。公开 origin 必须使用 HTTPS；转发请求头不会改变它。配置还限制邀请有效期和尝试次数、凭据有效期、请求字节数与超时、连接数、逻辑流数，以及排队事件的帧数与字节数。

本地 Gateway 调用创建邀请，明确指定 Session 引用和读取、发送、停止、问题回答及审批权限。兑换只消费一次配对码，并仅持久化随机设备凭据的摘要。凭据通过带 Secure、HttpOnly、SameSite=Strict 属性的主机 cookie 传送。到期和持久化撤销会终止活动请求与流。设备元数据不包含凭据值或摘要。

委托策略在解析提供者前授权端点参数，裁剪 Session 汇总，在投递前过滤通知和待处理交互，并将事件回答绑定到已认证设备。原始 Fetch 资源及无关 Host 方法均被拒绝。原有审批和问题所有者保留策略、竞态结算和 Session 审计责任。

## 模型体验

通过现有 Session 命令间接影响模型，这些命令接收获授权的手机消息和交互回答，不扩大请求 Agent 的审批策略。

#### KV Cache 影响

配对和重连不改变模型历史或缓存键。模型可见的变化仍由现有 Session 命令负责。

## 已知限制与后续工作

直连客户端为手机浏览器；签名 Android、iOS 包和实体设备配置属于独立交付。显示证书指纹不会让浏览器信任自签名证书。应部署可信证书，或通过操作者控制的流程配置合适的私有 CA；不会关闭证书验证。

初始授权范围包括文本提示、历史、流式输出、停止、问题和审批。文件上传、任意文件读取、队列编辑、子 Agent 控制及 Host 管理需要独立授权工作。关闭监听器属于运行时状态；持久化部署配置若仍为启用，下次 Host 激活时可以再次启动监听。

本包不发布 invariant 配套入口：认证时对照持久化凭据记录检查授权有效性，每个活动能力持有自身到期及撤销信号，不另行维护独立观测值。
