---
description: "通过原生 Provider 提供经过认证的 Browser Settings 操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-browser-controller

[English](README.md) | 中文

## 概述

此 Host Remote controller 将 Browser Settings 连接到选定的原生 Provider，提供 profile 状态、显式导航、页面检查、Cookie JSON 导入、观察绑定的文件输入上传和页面所属下载读取。它不注册模型工具，也不导入具体 Provider。

## 目录

- [操作](#operations)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="operations"></a>
## 操作

可选 cinlan-browser bundle 挂载此 controller。生成的 browser Remote 命名空间需要经过认证的 Connection/Gateway；这些人工操作与模型工具审批独立。读取 profile 不启动浏览器，显式列页和导航可能启动浏览器。

元素选择在明确指定的页面上打开可取消的原生选择器。捕获会消耗该页面的一次性选择，请求 PNG，通过 Attachments 保存字节，并返回已保存的图片引用及校验过的字节供预览。Controller 不选择 Session，也不发送消息；[捕获页面](../../client/ui-browser-element-capture/README.zh.md)负责明确将图片接纳到发起草稿。

Cookie 导入接受最多 256 KiB 的 JSON 数组、预期的当前 profile 名称及有界 Cookie 字段，不扫描其他浏览器数据库。解析与原生导入错误不包含值，回执只有数量和 profile 名称。Cookie 由浏览器 profile 保留，不写入 Harness Settings 或 Session 日志。

上传接受显式 base64 文件数据、文件名及新鲜 page/observation/element id，只设置输入框，不显式提交；页面事件可能发送数据。下载只接受页面所属 id，不接受文件系统路径。maxFileBytes 默认 4194304，限制解码后的传输字节；Provider 可能施加更小的上限。下载响应携带精确 base64 字节及经过清理的文件名，供 Client 作为普通文件保存。

<a id="model-experience"></a>
## 模型体验

无，因为此 controller 只注册人工 Remote 操作，不注册模型 prompt、tool 或 Session event。

#### KV Cache 影响

不直接改变模型请求前缀；面向模型的输出由 Browser 工具持有。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 尚不提供 profile 清单、重命名/删除或逐标签页切换 profile。
- 历史与网络检查仅使用打开页面的有界内存，不是持久浏览历史或 HAR 导出。
- 认证只代表 Harness 访问权，不代表评估目标授权；完整 Security Research 强制执行仍需单独实现。

<a id="dev-note"></a>
### 开发备注

不发布 runtime invariant companion，因为此 controller 将状态委托 Browser，仅校验 Remote 输入，没有独立业务投影。
