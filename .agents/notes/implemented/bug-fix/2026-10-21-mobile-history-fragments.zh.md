# Agent Note: 为手机完整消息与加密帧分别设置上限

Status: implemented

[English](2026-10-21-mobile-history-fragments.md) | 中文

## 问题

真实 Session 历史快照超过加密通道的 512 KiB 明文帧上限。拒绝该快照会在手机渲染历史前关闭连接，而桌面仍能读取同一 Session。减少消息内容会丢弃控制器的规范记录。

## 决策

[加密通道](../../../../apps/mobile-relay/src/crypto.ts)保留逐帧认证、序号检查与 512 KiB 明文上限。完整 JSON 消息单独限制为 16 MiB；超过 256 KiB 的消息使用有序分片。接收端仅保留一个有界重组对象，完整 JSON 消息重组后才发布。[Host](../../../../packages/bundle/cinlan-remote-tunnel/src/host.ts)串行发送完整消息，等待 socket 发送回调，并限制待发送消息数量。

## 考虑过的替代方案

**仅提高帧上限。** 这会增加单次加密与 socket 帧的最大分配量，仍未区分完整历史大小和传输压力。分片保留现有帧上限。

**截断历史记录。** 这会隐藏控制器输出并破坏手机历史投影。传输层在明确上限内保留完整控制器消息。

## 影响

分片消息要求同步部署 Host 和手机页面产物；[升级说明](../../../../docs/upgrade-guide/v0.2.1-alpha.1/mobile-history-fragments/guide.zh.md)记录了此要求。已保存的凭据和 Session 日志保持不变。超过 16 MiB 的历史仍会失败而非截断；分页属于独立后续工作。

## 验证

通道测试覆盖多字节消息、原子重组、错误长度、顺序、重放、交错及完整消息上限。Host socket 测试覆盖大快照及其后的另一请求。针对真实 Host 的浏览器验证确认历史渲染、重连、刷新和 Session 切换；真实模型流式输出、第二个真实 Host 和手机硬件尚未验证。
