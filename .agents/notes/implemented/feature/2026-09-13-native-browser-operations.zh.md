# Agent Note: 原生 Browser 操作与 profile 数据归属

Status: implemented

[English](2026-09-13-native-browser-operations.md) | 中文

## 问题

浏览器启动适配器与偏好表单不等于原生 profile 操作、受控导入或可用文件传输。Cookie 值、工作区文件和下载需要不同的数据归属与生命周期规则；记录导入值或接受任意 Host 下载路径会暴露无关数据。

## 决策

既有 Browser Service Definition 增加可选 automation 与 transfer Provider 接口。Playwright 直接实现它们；不支持的 Provider 明确拒绝扩展，不回退到 Orca。可选 browser profile 组合 base、Web 和 cinlan-browser，并提供面向经过认证人工操作的生成式 Browser Remote。

profile 名称、主页和搜索引擎复用带修订号校验的 Settings 命名空间，在 Provider 重新挂载后生效。default 保留既有目录，其他经验证的小写名称使用独立 Harness 子目录。改名不会复制或删除已存 Cookie。

Cookie 导入接收用户选择的 JSON 数组及预期的当前 profile，原生导入前完成验证，错误与回执均不回显值。不注册模型 Cookie 导入工具，也不自动扫描其他浏览器数据库。

历史与网络检查只为打开的页面保留有界元数据，排除 URL 凭据、查询、片段、请求与响应的头和正文。文件上传消耗新鲜 observation；模型上传只读取调用 Session 的工作区。下载归属其页面，报告 pending/complete/failed 状态，读取时执行字节限制并清理文件名。模型保存复用既有 Attachment Provider 持久化精确字节，人工保存使用普通 Blob。

## 考虑过的替代方案

**复制外部应用的 CLI 和设置存储。** 这会保留第二套运行时前提，并重复既有 Harness Settings、Provider 与 Remote 分层。

**通过模型工具传递 Cookie 值。** 工具参数会进入持久 Session 日志。经过认证的人工 Remote 将导入值排除在该记录路径之外，仅返回数量。

**返回 Host 下载路径或不加限制地读取整个文件。** 调用方可能混淆不同执行环境中的路径，大文件也可能耗尽内存。页面所属 id 与流式读取保持归属并执行读取预算。

## 影响

Browser 操作仍为可选能力。模型工具使用既有 observe/navigate/interact 策略和单调执行 guard；经过认证的人工 Remote 是独立访问路径，不代表评估授权。Security Research scope 尚未覆盖全部 Browser、shell 和网络行为。

历史不跨页面关闭或 Provider 退出持久化，网络检查不是 HAR。命名 profile 需要重新挂载，没有清单、重命名/删除或逐标签切换 UI。传输读取预算不限制浏览器网络流量或临时下载磁盘占用。Cookie 只支持显式 JSON 导入，不支持数据库解密或浏览器发现。

## 验证

真实 Web 组合保存偏好并重启 Host，检查主页/搜索目标、原生历史导航和请求元数据。测试导入 fixture Cookie，通过本地 HTTP 请求核实，同 profile 重启后验证保留，并证明另一 profile 不含该 Cookie。上传检查目标 input，下载比较实际 attachment 与浏览器保存文件的字节。单元测试覆盖错误导入、过期 profile、数量/字节限制、取消和权限 listener 绕过。

[原生组合决策](2026-09-13-native-browser-and-security-evidence.zh.md) 继续持有 Browser 基础组合与持久安全证据规则。本 Note 增加操作和导入归属，不替换既有决策，也不宣称已有完整模型对话录制。
