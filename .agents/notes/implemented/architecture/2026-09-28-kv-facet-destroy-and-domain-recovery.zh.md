# Agent Note: KV 分面销毁原语与领域恢复重置

Status: implemented

[English](2026-09-28-kv-facet-destroy-and-domain-recovery.md) | 中文

## 问题

领域 KV 存储底座此前在派生介质上面临两处运行缺口：

- **相对存储根目录随工作目录漂移。** `JsonStorageBackend` 此前直接保留传入的路径字符串未予解析，导致插件配置中传入的相对路径会在每次打开单元时基于当时的 `process.cwd()` 进行解析。虽然生产配置传入绝对路径，但在测试环境或动态切换 cwd 时存在将单元文件割裂至多个目录的风险。
- **派生介质无法自动丢弃损坏或版本不匹配的文件。** 当领域介质发生损坏或遭遇不兼容的版本升级时，`open` 会以 `malformed-medium`、`version-mismatch` 或 `invalid-record` 强行抛错。对于工作区账本等权威领域，大声报错是正确的；但对于可基于会话事件日志重建的丢弃型派生数据，大声报错会导致宿主无法启动且缺乏自动恢复机制。

## 决定

- **在构造时解析 JSON 后端根目录。** `JsonStorageBackend` 现于构造函数中调用 `resolve(root)`，彻底消除后续 cwd 漂移的影响。
- **在 `KvFacet` 上增加 `destroy` 原语。** `KvFacet` 新增 `destroy(descriptor: KvUnitDescriptor): Promise<void>`。JSON 后端负责删除 `<root>/<unit>.json` 或递归清理 `<root>/<unit>/`；SQLite 后端负责删除 `units` 与 `unit_globals` 中的元数据行并对所有声明的数据表执行 `DROP TABLE IF EXISTS`。对不存在的介质调用保持幂等，对当前处于打开状态的单元或已关闭的后端调用则抛错拒绝。
- **在 `DomainSpec` 上增加 `recovery` 声明。** `DomainSpec` 支持可选字段 `recovery?: 'reject' | 'reset'`，缺省为 `'reject'`。
- **在 `DomainFacility.open` 中实现单发重置。** 当声明了 `recovery: 'reset'` 的领域在打开时捕获损坏类错误（`version-mismatch`、`malformed-medium` 或 `invalid-record`）时，`DomainFacility.open` 会打印一条警告日志，调用 `backend.kv.destroy` 销毁介质，并在空单元上执行单次重试。非损坏类错误与二次失败依然大声向外传播。

## 备选方案

- **不加声明对所有领域一律自动重置。** 不予采纳：工作区注册等权威用户数据在格式不兼容或损坏时决不能静默丢失。
- **将损坏文件改名旁置而非直接删除。** 不予采纳：派生介质完全可由会话日志重建，保留损坏的派生数据只会无界堆积磁盘垃圾而无恢复价值。

## 结果

派生 KV 领域可声明 `recovery: 'reset'` 在版本升级或解析损坏时自愈，避免阻塞宿主启动。权威领域继续维持严格的强失败语义。共享的 `runKvBackendContract` 套件同步覆盖了 JSON 与 SQLite 双后端上的 `destroy` 语义。
