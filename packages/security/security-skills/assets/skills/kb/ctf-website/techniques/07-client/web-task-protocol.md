# Web Task Protocol Recon

## Scenario

公开 Web 面板提供 checkout、PayPal BA 或 SMS 取号任务，但用户需要判断协议生成是在浏览器还是服务端。

## Input Signal

- 第一方 JS 中出现 `fetch`/`api` 封装、`job_id`、轮询、取消、OTP 或验证码回传。
- 页面初始请求只有 health、catalog、stats、captcha 配置等 GET。
- 静态代码没有可执行的 `crypto.subtle`、HMAC、MD5/SHA、RSA 或签名调用。

## Method

1. 只读加载页面，记录最终 URL、直接引用脚本和加载期 `xhr/fetch`。
2. 下载第一方 JS，记录 URL、HTTP 状态、字节数和 SHA256。
3. 从请求构造位置提取 method、path、headers、JSON body 字段和轮询/取消/人工输入端点。
4. 将任务分成创建、轮询、OTP/验证码、浏览器桥接、取消五类。
5. 在没有测试任务授权和必要凭据时，不提交订单、支付或回调，只验证公开 metadata GET。

## Verification Criteria

- 能从前端证据复现 API contract 的字段名和状态推进关系。
- 没有把 `idempotency_key`、job ID 或 CDK 查询参数误判为签名。
- 明确区分“前端可见的任务契约”和“后端未观察到的上游支付/SMS 协议”。
- 产物包含脚本 hash、脱敏请求清单和未验证项。

## Reusable Finding

PayPal BA 面板的公开前端通常只创建 job，并通过 `otp`/`captcha` 端点输入人工信号；Braintree/上游协议生成仍由服务端完成。SMS 面板常见 `Content-Type: application/json` 的订单封装，CDK 可能进入 query/body，但这不是客户端签名。

## Evidence

- `freeAgentIdentity/exports/web_protocol_recon_2026-07-25/evidence.json`
- `freeAgentIdentity/notes/web_protocol_recon_2026-07-25.md`

## KB Gap

- API-specific backend task schema and upstream provider request reconstruction require an authorized test task and server-side observation.
- `hero-sms.com` and `smsbower.app` provider contracts are not covered by this entry.
