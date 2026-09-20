# 自动化入口

仅当当前 Harness 已注册名为 `js-reverse` 的 MCP 服务器、且工具目录含以下方法时使用这些名称；其他配置以实际工具目录为准。推荐开场顺序：

1. `mcp__js-reverse__new_page` 或 `mcp__js-reverse__navigate_page` 打开页面
2. `mcp__js-reverse__list_network_requests` 看最近请求
3. `mcp__js-reverse__get_request_initiator` 找调用栈
4. `mcp__js-reverse__list_scripts` 建立脚本范围
5. `mcp__js-reverse__search_in_sources` 搜请求路径、参数名、函数名
6. 必要时 `mcp__js-reverse__break_on_xhr` 或 `mcp__js-reverse__set_breakpoint_on_text`

默认不要一上来就猜 `window`、`document`、`navigator` 该怎么补。
