# Playwright Clean-Room Capture

## Scenario

对未知但已授权的 Web 链接做黑盒观察，需要避免复用宿主浏览器身份，并保留可复核的页面与网络证据。

## Minimum Isolation Baseline

1. 每次运行新建 Chromium 进程和非持久化 `BrowserContext`，不得加载宿主 profile、扩展、cookie 或 storage state。
2. 显式设置 `chromium_sandbox=True`，并验证启动日志没有 `--no-sandbox` 或 `--disable-setuid-sandbox`。
3. 只接受 `http://` 和 `https://` 主目标；对主文档、redirect、popup 和子资源统一拦截 `file://`、本机、私网、link-local、multicast、reserved 地址。
4. 默认禁用 WebRTC 非代理 UDP、浏览器 sync、后台联网、password store 和 Service Worker；需要协议保真时再逐项显式放开。
5. 下载物只保存到案例目录，不打开、不执行；HAR、trace、HTML、console 和下载物默认视为敏感证据并排除 Git。
6. manifest 和操作日志对 query value、fragment 和 proxy credential 脱敏；HAR 若保存完整 body 和 URL，必须留在受控证据目录。

## Evidence Bundle

- `network.har`: 请求、响应、header、timing 和可选 body。
- `trace.zip`: Playwright snapshot、source、screenshot 和 network trace。
- `page.html` / `page.png`: 最终 DOM 与视觉状态。
- `events.jsonl`: console、page error、策略拦截与下载记录。
- `manifest.json`: 脱敏目标、最终 URL、HTTP 状态、browser version 和隔离开关。

## Verification

- 使用本地临时 HTTP 服务验证：默认策略必须拒绝 loopback，显式 `allow-private` 才能采集。
- 使用稳定公网测试页验证 DNS 分支、HAR、trace、HTML 和 screenshot 均非空。
- 开启 `DEBUG=pw:browser` 检查实际 Chromium 启动参数，不以 Playwright 默认值作为事实。

## Boundary

Browser process、profile 和数据隔离不等于 VM containment。DNS 预检加 request routing 也不能完全消除 DNS rebinding 的 TOCTOU 窗口。对可能利用浏览器漏洞的目标，应改用可销毁 VM，并在 VM/代理层实施 egress allowlist 和 DNS/IP 强制校验。

## Evidence

- `nubl24cc/scripts/isolated_browser.py`
- `nubl24cc/tests/test_isolated_browser.py`
- `nubl24cc/exports/isolation-smoke-sandbox-debug/`

## Increment: iframe-gated fake 404 capture

When a fake-404 page is expected to hide a delivery iframe, capture must not rely only on final DOM text. Add early init-script instrumentation for `document.createElement('iframe')`, `createElementNS`, `setAttribute`, `HTMLIFrameElement.src/srcdoc`, `appendChild`, `insertBefore`, `MutationObserver`, and Playwright `frameattached`/`framenavigated` events. Persist both the final `iframes.json` and the frame tree `frames.json`; if both are empty while request/response bodies also contain no iframe markers, treat the iframe branch as not reached and pivot to missing query, cookie, referrer, landing link, IP segment, or browser fingerprint evidence rather than inventing the delivery protocol.
