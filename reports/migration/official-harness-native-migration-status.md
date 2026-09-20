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
| 1 官方核心 | 实现与集成回归中 | Session／图像投影、附件预算、Node PTC／workflow、Desktop 更新与原生任务锁、Office Skills 已落代码；多数定向回归通过；Host／Client／Web 构建通过，Office 真实托管载荷和 Headless 源码／built 回放通过；最终 SDK exe 的 ACL／图像恢复／PTC 与 workflow 真执行通过，七批本地提交正在收尾；浏览器预设 6/7 通过，余项为基线已移除侧栏按钮对应的旧 ARIA 期望；权限切换 3 项行为通过，历史持久化回放差异仍在核对，尚未宣称阶段完成 |
| 2 菜单／资源下载 | 未开始 | 以安全研究下载页形成完整资源管理 |
| 3 Orca bridge 替换 | 未开始 | Computer Use 与 Mobile 原生实现 |
| 4 SSH／手机配对 | 未开始 | 实际远程执行和手机端协议 |
| 5 剩余功能／安装包 | 未开始 | 最终 main 重建、干净环境与原生验收 |

## 架构核验补充

官方 Desktop update journal 是可选脱敏诊断日志，不承担本地 profile／seed 事务恢复；迁移时保留本地 activation journal 的独占恢复职责。官方任务锁需接入本地真实 RPC 与流请求入口，不能只复制一个本地不会触发的事件监听。PTC Windows 控制管道、ACL 和 source launcher 必须与默认装配一起迁入。

基础 profile 已挂载官方 Node PTC 与 workflow-ptc；Headless/Web 不再重复挂载 worker runtime。产品预设移除外部 Codex／Claude CLI 工具模板，保留 Harness 原生子代理。Office 技能 provider 与检查器已迁入；托管解释器和依赖查询的实际 owner 是 Desktop Host 与 Desktop 载荷，正在补齐这条交付链。

Windows 受限 PTC 的控制管道源码回归已通过；初次失败来自源码测试加载旧 built ACL runner，fixture 明确选择源码入口后恢复。阶段 1 Host build 后，PTC 与 workflow 两个 built smoke 均通过，验证实际 `lib` 入口与受限写入；最终 main 安装包仍需重新构建和验收。

锁文件由主协调工作统一生成并备份。一个并行子任务误还原共享 lock 后，已按当前 manifests 重新离线安装恢复。Host、Client 和 Web 构建已通过；公开类型等价检查 428 个主块及双语对应通过。权限 live catalog、稳定命令身份、预设切换策略和 Plugin Manager 工具已补齐。新 SDK 图像卸载场景已通过真实 profile 回放，未修改既有 JSONL。

Python SEA 构建脚本内部的 `pnpm exec pkg` 触发 pnpm 11 生产依赖同步，移除了工作区开发依赖链接；正在修正为直接 Node 入口并恢复依赖。受影响的文档检查与 Office 回放保留失败记录，恢复后重跑。Office Windows 载荷已通过真实下载、SHA 校验、生产安装器复制和载荷内 Python 的 DOCX／PPTX／XLSX 生成重开检查；共 8,104 个文件、294,431,271 字节。Headless 源码与 built smoke 均通过，持久化场景显式等待 backend 就绪。Python 实际 exe 的图像卸载通过；Windows read-only ACL 通过，workspace-write 首轮失败已定位到 Python 临时目录的私有 OWNER RIGHTS ACL，源码与 exe 在同目录均失败；用正常继承 ACL 的隔离工作区复验后，read-only 拒写、workspace-write 写入、显式子目录和越界拒写全部通过，未放宽产品沙箱权限。PowerShell 5.1／7 的受限语言 UTF-8 前缀已修复并实测；最终 exe 三组 smoke 全部通过，SHA-256 为 `cd6a521bfdb8ba662186add60534aa191b708b6ebe8e6b2525421de3a2c3454d`，与 Python carrier 一致。本记录不把上述单项验证当作最终安装包验收。
