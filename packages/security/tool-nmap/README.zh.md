---
description: "面向授权评估的 nmap 端口扫描模型工具。"
kind: "package-reference"
---
# @cinlan/tool-nmap

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `nmap_scan` 工具。它通过 `ctx.subprocess` 调用本机安装的 `nmap` 二进制，把 `-oX -` XML 输出解析为有字节上限的结构化主机/端口/服务结果，且永不携带 `--script` 参数。授权由上游 `assessment-scope-tool-policy` 强制：`target_id` 必须匹配当前 assessment-scope grant 中声明的目标，且工具名必须列入该策略的 `networkTools`。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 提供方）、`@deepseek-ai/dsh-tools` 以及把 `networkTools` 配置为包含 `nmap_scan` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。执行主机 PATH 上必须能解析 `nmap`，或通过 `config.command` 指定。

<a id="model-experience"></a>
## 模型体验

### nmap_scan 工具 schema

#### What the model sees

模型收到生成的 [`nmap_scan` schema](../../../docs/tool-catalog.zh.md#cinlantool-nmap)：`target_id`（必填，须匹配 grant 目标），可选 `ports`/`topPorts`、`serviceDetection`（`-sV`）、`osDetection`（`-O`）、`openOnly`（默认 true）和 `timing`（`-T0`..`-T5`）。

#### Token effect

工具向模型工具上下文添加一条扫描描述和 JSON schema；结果由 `maxOutputBytes`（默认 256 KiB）限制字节数。

#### KV Cache effect

工具 schema 属于模型工具前缀，直到加载的工具组合变化前可以保持缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装 `nmap`；可执行文件缺失时工具给出明确错误。
- 不支持 `--script`：NSE 漏洞脚本有意不在本侦察工具范围内。
- OS 检测（`-O`）在多数平台需要提升权限，未授权主机上可能失败。
- CIDR 目标必须逐字声明为 grant 目标值；scope 策略做精确/前缀匹配，不做 CIDR 包含判断。
- 扫描完成是分诊证据，不是可利用性证明，也不是授权 grant。

<a id="dev-note"></a>
### 开发备注

保持工具名 `nmap_scan`、参数名 `target_id` 与 `assessment-scope-tool-policy` 及 security-research bundle patch 的 `networkTools` 接线同步。
