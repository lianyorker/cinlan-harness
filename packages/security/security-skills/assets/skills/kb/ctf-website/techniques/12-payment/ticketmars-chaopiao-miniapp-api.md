---
id: 'ctf-website/12-payment/ticketmars-chaopiao-miniapp-api'
title: 'TicketMars/巢票赛演小程序公开目录 API'
summary: '黑盒观察确认 TicketMars 网关的 show/session/seat-plan 只读接口和 statusCode 响应封装；订单 POST 需新鲜 HAR 获取。'
signals:
  ['巢票赛演', '票星球', 'ticketmars', 'piaoxingqiu', 'cyy_gatewayapi', 'show/session/seat_plans']
last_updated: '2026-08-05'
---

# TicketMars/巢票赛演小程序公开目录 API

## 观察结果

在 Windows 微信运行态中，`巢票赛演` 的公开目录请求命中：

```text
https://m.piaoxingqiu.com/cyy_gatewayapi/show/pub/v5/show/{showId}/static
https://m.piaoxingqiu.com/cyy_gatewayapi/show/pub/v5/show/{showId}/dynamic
https://m.piaoxingqiu.com/cyy_gatewayapi/show/pub/v5/show/{showId}/sessions
https://m.piaoxingqiu.com/cyy_gatewayapi/show/pub/v5/show/{showId}/session/{sessionId}/seat_plans
```

常见响应封装：`statusCode=200`、`comments=成功`、业务数据位于 `data`。`sessions` 的 `data` 是列表；seat-plan 的 `data.seatPlans` 是票档列表，字段包括 `seatPlanId`、`stdSeatPlanId`、`seatPlanName`、`originalPrice`、`canBuyCount`、`saleStarted`、`isStopSale`。

## 票星球官方小程序

独立运行日志确认官方票星球小程序：

```text
appid: wxdbb4c5f1b8ee7da1
pages/show/detail/v2/index
pages/showsubs/pre-ticket/v2/index
pages/showsubs/ticket-level/v2/index
pages/showsubs/order/confirm
```

白标小程序与官方票星球虽然共享 TicketMars 公开目录模型，但账号态、渠道 header、订单 POST 和签名不能跨 appid 直接复用。

## 自动化边界

- 只读目录可直接预检并归一化 show/session/seat-plan 元组。
- 订单创建 POST 不在 Chromium cache 中保存完整请求，不能从只读响应猜 endpoint 或签名。
- 通过 `mitmdump` HAR 获取认证、cookie、动态 token 和 create body；导入器应排除 pay/payment/cashier。
- TicketMars 的业务成功字段优先检查 `statusCode`，不要把 HTTP 200 单独当成订单成功。
- 票星球公开 H5 搜索接口为 `GET /cyy_gatewayapi/home/pub/v3/show_list/search`，常用参数包括 `keyword`、`pageType=SEARCH_PAGE`、`offset`、`length`、`startDate`、`endDate`、`cityId`。返回 `data.searchData[].showId`，可用于后续只读目录查询。
- Windows 环境若配置了系统代理，`httpx.Client` 会默认读取 `HTTP_PROXY`/`HTTPS_PROXY`。本地 E2E 使用 `execution.trust_env=false`，真实环境按需设置为 `true`，不要把代理地址或认证值写入仓库。
- 票星球真实订单链已观察到 `POST /cyy_gatewayapi/trade/buyer/order/cart/v1/pre_order`、`POST /cyy_gatewayapi/trade/buyer/ticket/cart/v1/spus/tied_sale_search`、`POST /cyy_gatewayapi/trade/buyer/order/cart/v1/create_order`；创建成功订单号路径为 `data.orders[0].orderId`。
- 支付端点使用复数路径 `POST /cyy_gatewayapi/trade/buyer/v5/payments/cashiers`。支付边界匹配必须覆盖 `payments?` 和 `cashiers?`，否则导入器可能误把收银台请求标记为最终重复步骤。
