# Agent Note: 手机端 Work Items 分享

状态：已实现

English | [中文](2026-11-07-mobile-work-items-sharing.md)

## 问题

手机 tunnel 使用独立的加密协议，不经过 Gateway `remoteAccess`；复用 Gateway 策略检查无法保护手机任务读取。

## 决策

Host 操作者在生成配对票据前选择要共享的 Work Item 来源。票据将来源列表绑定到一个设备身份；设备完成注册后，Host 将授权与设备记录一起保存，并在每次手机列表请求中检查该设备的授权。默认授权为空。手机只收到有界的开放任务摘要，不能关联任务、准备写入或确认写入。修改设备授权需要先撤销设备，再重新配对。

## 结果

此授权只适用于 Cinlan Mobile tunnel 设备。Gateway `share-viewer` 访问仍是独立策略，不受这些授权影响。旧设备记录读取后会获得空的 Work Item 授权。

## 验证

Host socket 测试覆盖默认拒绝、已授权来源列表与读取，以及拒绝未授权来源。配对设置测试覆盖默认空选择。包级检查和手机首页构建结果随改动记录。
