# QQNT wrapper.node Clean-room Runtime

## Scenario

在不修改官方 QQ 安装文件、不复制第三方 QQ bot 实现的前提下，把自有客服 runtime 接入官方 QQNT 已登录会话。

## Input Signal

- 官方 `resources/app/package.json` 的 `main` 指向 `application.asar`。
- `resources/app/wrapper.node` 依赖 QQNT 自带 Node/V8，系统 Node 无法直接加载。
- `QQ.exe` 通过 `GetProcAddress` 取得 QQNT content entry，QQNT 自身导入 `CreateFileW`。
- Windows 11 的 Node/libuv stat 路径可能动态解析 `GetFileInformationByName`， 只 hook `CreateFileW` 不足以保证虚拟入口可见。
- wrapper 暴露 login service、`NodeIQQNTWrapperSession` 和 message service。
- 私聊在线文件发送使用 `elementType: 23`，与普通文件消息的 `elementType: 3` 不同；部分 QQNT 版本的 `sendMsg` Promise 不会结束。

## Method

1. suspended 创建官方 `QQ.exe`。
2. 远程加载自有 bootstrap DLL。
3. patch `QQ.exe` 的 `GetProcAddress` IAT，并 inline hook `kernelbase.dll!GetFileInformationByName`。
4. 查询 `ExportedContentMain` 时先通过受约束签名修改 QQNT 启动保护分支， 再 patch `QQNT.dll` 的 `CreateFileW` IAT。
5. 对 `GetFileInformationByName` 使用系统 `CreateFileW` + `GetFileInformationByHandleEx` 兼容 shim。
6. 仅把 `resources/app/package.json` 和自有入口文件查询定向到工作区文件。
7. 自有入口先加载官方 launcher，再附加 wrapper/session。
8. 通过 loopback-only、token 鉴权、有限帧长的 NDJSON IPC 与外部 Agent runtime 通信。
9. 私聊在线文件以 `fileName`、绝对 `filePath`、字符串 `fileSize` 组成 type 23 element；调用 `sendMsg` 后轮询 `getOnlineFileMsgs`，按时间窗、文件名和规范化

不要全局 inline hook `CreateFileW`、`LoadLibraryExW` 或 attributes API。它们会扩大到 QQNT 之外的模块并可能触发“文件已损坏”启动保护。

## Operation Chain

`	ext hash/version inventory -> verify PE imports -> build loader and hook -> listen authenticated IPC -> suspended launch -> targeted in-memory redirect -> official launcher -> wrapper/session attach -> event/action round trip -> readiness and error status
```

必须过滤 runtime 启动前的历史同步消息，否则客服可能回复旧消息。不要把“IPC 已连接”当作 ready；ready 至少要求账号、wrapper 和 message session 同时有效。

## Tool Mapping

| Goal                    | Tool                                              |
| ----------------------- | ------------------------------------------------- |
| 文件版本和 hash         | `Get-FileHash`、`Get-Item`                        |
| PE import 核验          | `pefile` 或等价 PE parser                         |
| x64 调用链核验          | `capstone` 或等价 disassembler                    |
| loader/hook             | Rust + Win32 API                                  |
| Agent runtime           | Go                                                |
| QQNT in-process runtime | CommonJS                                          |
| 静态验证                | `cargo test`、`go test`、`go vet`、`node --check` |

## Runtime Ownership and Account Identity

- An attach runtime inside the official QQNT main process observes the login service; it does not own login-service initialization. Do not call
- If configured-account login is needed, wait for the official `onLoginConnected` callback before calling `quickLoginWithUin()`.
- Treat UIN, UID, and nickname as one account identity. When the observed UIN changes, clear the previous UID and nickname immediately, then repopulate
- QQ group mentions carry the QQNT UID even when the UI displays a nickname. Wake matching must translate the current account UID back to its UIN before

Live evidence on QQNT `9.9.31-49738`: a duplicate attach-runtime `connect()` produced a Crashpad dump whose first module was `wrapper.node`; removing that call restored stable startup with `self_id=2740954283`, a non-empty `self_uid`, `session_attached=true`, and `/readyz` HTTP 200.
## Verification Criteria - 官方 `package.json` 和 addon hash 在启动前后不变。 - loader、hook 和 Agent binary 均来自自有源码构建。
- 非目标文件查询不替换路径。
- 自有入口路径经 QQNT `CreateFileW` IAT 和 `GetFileInformationByName` shim 均能映射到工作区文件。
- 错误 token 无法完成 IPC 握手。
- `/readyz` 在 wrapper/session/账号任一缺失时返回 503。
- runtime 启动前的历史消息不产生 Agent 请求。
- 新群消息能够完成 `native event -> pipeline -> Agent -> IPC action -> sendMsg`。
- 私聊在线文件使用 type 23，且只有在 `getOnlineFileMsgs` 中匹配到本次消息后 才返回成功；type 3 不得作为在线文件发送成功的证据。
- QQ 更新后重新记录版本、hash、imports 和实机结果。
