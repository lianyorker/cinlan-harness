---
kind: upgrade-guide
description: "Cinlan Mobile 使用带版本的加密配对，以及直连或自部署 Director/Cell 路由。"
---

# Cinlan 手机连接

[English](guide.md) | 中文

## 变更

手机伴侣通过单一的直连模式（`local` 或 `lan`）或自部署 `relay` 模式连接 Web/Desktop Host。配对链接包含短时、单次使用票据；Host 只保存凭据摘要，并可独立撤销每台设备。Director 和 Cell 签发区域租约，只转发加密 WebSocket 帧，不读取应用消息。

手机监听器与本机 operator API 分离。它提供已构建的手机应用，并只接受带版本的配对、鉴权、会话、提示和审批协议。协议包含 Host 公钥 pin、nonce 上下文绑定、过期检查、重放检查、负载限制和连接绑定凭据。

## 部署

使用受支持的 `dsh` profile 启动 Host，或使用 `mobile-relay` profile 启动 combined、Director 或 Cell 节点。将 `stateFile` 放在私有的 `0700` 目录。Cell 必须设置 `directorUrl`；远程 Director 或 Cell 必须使用 HTTPS，开发局域网只有在显式启用 `allowInsecureNetwork` 时才能使用 HTTP。保持 operator API 只监听 loopback，只暴露手机监听器或 relay 端口。

在 Companion 设置中为每个 Host 配置一种连接方式。`local` 将手机监听器绑定到 loopback，`lan` 绑定到所选本地地址，`relay` 从配置的 Director 获取区域租约。不要把配对链接写入日志，也不要在显示的过期时间之后继续发放链接。

## 迁移

1. 用当前的 `cinlan-mobile-host` 和 `@cinlan/mobile-relay` 条目替换旧 PIN 或 room-manager 部署。带版本协议不提供旧 PIN 或旧 relay 兼容路径。
2. 为每个 Director 和 Cell 设置独立的私有 `stateFile`、区域 id、URL、容量和 enrollment 策略。在 Director 的 `regions` 列表中配置所有 Cell，并在 Host 配对前检查 `/health`。
3. 打开 Companion 设置，选择唯一的连接方式，设置机器名称和可选区域，然后让每个文本字段失焦保存。每台设备生成新的配对链接；旧链接不可复用。
4. 在将 LAN 地址暴露前，使用聚焦 Host/Cell 测试和浏览器 companion 场景验证设备撤销、重连、租约续期和 Cell 故障切换。

## 限制

当前 E2EE 握手 pin 长期 Host 密钥，不宣称等同 Orca 安全性或提供完整前向保密。保护 Host state 文件和浏览器存储；远程 Director 发现使用 HTTPS；手机丢失时立即撤销设备。
