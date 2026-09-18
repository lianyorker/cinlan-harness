---
description: "独立 stdio worker profile，通过经过认证的 SSH 对显式导出的根目录进行有界检查。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-execution-host-app`

[English](README.md) | 中文

## Summary

此独立组合包提供受支持的 `dsh --profile execution-host` worker。它挂载本地进程标识、文件系统与 subprocess Provider，以及有界执行主机协议。它不启动 Agent、模型适配器、HTTP 监听或 SDK Session 服务器。

## Table of Contents

- [使用 worker](#use-the-worker)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-the-worker"></a>
## 使用 worker

在目标端安装相同版本的 Harness，并在连接端 Host 配置 OpenSSH 认证与已知主机校验。[保存目标 owner](../../execution-host/execution-host-targets/README.zh.md) 通过保存的 SSH 配置别名启动固定 worker 命令，不接受任意远程命令。使用以下命令启动并检查随附组合：

```sh
dsh --profile execution-host --dump-default-config
dsh --profile execution-host
```

worker **默认不导出根目录**。在目标端的 `$DSH_HOME/profiles/execution-host/cordis.patch.yml` 中替换 `execution-host-worker` 配置，并保留所需限制：

```yaml
- id: execution-host-worker
  config:
    roots:
      - id: workspace
        label: Workspace
        path: /srv/workspace
    maxFrameBytes: 262144
    operationTimeoutMs: 30000
    maxEntries: 1000
    maxResultBytes: 131072
    maxConcurrentOperations: 16
    maxCompletedOperations: 256
```

使用目标端所属的现有绝对路径，Windows 使用原生 Windows 路径语法。远程根目录不会变成本地 Harness Workspace。[worker](../../execution-host/execution-host-worker/README.zh.md) 为每次检查校验包含关系与进程标识。标准输出仅用于协议帧；诊断写入标准错误。profile 与 home patch 只在启动时应用，不实时重载。

## Model Experience

无，因为独立 worker 不登记提示词、模型工具或 Session 事件，也不转发模型凭据或 Agent 权限。

#### KV Cache 影响

worker 不发送模型请求，也不创建缓存上下文。

## Known Limitations and Deferred Work

- 仅导出只读、有界目录检查。保存目标不提供远程 Session 或 Workspace 路由、通用命令执行、文件上传或设备控制。
- 空根目录表示实际未配置，并不允许检查登录目录。目标管理员必须显式选择导出的根目录。
- 受信任的 profile patch 可以扩展进程组合或破坏标准输出。应将专用 profile 限制在受支持的 worker 协议范围内。

<a id="dev-note"></a>
### Dev Note

组合包仅拥有静态组合。它不保留 worker 操作或连接状态的独立观测，因此不发布运行时 invariant 伴随模块。
