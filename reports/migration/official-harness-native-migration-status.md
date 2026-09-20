# 官方主干与原生功能迁移执行记录

## 范围与基线

按[执行方案](official-harness-native-feature-plan-2026-09-20.md)执行六阶段迁移。主目录为 `D:/Company/cinlan/cinlan-harness`，长期开发分支 main。起始提交 `2604e4ab8a35f10eddb9839ee5f4630528674926`；本次固定官方 `dsh-v0.1.6-alpha.2`、`ddefc45fbc7f8e46dd73185e68295696d1297887`。GitHub 本轮查询超时，未宣称重新确认最新远端 HEAD；采用本地已验证发布标签。

## 交付物归档

旧集成树的 3,346 个非受控文件共 4,507,017,638 字节已复制到 `D:/Company/cinlan/releases/harness-016-baseline-2604e4ab`，每个常规文件均核对源／目标 SHA-256。归档清单：[ARCHIVE-MANIFEST.json](../../../releases/harness-016-baseline-2604e4ab/ARCHIVE-MANIFEST.json)。未将可再生 node_modules、包 lib、tsbuildinfo、.dsh-build 作为用户交付物归档。

旧记录中的 `D:/Company/cinlan/cinlan-harness-upstream-016` 路径是历史位置。需要读取其 `.artifacts` 或 `apps/desktop/.desktop-build` 文件时，使用上述归档根目录拼接相同相对路径；归档内容保持原字节，内部历史路径不改写。原 main 的 `apps/desktop/coverage-floating/` 保留。

历史验收安装包（不代表后续新提交）：[EXE](../../../releases/harness-016-baseline-2604e4ab/apps/desktop/.desktop-build/targets/win-x64/artifacts/deepseek-harness-0.1.6-alpha.2-win-x64.exe)、[MSI](../../../releases/harness-016-baseline-2604e4ab/apps/desktop/.desktop-build/targets/win-x64/artifacts/deepseek-harness-0.1.6-alpha.2-win-x64.msi)、[元数据与哈希](../../../releases/harness-016-baseline-2604e4ab/.artifacts/official-016-audit/windows-016-artifacts.json)。

## 阶段状态

| 阶段 | 状态 | 证据／剩余工作 |
|---|---|---|
| 0 工作树与基线 | 已完成 | 3,346 个非受控文件已逐文件 SHA-256 校验并归档；旧集成工作树与临时分支已正常移除；main 离线 frozen-lockfile install 通过；官方只读参考树保留用于迁移 |
| 1 官方核心 | 依赖闭包审查中 | Session／投影、PTC／workflow、Desktop 更新三项独立审查；尚未宣称迁移完成 |
| 2 菜单／资源下载 | 未开始 | 以安全研究下载页形成完整资源管理 |
| 3 Orca bridge 替换 | 未开始 | Computer Use 与 Mobile 原生实现 |
| 4 SSH／手机配对 | 未开始 | 实际远程执行和手机端协议 |
| 5 剩余功能／安装包 | 未开始 | 最终 main 重建、干净环境与原生验收 |

## 架构核验补充

官方 Desktop update journal 是可选脱敏诊断日志，不承担本地 profile／seed 事务恢复；迁移时保留本地 activation journal 的独占恢复职责。官方任务锁需接入本地真实 RPC 与流请求入口，不能只复制一个本地不会触发的事件监听。PTC Windows 控制管道、ACL 和 source launcher 必须与默认装配一起迁入。

本记录随实际完成批次更新；测试文件存在、静态审查或安装依赖成功均不等于运行验收通过。
