# 工具默认值

以下名称以已配置的 `js-reverse` MCP 服务器为例；调用前核对当前 Harness 工具目录与参数声明。

- `mcp__js-reverse__list_network_requests`：先看第一页默认结果，不足再翻页
- `mcp__js-reverse__search_in_sources`：默认 `excludeMinified=true`
- `mcp__js-reverse__get_script_source`：只读小片段，整份源码优先配合 `mcp__js-reverse__save_script_source`
- `mcp__js-reverse__break_on_xhr`：只填能稳定命中的 URL 片段
- `mcp__js-reverse__get_paused_info`：默认先看 `frameIndex=0`
