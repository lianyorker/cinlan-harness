---
kind: implemented-note
---

# Cinlan 手机连接

[English](2026-10-09-cinlan-mobile-connection.md) | 中文

手机伴侣使用带版本的 Host 协议，并在 Host 设置中单选直连（`local` 或 `lan`）或自部署 `relay`。配对 offer 包含过期且单次使用的票据和 pin 的 Host 公钥；成功注册后 Host 只保存凭据摘要，手机为每个 Host 独立保存连接状态。

Relay 运行时将 Director 分配与 Cell 转发分离。Director 签发带签名的区域租约，Cell 执行 Host/设备准入、容量、队列和负载限制，Relay socket 只转发不透明的加密帧。Host 撤销会关闭该设备的活动 socket 并移除 Cell 凭据。租约续期保持相同区域和 epoch；分配变化或不可用时关闭当前 generation，由 Host 重连策略获取新分配。

手机 UI 投影真实 Host 的桌面、工作区、会话、流和审批事件。创建、提示、订阅和审批命令的 Host 错误会返回 UI。没有后端的原型设置页和控件明确禁用，不报告 mock 成功。

握手绑定双方公钥、nonce、Host 身份、传输方向和上下文，并执行重放与过期检查；实现不宣称完整前向保密或等同 Orca，Host state 文件和浏览器存储仍需按部署机密保护。
