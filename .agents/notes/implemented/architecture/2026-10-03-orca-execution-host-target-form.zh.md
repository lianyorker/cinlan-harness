# Agent Note：执行主机页面编辑一条连接记录

Status: implemented

[English](2026-10-03-orca-execution-host-target-form.md) | 中文

## 问题

执行主机页面只保存标签与既有的 OpenSSH 别名。因此要添加目标，必须先在管理 Host 的 OpenSSH 配置里建好别名，而页面无法表达使用者真正想填的内容：主机、端口、账户、身份文件、代理命令、跳板主机、保活，或有限的断开超时。控制器既没有连通性探测，也没有读取 Host 既有 Host 条目的方法，于是操作者无法在不建立连接的前提下检查目标，也无法沿用已经写好的条目。

页面还以「配置记录」的形态呈现：已保存目标 id、版本与连接代次。那是所有者的词汇，不是操作者的。

## 决定

**保存的目标带一条可编辑的连接记录。** [CreateTargetRequest](../../../../packages/execution-host/execution-host-targets/src/types.ts) 新增可选 `connection`：port、username、privateKeyFile、proxyCommand、jumpHost、multiplex、keepAliveIntervalSeconds 与 connectTimeoutSeconds，全部可选且非秘密。保存的别名仍是目的地，因此 `ssh -F <config> -- <alias>` 不变；每个已保存的细化项都追加在插件自带 OpenSSH 选项之后，而 OpenSSH 对重复选项取后者，所以保存的字段会覆盖 OpenSSH 配置，未填写的字段则保持该配置不动。

`connection` 与 `SshExecutionConfiguration.endpoint` 刻意分开：endpoint 属于运行时安装写入、会话绑定捕获的**固定部署身份**，而 connection 是表单编辑的对象。连接器按 `connection ?? execution.endpoint` 拨号，因此从未部署过的目标也能完全按其记录描述连接与探测。领域仍为 version 2：新字段可选，已存的 version 2 记录照常解析，只改细化项的更新就是一次普通编辑。

**页面就是参考实现的表单。** [SshTargetForm](../../../../packages/client/ui-settings-hosts/src/client/TargetForm.tsx) 是两列对话框——标签与主机或别名、用户名与端口，然后是整行的身份文件——代理命令、跳板主机、复用连接、终端保持与断开期限收在 Advanced 折叠里。唯一的目的地字段会把它携带的内容折叠进旁边的用户名与端口字段，因此 `部署@build.example:2222` 会变成别名加目的地细节。卡片显示状态点、行内状态摘要、标签、`账户@别名:端口 • 身份文件 • 终端保持`、失败时的一行具体原因，以及 编辑、删除、测试、连接。

已连接的目标还会提供「重置远程中继」：对一个已持有连接的目标再次连接，会关闭正在运行的 worker 实例并重拨一个新的，因此卡片无需额外的 Host 操作就能提供这次替换；替换被接纳期间该动作会收起。

Advanced 里两个开关只记录非默认选择。复用连接保存为 `multiplex: false` 的显式关闭，因为复用是能力默认值。「保持终端运行直到重置」让断开期限不设上限，并把字段锁成「直到重置」显示；关闭它才会把有限值保存为 `connectTimeoutSeconds`，其可接受范围同样是 60 秒到 7 天。表单显示的端口总会被保存，所以别名在 OpenSSH 配置里用别的端口时必须在此填写该端口——导入预填会自动填好。

**探测与导入都是 Host 侧读取，不是连接。** `ctx.executionHostTargets.test` 拨一次一次性连接且不发布任何状态；卡片直接渲染它的稳定错误码（unreachable、authentication-required、host-key-mismatch、timeout、incompatible）。新增的 `listImportableHosts` Remote 读取 `config.sshConfigFile ?? ~/.ssh/config`，返回具体 Host 条目及其首个取值的 HostName、User、Port、IdentityFile、ProxyCommand、ProxyJump，跳过通配与取反模式以及 `Match` 块之后的全部内容，且从不写回该文件。导入对话框只负责预填表单，保存仍是独立的一次确认。

**本拨号路径无法兑现的细化项只如实记录，不假装生效。** 该连接固定带 `-S none`，所以复用连接的关闭项不细化它；它仍被保存，因为 SSH 执行能力会为捕获的部署消费它。参考实现的「终端中继」语义没有单独实现——开关与它解锁的字段都映射到记录的连接截止时间。参考实现的卡片还有另一个图标用于结束远程终端。该动作**不渲染**，而不是渲染成一个永远不能执行的控制项：worker 只声明 `['directory-inspection']`，此外什么都没有，而本产品的终端会话按所有者归属于管理 Host，因此已保存目标并不拥有可结束的远端终端。私钥口令没有通道：`test` 与 `connect` 只接受精确版本，且连接固定 `-o BatchMode=yes`，没有任何提示可答。因此页面把 `authentication-required` 报成「配置密钥或智能体」的问题，而不是收一个用不上的秘密；口令对话框继续挂起。

## 考虑过的替代方案

**由表单直接创建完整执行部署。** `execution` 需要运行时安装验证过的部署身份——远程 Node、helper、哈希、工作区与两个 bootstrap 字段。表单若凭空生成，会得到一条无法解析的记录；因此页面编辑连接，把部署留给运行时安装器。

**保留只认别名的页面，一切交给 OpenSSH 配置。** 这正是本纪要要替换的状态：设置行收集了一个必须在别处先创建的值，而 Advanced 字段根本无处安放。

**在浏览器里读 OpenSSH 配置。** 该文件在管理 Host 上；只有 Host 侧读取能看到它，也只有 Host 能把密钥内容挡在响应之外。

**给 connection 单独的 `host` 字段。** 别名已经是目的地。再加一个 host 会让同一个问题有两个答案，SSH 执行能力还得在两者间挑选。

**沿用第一版按文字规格写出的呈现。** 那一版把分区操作放在页头、用窄的单列表单，并把「保持终端运行」绑到保活间隔上。改为对照参考实现构建之后，操作回到了分区行上，两列表单与联动的断开期限被还原，而一个没有任何消费者的保活字段被去掉。

## 后果

目标现在可以在完全不碰管理 Host OpenSSH 配置的前提下添加、探测、连接、编辑与删除，而「仅别名」记录的行为与从前逐字一致。导入让既有 OpenSSH 配置可被复用，且不修改它。

新增一个 Host Remote 方法有一个容易漏掉的构建步骤：`scripts/build-remote-contracts.ts` 只写 `lib/typert.remote-client.*`，而 Host 侧参数 schema 在 `lib/typert.host.js`，由 host face 构建产出。源码启动会注册陈旧的描述符并静默剥离新方法声明的参数，看起来像所有者侧的持久化缺陷。为该贡献包重新生成 host 描述符即可修复；完整的 `build:lib:host` 对所有贡献包做同样的事。

页面自己拥有标题。该分区以 `heading: 'feature'` 注册，设置外壳因此不再渲染页标题；导航项保留功能名（`navLabel`），页面渲染完整界面名（`title`）。其下只有目标列表：一句说明，然后是拥有操作、空状态与列表行的 `hosts` 面板。运行时安装面板、只读的本机 Host 来源信息、目录检查，以及「不可用」的会话默认值三行都已从本页移除。它们的 Remote 方法与 Host 服务原样保留——撤下的只是本页的界面，因此这里不会再悄悄调用页面已不再展示的能力。

## 测试

`packages/execution-host/execution-host-targets/tests/connection.spec.ts` 断言追加细化项的顺序、缺省身份文件时不追加 `-i`、记录里的端口会拨到监听中的夹具而不是别名配置的端口，以及探测确实用记录的身份文件完成认证。`tests/import.spec.ts` 覆盖具体 Host 解析、通配与 `Match` 处理、文件缺失与不可读路径的错误码。`packages/client/ui-settings-hosts/tests/hosts-section.client.spec.tsx` 覆盖目的地拆分、校验、Advanced 折叠及其联动期限、探测及其类型化失败、删除二次确认与导入预填。`tests/loader.client.spec.tsx` 保留本包的真实 Loader 组合用例：经生成的 Remote 编解码器、渲染器与语言运行时编辑一条已保存目标。页面也在真实服务上用浏览器做了端到端实操。
