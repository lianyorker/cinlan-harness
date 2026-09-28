# Agent Note: Contain subprocess spill failures

Status: implemented

[English](2026-09-23-subprocess-spill-failure-containment.md) | 中文

## 问题

输出收集器在流的 `data` 监听器中写入 spill 文件。临时目录被删除或后续文件系统写入失败时，异常可能逃出监听器并终止宿主，而不是保留诊断尾部。

## 决策

`OutputCollector` 将 spill 存储视为尽力而为。打开或追加失败时，收集器丢弃不完整文件，只记录一次失败，并继续收集有界的内存尾部且不返回 spill 路径。每进程私有 spill 目录只创建一次；后续被清理工具删除时记录失败，同一进程不修复该目录。

本地 subprocess 提供方通过自身的插件 logger 报告失败。SSH helper 进程使用自身 logger；没有提供 reporter 的直接 `OutputCollector` 调用方收到一条 stderr 诊断。关闭与清理失败继续沿用已有的仅尾部行为。

本地 subprocess 提供方与 SSH helper 进程保留这项失败隔离。修复确保独占打开失败后不会删除未由本进程创建的路径，包含 reporter 抛错，并只在 `ENOENT` 时添加临时清理提示。

## 考虑过的替代方案

**在 `ENOENT` 后重建 spill 目录。** 反复重建可能与临时文件清理工具竞争，也会改变进程级存储生命周期；当前进程保持仅尾部模式，直到重启。

**向上传播文件系统异常。** 流的 `data` 监听器不是恢复产物的可接受失败边界；传播异常可能变成未捕获的宿主异常并丢失命令结果。

**静默降级为尾部。** 尾部仍可用，但 owner logger 需要解释完整输出定位符为何缺失，并诊断临时清理或容量故障。

## 测试

聚焦的 `OutputCollector` 测试覆盖目录被删除、目录路径被文件替换、追加 `ENOSPC`、独占打开失败（`EEXIST`）、reporter 抛错、有界 spill 处置、尾部保留及一次性报告。本地 provider、SSH provider、TypeScript 与 `oxlint` 检查覆盖更新后的构造和报告路径。平台专用 POSIX 进程测试仍由现有 Linux 测试 lane 负责。

## 后果

spill 失败不再仅因恢复文件不可用而终止宿主或拒绝成功的子进程。模型收到有界尾部和截断元数据，运维人员通过所属 logger 收到一条诊断。进程丢失私有 spill 目录后，必须重启才能恢复完整输出。
