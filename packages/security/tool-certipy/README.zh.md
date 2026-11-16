---
description: "面向模型的 ADCS 收集工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-certipy

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `adcs_find`、`adcs_req`、`adcs_auth` 三个工具。`adcs_find` 以固定的 `-stdout` JSON 收集 ADCS 配置；ESC 利用对（`adcs_req` 经 ESC 路径请求证书，`adcs_auth` 用所得 PFX 产物认证）在 `exploit-execution` 动作下闭环。账户密码在执行期经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，绝不进入模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制执行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local`）、`@deepseek-ai/dsh-tools`、一个凭据 Provider（例如 `@deepseek-ai/dsh-credentials-local`），以及配置了包含 `adcs_find` 的 `credentialTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`certipy` 可执行文件必须能在执行主机 PATH 上解析，或通过 `config.command` 指定。授权必须声明 `credential-use` 动作，并为被收集域声明与所呈引用配对的 `credentials` 条目。

<a id="model-experience"></a>
## 模型体验

### adcs_find 工具模式

#### 模型看到什么

模型收到生成的 [`adcs_find` 模式](../../../docs/tool-catalog.zh.md#cinlantool-certipy)：`target_id`（必填域名，须匹配授权目标）、`username`（必填）、`credential_ref`（必填，env-var 语法的名字——其值绝不进入对话），另有可选 `dc_ip` 与 `vulnerable_only`（ESC 类提权路径的 `-vulnerable` 过滤）。

### adcs_req 工具模式

#### 模型看到什么

模型收到生成的 [`adcs_req` 模式](../../../docs/tool-catalog.zh.md#cinlantool-certipy)：`target_id`、`username`、`credential_ref`、`ca` 与 `template`（全部必填，名称须与 `adcs_find` 报告一致），另有可选 `san`（ESC1 主题备用名称）与 `dc_ip`。结果携带 PFX 产物路径与 certipy 的有界摘要行。

### adcs_auth 工具模式

#### 模型看到什么

模型收到生成的 [`adcs_auth` 模式](../../../docs/tool-catalog.zh.md#cinlantool-certipy)：`target_id` 与 `pfx_path`（必填，来自 `adcs_req` 的产物路径），另有可选 `dc_ip`。结果携带 certipy 的认证摘要行（TGT 或 NT hash）。

#### Token 影响

三个工具向模型工具上下文各追加一条描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `certipy`（certipy-adt）；可执行文件缺失时工具会给出明确错误。
- 解析器从 `CAs`/`Templates` JSON 列表提取行名；名字之外的 ESC 类细节留在调用方可重跑查看的原始 stdout 里，模板属性随 certipy 版本漂移只会让行变短而不是失败。
- 密码随 `adcs_find` 与 `adcs_req` 的 `-p` 标志传递，执行期间在本机进程列表可见——但绝不进入模型可见参数、结果或会话日志。
- `adcs_req` 的 PFX 产物是二进制机制产物而非工具结果导出：写入私有临时目录，生命周期随宿主进程；调用方在同一会话内将其接入 `adcs_auth`。
- 黄金证书伪造（certipy forge）与 CA 管理操作（certipy ca/template/shadow）延后：本包覆盖收集加上请求-认证的利用链。

<a id="dev-note"></a>
### 开发注记

保持工具名 `adcs_find`、`credential_ref` 参数名与 `credentialTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
