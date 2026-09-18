# Agent Note: Connection 上带作用域的 Fetch 资源路径

Status: implemented

[English](2026-09-17-scoped-fetch-resources.md) | 中文

## 问题

Sidebar HTML 预览需要在同一 Session 下加载文档及其相对引用的 CSS、图片和 JavaScript。`/api/sidebar/html/<session>/<absolute-path>` 这样的 URL 把上下文保留在资源层级中：文档 `/api/sidebar/html/session-1//workspace/site/index.html` 中的 `styles/site.css` 会解析为 `/api/sidebar/html/session-1//workspace/site/styles/site.css`。若 Session 与文件路径仅放在查询参数中，浏览器解析相对资源引用时就会丢失它们。

Connection 已负责与 Remote 调用共用的、经过认证的 Fetch 分发。逐一注册所有可能的文件无法表达文档目录及其由浏览器请求的后代资源。该消费方需要带作用域的路径前缀，同时现有精确注册仍保留其匹配与唯一性规则。

## 决策

[ConnectionFetchRoute](../../../../packages/client/connection/src/rpc.ts) 仅通过 `match?: 'exact' | 'prefix'` 暴露这一选择。省略时按精确路径匹配。显式前缀注册必须指定 `/api` 下有效的端点命名空间，并以 `/` 结尾，例如 `/api/sidebar/html/`。现有端点解析器验证末尾斜杠之前的命名空间；单独的 `/api/` 与畸形命名空间会被拒绝。末尾斜杠使名称相近的同级路径保持在该注册范围之外。

匹配使用 `URL.pathname` 的字面值。Connection 不解码资源后缀，也不重写请求 URL。精确注册优先于前缀；匹配的前缀中选择最长者。先选择路由，再验证请求方法，因此方法不被允许时返回 404，不尝试更宽的前缀或 RPC 拦截器。请求体模式采用相同的路由选择结果，被拒绝的方法仍使用默认缓冲模式。[Connection README](../../../../packages/client/connection/README.zh.md) 负责完整的注册行为说明。

两种模式共用一个以路径为键的注册表，以及调用方 fiber 的同一套 effect。销毁注册会撤回请求准入；载体与处理函数仍负责已接收的请求、中止信号、响应流及其结束。认证与 Host/Origin 检查在共享分发之前执行。前缀匹配不增加认证路径、监听器、传输或请求／响应适配器，也不改变连接代际与请求体限制的归属。

本决策扩展了 [Remote 方法笔记](2026-08-02-typert-remote-method-calls.zh.md)、[启动与传输笔记](2026-07-24-web-config-tree-boot-and-transport-layering.zh.md)和[客户端加载笔记](2026-07-23-client-plugin-loading-model.zh.md)中的路由匹配事实。它们关于 Remote、启动与加载的决策继续有效。

## 考虑过的替代方案

**用精确路由和仅含查询参数的资源身份。** 相对引用会替换文档文件名并丢弃查询参数，嵌套资源因此失去 Session 与目录上下文。重写文档引用还会迫使预览所有者处理 CSS 和 JavaScript 内部的引用，而无法直接使用浏览器的 URL 解析。

**独立的 Sidebar 传输或路由器。** 私有传输、第二个监听器或伪造的 Node 请求／响应适配器会重复承担 Connection 的认证、取消与请求体处理。现有 Fetch 注册只需为该消费方增加显式前缀模式。

**路径匹配后按请求方法回退。** 若把选中路由所拒绝的方法交给更宽的路由或 RPC 拦截器，就会绕过所选所有者的方法限制。因此，路由选择先确定归属，再验证请求方法。

## 后果

相对资源通过常规 URL 解析保留 Session 与目录上下文，精确路由的消费方则保留默认行为。API 增加一个显式匹配选项，无需引入通配模式、参数或另一套注册表。功能处理函数仍须验证 Session 访问与资源路径；前缀匹配不授予文件访问权限，也不解码路径。

## 测试

[注册表测试](../../../../packages/client/connection/tests/fetch-routes.host.spec.ts)覆盖默认精确匹配、注册校验与唯一性、不受注册顺序影响的优先级、字面转义与相似路径、方法拒绝、注销、fiber 撤回以及信号／响应归属。[Loader 组合测试](../../../../packages/client/connection/tests/fetch-routes-loader.host.spec.ts)通过真实 Connection 与 HTTP 分发验证浏览器认证、相对资源请求、路由禁用与重新启用、选中路由的请求体模式与限制，以及客户端断开后迟到响应的取消。这些检查验证 Connection 行为及其经过认证的 HTTP 组合。
