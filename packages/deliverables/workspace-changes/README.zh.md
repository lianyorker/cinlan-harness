---
description: "通过 git 快照和文件工具捕获提供逐轮改动文件摘要与对比；配置、存活 Session 的生命周期及覆盖限制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-changes

[English](README.md) | 中文

## 概述

查看顶层轮次改动了哪些文件、行数，以及每个文件在轮次前后的对比。Git 快照排除此前未提交的改动，整文件捕获则覆盖文件工具在快照范围外改动的路径。没有 git 或仓库时，只列文件工具的编辑。摘要和对比内容在 Host 进程中保留到 Session 被 dispose（资源释放），并在这段时间内占用临时磁盘空间。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 Session 存储和本地子进程提供方一起挂载本插件。Git 启用工作树快照；缺少 git 时仍可捕获文件工具的编辑。

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-workspace-changes'
```

所有限值都必须是正的安全整数。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `30000` | 每条 git 命令允许运行的毫秒数 |
| `outputMaxBytes` | `8388608` | 保留的 git 标准输出字节数；diff 列表过大时放弃本轮记录 |
| `maxFiles` | `500` | 每份摘要列出的文件数；总数包含省略的文件 |
| `maxFileBytes` | `2097152` | 捕获文件或读取快照一侧进行对比时的字节上限，包含等于上限的情况 |
| `diffTimeoutMs` | `100` | 逐行对比退化为整文件替换之前允许运行的毫秒数 |

记录器观察有工作目录的 Session，排除 subagent 来源和委派深度为正数的 Session。每轮首次调用 `write`、`edit` 或有修改作用的 `str_replace_editor` 之前捕获对应路径。快照覆盖的路径使用 git 行数；被忽略的路径和仓库外路径使用捕获内容。没有快照时，每次文件工具编辑都使用捕获。同一路径的重复编辑只计一次，也包括随后对该捕获路径的 shell 编辑。未变化的捕获会被省略；两侧都超限时仍列出，因为其内容未知。

每条 `workspace/changes` 事件携带轮号。`ctx.workspaceChanges.summary(sessionId, seq)` 返回其摘要，`ctx.workspaceChanges.diff(sessionId, seq, index, signal)` 对比该摘要下标所列的文件。记录或文件不可用时，服务返回 undefined。调用方取消会使待处理读取被拒绝；Session 被 dispose 后内容不可用。文本对比带三行上下文，`binary` 和 `oversized` 结果不含文本，`coarse` 标记超过时间预算的对比。完整返回字段见[服务类型](src/types.ts)。

文件按使用斜杠分隔的 `display` 路径排序：工作目录内为相对路径，工作目录之上的仓库文件用 `../`，家目录下用 `~/`，其余为绝对路径。文件的 `path` 在工作目录内为相对路径，在其他位置为绝对路径；Windows 绝对路径保留原生分隔符。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

[记录器](src/recorder.ts) 为每个 Session 串行处理基线快照、捕获和轮末记录。工具执行前等待队列中的工作完成。私有 index 和对象库将快照写入与仓库的普通 index 和对象库隔离；已提交对象通过 alternate 读取。捕获副本按内容寻址，有界读取最多消耗 `maxFileBytes + 1` 字节。对比读取保留的快照或副本，因此后续编辑不会改变它们的内容。

[Git 命令](src/git.ts) 通过子进程提供方运行，使用净化后的环境、有界标准输出和标准错误、取消信号及截止时间。`GIT_CONFIG_COUNT=0` 排除键项会被凭据清理移除的环境索引配置。记录失败时给出警告并跳过该次尝试；后续轮次重试。Session 和插件被 dispose 时，中止排队工作并移除保留的记录和临时数据。

`agent/turn-stopping` 在轮次关闭前记录。后续工具结果允许在 `turn/end` 之后再次记录；同一轮最新事件取代较早记录，包括改动被撤回后的空结果。

**运行时不变式：** 不发布伴生入口。记录器共同拥有摘要、快照与捕获；没有独立维护的观察结果需要核对。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 产出物](../../client/ui-deliverables/README.zh.md)——渲染改动文件与对比。
- [子进程能力](../../subprocess/README.zh.md)——执行 git 命令并拥有其进程。
- [架构](../../../docs/architecture.zh.md)——Session 事件与轮次扩展点。

<a id="model-experience"></a>
## 模型体验

无，因为记录器只追加一条仅写日志、只有客户端读取的 `workspace/changes` 事件，不注册任何面向模型的内容。

#### KV Cache 影响

没有内容进入模型请求，因此不影响提供方缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

记录器在以下限制内报告观察到的轮次改动：

- 记录只在本 Host 进程内随存活 Session 保留；Host 重启后重新打开无法恢复先前的摘要或对比。
- 嵌套仓库与 submodule 内容被排除。快照范围之外，仅通过 shell 命令改动的文件不会出现；路径首次文件工具调用之前的改动也不会出现。
- 工作区外位于临时根目录下的草稿路径被排除。其他参与者在轮次中的编辑会被归入该轮。
- 快照存储包含每个未跟踪且未被忽略的文件，没有磁盘总量上限。Git split index 可以写入 `sharedindex.*`，git-lfs clean 过滤器可以写入仓库的 `.git/lfs`。
- 超限的捕获文件没有行数或对比；超限的快照文件保留 git 行数。二进制文件不提供文本。捕获对比忽略缺少末尾换行的差异；git 行数仍可能包含该差异。
- 对比可能向客户端披露被忽略的文件和工作区外文件。必须把这类内容留在 Host 上的部署应省略本插件。
- 粗略对比包含两侧文件的所有行，输入内容最多为两倍 `maxFileBytes`，另加 hunk 元数据和行前缀。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
