# `@deepseek-ai/dsh-cinlan-remote-tunnel`

[English](README.md) | 中文

此 Host 插件拥有经过认证的手机监听器，以及到自部署 Director/Cell 的可选反向连接。它由 `cinlan-mobile-host` profile 条目加载，不替代 loopback Connection operator API。

Host 设置选择一种模式：`local` 绑定 loopback，`lan` 使用所选本机地址，`relay` 通过配置的 Director 解析签名区域租约。配对票据会过期且仅消费一次。设备凭据保存为摘要；撤销会从 Host 和 relay 移除设备，并关闭其活动 socket。

保护 `stateFile`；应用安装在仓库布局之外时，显式设置 `mobileAssetsDir`。远程 Director 地址使用 HTTPS，除非开发局域网显式启用 `allowInsecureNetwork`。

新建 Host 使用 `local` 模式。Relay 必须显式配置部署标志 `relayConfigured: true`，并读取 `accountController.getSub2ApiState()` 返回的 Cinlan 账户状态，不受保留的 `requireCinlanAccount` profile 字段影响。已存 Sub2API 记录代表本地登录，不代表重新向云端验证身份。私有默认 Director 为 `https://relay.cinlan.online`；已配置 Host 可以选择自定义 Director 和区域。未配置的 operator 响应不显示内部地址。Cinlan 记录变化会关闭 Relay 连接、使待处理邀请失效并取消重连定时器；登录仅重连此前选择的 Relay 模式。直连设备与已存设备凭据保持不变。

手机能力目录提供 Host 的模型目录，以及已安装的权限预设。提示覆盖值仅在主动选择后应用。Queue 和 steer 保留其 Session 语义；interrupt-send 先取消，再提交排队提示。图片接收支持 PNG、JPEG、WebP 和 GIF，上限 512 KiB；此协议不支持普通文件上传回执。

历史快照保留 Session 控制器的 wire 记录。加密传输对超过 256 KiB 的完整消息分片，完整 JSON 上限为 16 MiB，不暴露部分快照。Host 串行发送消息，等待每帧 socket 发送回调，并用 `maxQueuedRequests` 限制待发消息数。认证失败响应会在关闭连接前发出。
