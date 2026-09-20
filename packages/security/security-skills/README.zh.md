---
description: "安装、更新、取消和移除经过校验的安全技能资源，供 Harness 技能注册表使用。"
kind: "package-reference"
---
# @deepseek-ai/dsh-security-skills

[English](README.md) | 中文

## 概述

安装安全研究指导与配套文件、查看版本，并在不中断已加载技能的 Agent 的情况下替换资源。网络下载需要显式配置发布清单。应用随附资源可以单独安装，并保留随附来源标记。安装过程不执行资源脚本，也不授予评估授权。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Host 组合中挂载一次 `@deepseek-ai/dsh-security-skills/resources`，并同时挂载官方技能注册表。在全局或 Agent 作用域中挂载本包的主提供方。随附 Web 应用包含两者，使普通 Session 能够使用已安装技能；自定义 headless 组合必须显式挂载管理器和提供方。浏览器安全的 `/types` 子路径导出管理 DTO，不引入 Host 运行时代码。

没有活动安装记录的 home 报告 `not-installed`，且不提供安全技能候选条目。`installBundled()` 安装经过审核的包内清单，不发起网络请求。`install()`、`reinstall()` 和 `update()` 使用配置的发布端点。客户端断开后 Host 继续持有操作；只有显式取消或管理器销毁才会停止任务。取消请求携带操作标识，避免旧按钮取消新的下载。取消会等待操作结束；已经提交的激活结果仍保持安装状态。

| 管理器配置 | 默认值 | 含义 |
|---|---|---|
| `releaseManifestUrl` | 未设置 | 部署提供真实清单 URL 前，网络管理报告不可用。除回环 HTTP 外均要求 HTTPS。 |
| `root` | `DSH_HOME/resources/security-skills` | 绝对资源存储路径；不修改普通技能目录。 |
| `maxArchiveBytes` | 64 MiB | 网络归档大小上限。 |
| `maxExpandedBytes` | 256 MiB | 解压后的安装字节数上限。 |
| `maxFiles` | 10,000 | 资源归档条目数上限。 |
| `downloadTimeoutMs` | 120,000 | 每次清单或归档请求的超时，包含重定向。 |

管理器加载时校验配置的端点。安装接受 schema-1 清单，其中包含归档 SHA-256、精确字节数、规范文件清单及技能清单。归档包含 `skills/` 和许可声明。活动版本切换前，全部技能 frontmatter 和文件哈希必须通过校验。操作失败时返回安全的公开错误并保留已提交版本；详细原因只写入 Host 日志。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[管理器](src/resources.ts) 暂存私有资源字节，通过原子活动记录发布不可变代次。[存储](src/resource-store.ts) 使用短时文件系统锁协调多个 Host，并在提交时比较之前观察到的 revision。激活和移除都会递增 revision，因此较早启动的事务不能覆盖另一 Host 的更新，也不能在移除后复活资源。移动代次目录和提交活动记录使用同一把锁。状态读取和文件系统通知会刷新活动记录。

[提供方](src/index.ts) 在代次变化时撤销旧目录注册。加载技能后会持有持久代次租约，直到所属 realm 销毁；提供方重载不会提前释放。无作用域的全局提供方会保留已加载代次，直到 Host 停止；结束单个 Session 不会释放这些租约。回收过程检查持久活动记录和该代次的所有租约。启动时仅在确定所有剩余租约进程已退出后回收非活动代次，并且仅在确定所属进程已退出后清理遗留暂存；所有者未知或进程标识已复用时保留文件。

[清单](src/resource-inventory.ts) 为随附安装和发布打包使用相同的路径过滤与 UTF-8 换行规范化规则。随附安装包含 LICENSE 和 NOTICE，并报告 `source.kind = bundled`；内容派生版本不表示发生了网络下载。[归档校验器](src/resource-files.ts) 拒绝路径穿越、重复或冲突路径、链接、特殊文件、损坏的 ZIP 记录及超出配置限制的解压内容。

</details>

<a id="model-experience"></a>
## 模型体验

通过官方技能消费者间接生效。已安装条目贡献发现元数据；选定技能贡献正文和目录资源。资源管理不新增工具、系统提示文本或评估权限。官方技能消费者负责记录加载到模型可见上下文中的内容。

#### KV Cache 影响

无直接影响。资源变化影响后续技能发现和选定正文；已经记录的技能内容仍保留在其 Session 中。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 不假设存在公开发布端点。操作者提供并信任 HTTPS 清单来源；SHA-256 校验一致性，不提供独立发布者签名。
- 归档使用 ZIP32 stored 或 deflate 条目。拒绝加密、分卷和 ZIP64 归档。资源脚本作为数据复制，安装期间不执行。
- 写入进程崩溃遗留的锁，需要操作者确认其已停止后恢复。未知暂存和租约保守保留；遗留文件可能占用磁盘空间。
- 技能内容属于指导。授权仍由 assessment-scope 服务负责；资源管理不编辑 findings 或报告。

不发布 runtime invariant companion：提交资源标识与租约所有权由同一组持锁存储操作强制维护；注册唯一性和效果销毁仍由官方技能注册表负责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

源码资源仍是审核输入。修改发布打包时保留其许可信息和共享清单规则。[模型可见回归](tests/model-visible.spec.ts) 执行随附安装、官方技能调用和真实 Agent 轮次，随后重新打开持久化 Session，将完整指令正文与[录制的预期输出](tests/expected/managed-security-skills.json) 比较。

</details>
