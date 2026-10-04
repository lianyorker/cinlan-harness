# 执行主机：完整端点模型方案（对齐 Orca SSH 远程主机）

目标：把 设置 → 执行与安全 → 执行主机 按 **Orca 的 UI**（不沿用现有页面）重做成「SSH 远程主机」形态——端点在应用内配置（host/port/user/identity file + 代理/跳板/复用/超时），目标列表支持导入、添加、测试、连接、编辑、删除。

这是对既有设计的一次**策略变更**，不只是 UI：

- [dsh-ssh README](../../packages/ssh/ssh/README.md) 规定部署配置的 host 字段是「Existing OpenSSH host alias」，并写明「别名、认证与流能力属于部署私有细节，由消费者自己持有」。
- [ui-settings-hosts](../../packages/client/ui-settings-hosts/README.md) 因此只存「标签 + 别名」，明确不收集主机名、端口、密钥或远端命令。
- Orca 的 SshTargetForm 反过来：标签 / 主机或别名 / 用户名 / 端口 / 身份文件，Advanced 里还有代理命令、跳板主机、复用连接、保持终端、断开超时；目标卡片提供 测试 / 连接 / 编辑 / 删除，页头提供 导入 / 添加目标。

## 数据模型

一个 SSH 目标（持久、按 Host 保存）：

- id、label（展示名）
- host（主机名或 OpenSSH 别名；两者都允许，导入时通常是别名）
- port（默认 22）、username（默认取本机当前用户或 ssh 默认）
- identityFile（Host 上的**路径引用**，不是内容）
- proxyCommand、jumpHost（ProxyJump）、multiplex（ControlMaster/ControlPersist 开关）、keepAlive（ServerAliveInterval）、disconnectTimeoutSeconds（直到重置 / 60 秒–7 天）
- 派生只读：状态（未知 / 可达 / 不可达 / 连接中）、上次测试时间与原因

密钥口令与密码**不落库**：需要口令时由 Host 现场向浏览器索取一次并只用于本次连接（对应 Orca 的 SshPassphraseDialog）。

## 四层改动

### 1. 能力层 dsh-ssh

部署配置从「别名」扩展为「端点」：新增 target 字段（结构化端点），保留 host 别名路径作为兼容与默认。连接构造按字段生成参数：-p、-i、-o ProxyCommand=、-o ProxyJump=、-o ControlMaster/ControlPersist、-o ServerAliveInterval、-o BatchMode=yes 用于测试。README 与部署说明同步改写，说明端点现在由应用层提供、认证细节仍留在 Host。

### 2. Host 服务与持久化

执行主机域新增目标仓库与生命周期服务：list / upsert（带 revision 冲突检查）/ delete / test / connect。test 执行一次非交互 SSH（BatchMode）并返回稳定结果码；connect 复用现有执行主机连接与运行时安装流程。持久化沿用设置的 revisioned 写入（命名空间建议 execution-hosts），既有「标签 + 别名」记录迁移为 host=alias 的目标。

### 3. Remote 控制器

在现有执行主机 Remote 上增加方法：listTargets / upsertTarget / deleteTarget / testTarget / connectTarget，错误码沿用执行主机的稳定分类（invalid-request、ssh、conflict、unavailable、cancelled），口令提示作为一次性请求-响应而不是持久字段。

### 4. 设置页 UI（按 Orca，不沿用现有页面）

**决定：直接照 Orca 的 SshPane / SshTargetCard / SshTargetForm / SshHostAdvancedFields 结构与文案重做执行主机页**，现有 ui-settings-hosts 的界面不保留（其 Remote 与服务接线继续复用）。

页面结构（对照 Orca）：

- 页头：标题「执行主机」+ 说明「通过 SSH 使用已有机器处理文件、终端、Git 和工作区。」右侧两个动作：**导入**、**添加目标**。
- 「目标」分区：说明「添加远程主机以在会话中连接到它。」；无目标时给空状态 + 同一对动作。
- 目标卡片（SshTargetCard）：左侧状态点 + 行内状态摘要；主行 label；次行「用户名@主机:端口 · <保活策略>」；失败时下方一行具体原因（如「连接到 X 已在进行中」「Connection refused」「身份文件不可读」）；右侧动作：**测试**、**连接**、**编辑**、**删除**（删除走二次确认）。
- 添加/编辑对话框（SshTargetForm）：
  - 标签（占位「我的服务器」）
  - 主机或别名（必填；占位「服务器, 部署@服务器: 2222, ssh: 别名」——支持裸主机、用户@主机:端口、ssh 别名三种写法）
  - 用户名（占位「部署」）
  - 端口（默认 22）
  - 身份文件（占位 ~/.ssh/id_ed25519；说明「可选。默认使用 SSH 智能体。」）
  - **Advanced** 折叠（SshHostAdvancedFields）：代理命令（占位「例如 cloudflared access ssh --hostname %h」，说明「可选。用于隧道（例如 Cloudflare Access、ProxyCommand）。」）、跳板主机（占位 bastion.example.com，说明「可选。相当于 ProxyJump / ssh -J。」）、**复用 SSH 连接以加快设置**（开关；说明「可用时使用 OpenSSH 多路复用。对于有自定义 SSH 限制的主机，请关闭此项。」）、**保持终端运行直到重置**（开关）、**断开连接后的超时时间（秒）**（占位「直到重置」，说明「有限超时时间必须介于 60 秒到 7 天之间。」）。
  - 底部：取消 / 添加目标（编辑时为 保存）。
- 口令对话框：需要私钥口令时现场索取一次，只用于本次连接，不持久化。
- 导入：读取 Host 的 OpenSSH 配置里的 Host 条目，逐条预填表单供确认后保存（不写回该文件）。

文案全部走字典（中英），且与 Orca 的措辞逐条对齐；布局沿用我们的设置页容器（标题/说明/卡片），不再自造交互。



## 兼容与迁移

- 既有目标（只有标签与别名）自动成为 host=alias 的记录，界面显示为「别名模式」，编辑时才展开端点字段。
- 工作区/会话已捕获的执行绑定不变；本机 Host 仍是只读记录。
- 运行时安装（指纹、私钥引用、远端 Node 路径）保持现状，只把「连接什么端点」换成目标。

## 验证

- 能力层：端点参数构造单测（每种可选项各一条断言 + 非法组合拒绝）；一条真实 sshd 或 mock ssh 的组合测试。
- 服务：list/upsert/delete 的 revision 冲突、test 的结果码映射、口令一次性使用。
- Remote：方法契约与错误码透传。
- UI：表单校验、Advanced 折叠、列表操作、导入预填；组件测试 + 人工实测（添加真实目标 → 测试 → 连接 → 编辑 → 删除）。

## 阶段建议

1. 能力层端点支持 + 单测（可独立验证：命令行等价参数）。
2. Host 目标仓库与 test/connect 服务 + 持久化与迁移。
3. Remote 方法。
4. UI 表单与列表（先列表 + 测试/连接，再 Advanced 与导入）。
5. 文档：dsh-ssh README、ui-settings-hosts README、执行主机域文档、Agent Note。

## 实施进度

### 步骤 1 · 能力层端点支持（已完成，待 POSIX 测试）

packages/ssh/ssh/src/index.ts：

- Config 新增可选端点字段 port、username、identityFile、proxyCommand、jumpHost、keepAliveIntervalSeconds、connectTimeoutSeconds（schema 同步校验范围）。
- 新增私有 connectionArgs()：固定顺序生成 -p / -i / -o ProxyCommand= / -o ProxyJump= / -o ServerAliveInterval= / -o ConnectTimeout=，末尾拼目的地（username@host 或原样别名）；控制命令与复用主连接两处调用点统一走它。配置的保活值排在插件自带 ServerAliveInterval=10 之后，OpenSSH 后者胜出。
- 不填任何端点字段时命令行与改动前逐字相同（别名路径零变化）。
- **复用 SSH 连接做成真实行为**：新增 multiplex（schema 默认 true）。关闭时主连接不再带 -M / -S <socket> / -o ControlPersist=no；而 -O forward / -O cancel 这条转发流通道（-L unix socket，helper 的流能力依赖它）会抛出明确错误，说明该部署关闭了多路复用、转发流通道不可用，而不是留下半开的连接。

**测试**：新增 tests/endpoint-arguments.spec.ts（沿用该包既有的 child_process/net/tls mock 驱动，断言真实 spawn argv）：缺省时与别名路径逐字一致且不带任何端点选项；七个端点字段各生成一个选项、目的地拼成 用户@主机、配置的 ServerAliveInterval 排在插件默认值之后；multiplex 关闭时主连接不含 -M / -S / ControlPersist=no。

**已知限制**：仓库的 vitest 项目 process-bound **显式排除** packages/ssh/{ssh,subprocess-ssh,sandbox-ssh}/tests/**，所以这些 spec（含新增的这条）在 Windows 本机无法运行，只在 POSIX/宿主测试通道执行。本机只做到 tsc -b packages/ssh/ssh 干净，新增 spec 尚未在本地获得执行证据。

### 待办

步骤 2 Host 目标仓库（list/upsert/delete/test/connect、revision 冲突、旧记录迁移）、步骤 3 Remote 方法、步骤 4 按 Orca 重做 UI、步骤 5 文档与 Agent Note。

### 步骤 2 落点地图（已核实，未开始实现）

| 角色 | 包 | 改动内容 |
|---|---|---|
| 目标仓库与模型 | packages/execution-host/execution-host-targets（src/types.ts、src/index.ts） | 目标记录加端点字段（port/username/identityFile/proxyCommand/jumpHost/multiplex/keepAlive/connectTimeout）；list / upsert（revision 冲突）/ delete / test / connect；旧「标签+别名」记录迁移为 host=alias 的端点目标 |
| 能力定义 | packages/execution-host/execution-host（src/types.ts、src/index.ts） | 目标解析后的连接描述：由端点或别名产生 ssh 参数，供本地与 Worker 实现共用 |
| 本机实现 | packages/execution-host/execution-host-local | 用解析出的连线参数启动，替换现在只认别名的路径 |
| Remote | packages/api/execution-host-controller（src/index.ts、src/types.ts） | 新增 listTargets / upsertTarget / deleteTarget / testTarget / connectTarget，错误码沿用执行主机的稳定分类；packages/api/remotes/src/client/index.ts 的客户端门面同步 |
| 设置页 | packages/client/ui-settings-hosts（src/client/index.ts、callbacks.ts、locales.ts） | 按 Orca 重做：目标卡片 + 添加/编辑对话框 + Advanced + 口令对话框 + 导入；现有界面不保留 |

**前置依赖**：步骤 1 的 ssh 能力层改动（端点参数 + multiplex 语义）已就绪。**验证**：execution-host-targets 的单测可在本机跑（非 SSH 通道）；端到端连接仍只在 POSIX 通道验证。

### 步骤 2 复核结果：目标仓库已存在，任务是「扩展」不是「新建」

读 packages/execution-host/execution-host-targets 后发现该域已经有完整的 SSH 端点模型与带 revision 的持久化，比原方案假设的起点高得多：

- types.ts 已有 SshExecutionConfiguration（endpoint: host / port / username / privateKeyFile / **hostKeySHA256**，外加 node / helper / helperHash / workspace / bootstrap 两字段）与 SshExecutionSnapshot（kind ssh、targetId、revision、endpoint、部署身份）；ExecutionBinding 把 local 与 ssh 两种绑定统一起来。
- index.ts 已有 add / update（mutateInvalidatingExecution，普通编辑会使所有保留的执行修订失效）/ activate / capture / executionSnapshot、live target 与 retainedExecutions 映射、事件与 Service.init 生命周期。

因此阶段 2 的真实缺口收窄为四点：

1. **模型补字段**：现有端点是 host/port/username/privateKeyFile/hostKeySHA256，缺 Orca Advanced 里的 proxyCommand（代理命令）、jumpHost（跳板主机）、multiplex（复用连接）、keepAlive、connectTimeout。补进 SshExecutionConfiguration 与 SshExecutionSnapshot 需要同时更新 spec.ts 的 schema 与执行快照的指纹内容（hostKeySHA256 已做主机密钥固定，比 Orca 更严，保持不变）。
2. **test 操作**：Orca 每个目标有「测试」；本域今天只有连接与运行时激活。需要加一次非交互连通性检查（BatchMode、短超时、不落地任何状态），并给出稳定结果码。
3. **消费端接线**：把新字段接到实际起连接的地方（本机实现或 SSH 提供者），并确认与步骤 1 的 dsh-ssh 端点参数是同一套语义（注意：dsh-ssh 是「POSIX harness ↔ POSIX host」的 FS/subprocess 能力，execution-host-targets 是「远程执行 worker」，两者是不同的层，不能假设已经共用）。
4. **Remote 与 UI**：execution-host-controller 暴露新字段与 test；ui-settings-hosts 按 Orca 重做。

**结论**：阶段 2 的首个可交付切片是「模型 + schema + test 操作」。

### 切片 2.1 · 端点高级字段（已实现，测试受阻）

改动：

- types.ts 新增 SshEndpointOptions（proxyCommand / jumpHost / multiplex / keepAliveIntervalSeconds / connectTimeoutSeconds，全部可选且非秘密），并把它并入 SshExecutionConfiguration.endpoint 与 SshExecutionSnapshot.endpoint——因为这些字段是"怎么连"的描述，必须随执行快照一起固定，不能只在保存记录里。
- spec.ts：endpointOptions 展开进 publicEndpointSchema（保留 strictObject：未知字段仍被拒），范围校验与 ssh 能力层一致（保活 ≤86400、连接超时 ≤604800 秒）。
- index.ts：executionSnapshot() 把五个字段可选地并入快照 endpoint（未设置时不写入，保持既有快照逐字不变）。

验证状态：

- tsc -b packages/execution-host/execution-host-targets 干净。
- 测试原本无法加载：tests/harness.ts 导入 ssh2，但该包**没有声明** ssh2（它只装在 packages/execution-host/execution-runtime 下），pnpm 严格链接下解析不到。已在该包 devDependencies 补上 ssh2 ^1.17.0。
- 补齐后 spec 可运行：execution.spec.ts 25 个用例中 14 通过、11 失败，错误统一为 TypeError: Cannot read properties of undefined (reading 'list')。**用 git stash 把我的 src 改动移开后，同一个用例以完全相同的错误失败**，因此这 11 个失败是既有问题，不是本切片引入。
- ~~**lockfile 待补**~~（已验证排除，见文末 lockfile 一节）：早先 EBUSY 只能用 --lockfile=false 链接依赖，故担心 ssh2 未写入 lock；实测 pnpm install --frozen-lockfile 退出码 0。

因此本切片的行为证据仍需 CI/Linux：现有失败是既有问题，我的新增字段是纯可选、不写入即不改变既有快照形状。

### 步骤 2.0（a）既有失败定位（进行中）

证据链：

- 失败点是 tests/execution.spec.ts:252 的 targets.list()，而 targets 来自 harness.ts:105 的 ctx.executionHostTargets——即**服务根本没被提供**，不是断言不符。
- harness 在 102-104 行只检查 Loader 条目存在（fiber !== undefined），所以条目激活了、但其 [Service.init] 大概率失败，导致服务未 provide。
- 触发条件很明确：该用例在调用 registry() **之前**，先往 harness 配置的存储目录（root/storage）写了一份 **version: 1** 的 execution_host_targets.json。也就是说领域在挂载这份旧版存储时失败。
- 这个用例的意图恰恰是「保留 version-one 别名记录并把下一次写入标记为当前领域版本」，所以它现在的失败指向 **v1→v2 迁移路径**，而不是 Windows 环境差异（harness 的 win32 分支只处理私钥 ACL）。
- 用 git stash 移开本次 src 改动后同样失败，确认与切片 2.1 无关。

下一步（未做）：把 Service.init 的真实报错取出来（Loader 吞掉了它，需要读 fiber 的错误或 loader 诊断），并核对领域定义的版本与迁移声明（defineDomain / domainTable 是否存在 v1→v2 迁移）。确认后再判断是补迁移还是修版本声明。

另外注意：execution.spec.ts 没有平台守卫（targets.spec.ts 的 22 个用例在本机是整体 skipped），所以本机这 11 个红用例既可能是真缺陷，也可能混着环境因素；上面的定位只对已取证的这一条成立。

### 步骤 2.0（a）续：领域声明与 init 路径已读

事实：

- 领域声明为 defineDomain({ name: execution_host_targets, version: 2, compatibleVersions: [1], tables: { targets: domainTable(savedTargetSchema) } })——即**声明**兼容 v1。
- savedTargetSchema（v2）= createTargetSchema（label、sshAlias、execution 可选）+ id/revision/createdAt/updatedAt + retainedExecutions 默认 {}；用例写入的 v1 记录（label、sshAlias、时间戳）本身满足该 schema。
- Service.init：先 await ctx.storageDomain.open(executionTargetsDomain)，再取 table、遍历校验 key 与 record.id 一致。
- harness 的 registry() 只检查目标条目 fiber 存在，不检查它是否 **active**；因此「条目 pending（等待某个服务）或 init 抛错」都会表现为 ctx.executionHostTargets 为 undefined，与观察到的错误一致。

收敛后的假设（待最后一步取证）：

1. 那 11 条里至少包含两种原因：一类是「重启/二次 registry()」路径（继承既有状态），一类是本条「打开 v1 存储单元」。
2. 对本条而言，最可能是**打开 v1 单元失败**：领域声明 compatibleVersions: [1] 只表达可兼容读取，而底层 storage-json/domain 在 open 时按当前 version 校验，缺少 v1→v2 的迁移就会拒绝——这正是该用例要守住的行为，所以它更像**真回归**而不是环境问题。
3. 其余 10 条我没有逐条取证，不能并入同一结论。

最后一步（未做）：把 init 的真实报错取出来——在 harness 的 registry() 里读取 entry.fiber 的状态与错误（或临时打印），即可区分「pending（缺服务）」与「failed（open 抛错）」；据此再决定是补 v1→v2 迁移、还是修 storage-domain 的 open 语义。

### 步骤 2.0（a）取证结果：条目 **failed（state 3）**，不是 pending

在 harness 的 registry() 里临时加诊断（打印每个 Loader 条目的 fiber 状态与 storageDomain 是否可用），单跑该用例得到：

```
DIAGNOSTIC target service missing | cordis:include=state:2 | @deepseek-ai/dsh-storage=state:2 |
@deepseek-ai/dsh-storage-json=state:2 | @deepseek-ai/dsh-storage-domain=state:2 |
@deepseek-ai/dsh-execution-host-local=state:2 | @deepseek-ai/dsh-subprocess-local=state:2 |
@deepseek-ai/dsh-execution-host-targets=state:3 | storageDomain=true
```

结论（已取证）：其余条目 state 2（活跃），只有 targets 是 **state 3（failed）**，且它依赖的 storageDomain 已提供。所以是 **[Service.init] 内部抛错**，不是缺服务；Loader 吞掉了具体报错，harness 只看到 ctx.executionHostTargets 为 undefined。诊断补丁已撤回。

补充读到的事实：storage-domain 的声明文档写明 compatibleVersions 的语义是「当前记录 schema 能读的旧版本，读到就按当前 schema 解释、写入总是盖当前 version」——按此，v1 单元本应可读。因此「v1 被拒」这一层还需要**真实报错**才能确认；仍可能的原因包括该 JSON 存储单元的装载、或旧记录未过 savedTargetSchema。

下一步（唯一未做的一步）：把 init 的真实错误取出来——读取 fiber 的错误字段（先打印 Object.keys(fiber) 看它是否暴露）或临时在插件的 init 外层加 try/catch 打日志；拿到报错后即可定性：补 v1→v2 迁移、修存储单元装载、还是修记录 schema。

### 步骤 2.0（a）结论：unit 级版本校验没有采纳 compatibleVersions

真实报错（临时在插件 init 外层 catch 打印，已撤回补丁）：

```
StorageError: unit 'execution_host_targets': stored version 1 != expected 2
  code: 'version-mismatch'
```

即 storageDomain.open 在**读取存储单元头**时就按当前 version(2) 拒绝了 stamped version 1 的单元，根本没走到逐记录 schema 兼容那一步；因此领域声明里的 compatibleVersions: [1] 对这条路径**不起作用**。这与 storage-domain 自己的文档描述不一致——那里写的是「当前记录 schema 能读的旧版本会按当前 schema 解释、写入总是盖当前 version」，而该语义看起来只作用于记录级（projection cache / 逐记录版本），不作用于单元头版本。

因此该用例失败是**真缺陷**，位置在存储层而非目标域：

1. 让 storageDomain.open 在单元头版本校验时采纳 compatibleVersions（列为兼容的旧单元按当前 schema 读、写入时盖新版本）；或
2. 明确 compatibleVersions 只对记录级生效，则目标域若要支持 v1 单元就必须显式声明迁移。

两种都属存储层的语义决定，需按该包的既有设计意图（docs/architecture 或该包 README）择一，而不是在目标域里绕。**其余 10 条失败仍未逐条取证**，不能假设同源。

### 步骤 2.0（a）最终结论：存储层无过错，是测试期望与「无迁移」规则冲突

storage-domain 的 README 明确规定（第 153 行）：

> **No data migration** — a domain whose stored version differs from its spec rejects at open (version-mismatch); changing a schema requires migrating stored data by hand.

中文版同义：没有数据迁移——领域的已存版本与 spec 不同时，打开即被拒绝；改 schema 需要**手工迁移**已存数据。

而 compatibleVersions 在代码里的注释是记录级的（stored records / documents stamped with a listed version，写入总是盖当前 version），并不作用于**单元头**版本。两者并不矛盾：单元头必须匹配，记录可以带旧版本戳。

所以结论要修正：**不是存储层没采纳 compatibleVersions，而是那条用例在断言一个文档明确不支持的行为**——它期望 v1 单元被自动接受、并在下次写入时盖成 v2，而按既定语义，v1 单元必须在 open 时以 version-mismatch 拒绝，需要手工迁移。

因此（a）的修法不再是改 storage-domain，而是二选一的产品决定：

1. **改测试期望**：该用例改为断言 v1 单元以 version-mismatch 拒绝（与文档一致），并另立一条手工迁移的用例；
2. **改领域决定**：如果这个域确实要在 v2 上继续吃 v1 数据，就必须为它提供一条显式的迁移路径（文档说的 hand migration），而不是依赖 compatibleVersions。

这也解释了为什么 11 条红里会出现「既可能是真缺陷也可能是环境因素」的混乱：至少已取证的这条是**测试与文档的冲突**，不是运行环境问题。其余 10 条仍未逐条取证。

### 步骤 2.0（a）收尾：11 条红已归为「1 条测试期望 + 10 条既有同因」

1. **已修（选项 1）**：把那条用例改名为 refuses a stored version-one unit at open…，断言改为「存储层无迁移规则」下的真实结果——服务不被发布（targets 为 undefined），且存储单元保持 version 1 不动，并附上 storage-domain README 的原文作为依据。改后该用例通过，该文件从 11 红降到 10 红。

2. **剩余 10 条：已证明是既有失败，且同因**。

- 失败签名完全一致：AssertionError: expected { endpoint: { …(5) }, …(7) } to deeply equal { endpoint: { …(5) }, …(6) }——即**接收方比期望方多一个顶层键**。
- 用 git stash 把我的 src 改动移开后再跑整个文件：仍是同样的 10 条、同样的签名 → 与切片 2.1 无关（改动已 pop 回来）。
- 因此不是十个独立缺陷，而是**一处期望与实际对象不一致**（很可能是测试的期望构造器少写了一个字段，例如 retainedExecutions），修一处即可望清掉全部 10 条。

下一步（未做）：把该断言的接收对象与期望对象的键打印出来对比，定位多出的那个键，再决定是补期望构造器还是修生产对象。

### 步骤 2.0（a）完成：多出的键是 host（= 目标的 sshAlias）

定位过程与结论：

- 断言形态是 expected { endpoint: { …(5) }, …(7) } to deeply equal { endpoint: { …(5) }, …(6) }，即接收方 8 个顶层键、期望方 7 个。
- 期望方由测试的 deployment(root) 构造：endpoint + node/helper/helperHash/workspace/bootstrapPath/bootstrapHash（**没有 host**）。
- 接收方是 targets.resolveExecution(...) 的返回值，它是 **ssh 插件配置**：host（= 目标记录的 sshAlias，如 inspection）+ endpoint + 同一批部署字段。
- 也就是说 alias 仍是 ssh 的目的地，而 endpoint 只是对它的细化；测试期望停留在「只有 endpoint」的旧形态。

已做的修法（两处，均在 tests/execution.spec.ts）：

1. 断言改为匹配子集并显式验证 host：expect(resolved).toMatchObject(execution) + expect(resolved.host).toBe(target.sshAlias)，并加注释说明「alias 仍是 destination，endpoint 细化它」。
2. 重载后的整对象比较：expect(...).toEqual({ host: target.sshAlias, ...deployment(h.root) })。

进展：该文件 11 红 → **9 红、16 绿**（已修：version-one 单元用例按文档改期望、captures frozen deployment identity 用例）。

剩余 9 条**同一模式**，机械修法：把「resolveExecution 结果 / resolved 配置」与 deployment(...) 的 toEqual 比较补上 host（或改用 toMatchObject，并单独断言 host）。涉及用例：retains exact predecessor deployments…、contains a throwing change subscriber…、activates an inspection-only target…、serializes activation races…、rejects a durable retained revision 0/1/2/invalid…、refuses stale and deleted bindings…。

### 步骤 2.0（a）剩余 9 条：完整比较点清单

全是同一处形态漂移：resolveExecution 返回 ssh 插件配置（host + endpoint + 部署字段），测试仍按「只有 endpoint」的旧形态断言。需要补 host 的比较点（行号为当前文件状态）：

47、48、55、56、57、61、98、124、182、188、320、322、325（242-243 已修）。

统一修法（建议加一个 helper，避免每处手写）：

```
function resolved(sshAlias: string, execution: SshExecutionConfiguration) {
  return { host: sshAlias, ...execution }
}
```

调用点改为 expect(...).toEqual(resolved(<该目标的 sshAlias>, <期望的 deployment/execution/replacement>))；alias 取被比较目标记录的 sshAlias 字段。注意 57 行期望的是 thirdDeployment、48/98/322 期望 replacement——每一处的 alias 要与其**对应目标**一致，不能一律套 inspection。

进展：11 红 → **9 红 / 16 绿**。剩下这 9 条只需按上表逐个补 alias 期望，属于机械修改，但每条要用它自己目标的 alias，需逐条读上下文，不能批量替换。

### 步骤 2.0（a）最终进展：11 红 → 4 红 / 21 绿

已修（7 条）：

- version-one 单元用例：按 storage-domain 的无迁移规则改期望（不发布服务 + 单元保持 v1）。
- 其余 6 条：统一根因是 resolveExecution 返回 ssh 插件配置（host = 目标 sshAlias + endpoint + 部署字段），而测试期望只有 deployment() 的 7 个键。新增 helper resolvedConfig(sshAlias, execution) = { host: sshAlias, ...execution }，并把 9 处比较点改为 resolvedConfig('inspection', …)（同名断言用 replace_all 一次覆盖）。
- 过程中另修一处命名冲突：helper 原名 resolved 与测试里的局部变量 resolved 撞车（TDZ ReferenceError），改名 resolvedConfig 后消失。

剩余 4 条（rejects a durable retained revision 0/1/2/invalid that is not a predecessor）：

- 它们不是 host 形态问题，失败被 vitest 的格式化错误 **PrettyFormatPluginError: cannot get property "$$typeof" without inject** 掩盖——真实断言不可见。
- 下一步：绕开格式化（对纯字段断言、或先捕获再打印），拿到真实差异再修。

结论沉淀：这 11 条红没有一条是运行环境问题——1 条是测试与存储层文档冲突，10 条是测试期望停留在 endpoint 模型之前，属同一处；其中 7 条已修，4 条待绕过格式化后定位。

### 步骤 2.0（a）收官：execution.spec.ts 25/25 全绿

起点 14 绿 / 11 红 → 现在 **25 绿**。四个根因（全部与运行环境无关）：

1. **测试与存储层文档冲突（1 条）**：那条用例断言 v1 单元会被自动接受并盖成 v2，而 storage-domain README 明确「无迁移、版本不同即拒绝」。改写为断言不发布服务 + 存储单元保持 v1。
2. **期望停留在 endpoint 模型之前（10 条，同一处）**：resolveExecution 返回的是 ssh 插件配置（host = 目标 sshAlias + endpoint + 部署字段，8 键），测试期望的 deployment() 只有 7 键。新增 helper resolvedConfig(sshAlias, execution) 并把 9 处比较点改过来。
3. **我自己的命名撞车**：helper 原名 resolved 与测试里的局部变量同名，触发 TDZ ReferenceError，改名 resolvedConfig 解决。
4. **最后 4 条的真因**：h.registry() 在条目 init 失败时**不会 reject**（返回 targets: undefined），所以 rejects.toThrow 失败，而失败值里带着 fiber/ctx，触发 vitest 的 React 格式化错误 PrettyFormatPluginError，把真实差异盖住。改为与 harness 契约一致的断言（targets 为 undefined；若领域接受了该记录则会发布服务）。

**打包缺口**：该文件此前**根本无法加载**——tests/harness.ts 导入 ssh2，而该包没有声明它。已补 devDependencies 声明并链接。

注意：targets.spec.ts 的 22 个用例在本机仍是整体 skipped（平台相关），未纳入本次验证。

剩余待办：切片 2.2 的 test 操作、消费端接线、Remote 暴露、按 Orca 重做的 UI。

### 切片 2.2 · test 操作（已完成并验证）

实现（packages/execution-host/execution-host-targets）：types.ts 新增 TargetTestValue（TargetValue + rootCount）；index.ts 新增 test(request, signal)：解析请求 → requireRevision 取记录 → 构造一次性 SshTargetConnection（record.sshAlias + record.execution?.endpoint）→ open(signal) → finally 中 close()。全程不写 live / states / generation，探测不会干扰进行中的检查连接、保留绑定或运行中的 worker；失败沿用连接的稳定错误码（unreachable / authentication-required / host-key-mismatch / timeout / incompatible）。

用例（execution.spec.ts 新增两条）：① 探测成功 rootCount=1、worker 只收到一次固定命令、目标状态仍为 disconnected（证明未发布连接）；② 拒绝认证时以 authentication-required 失败且状态不变。**当前 execution.spec.ts 27/27 绿，tsc -b 干净。**

剩余待办：Remote 暴露（execution-host-controller 增加 test 与端点字段）→ 按 Orca 重做 ui-settings-hosts → Git 线 README 与 Agent Note。

### 切片 2.2 · test 操作：设计（未写代码）

已核实的插入点：

- service 已在 index.ts:294 有 connect()/connectOperation()；连接对象是 connection.ts 的 SshTargetConnection（open(signal) → WorkerInfo，isUsable()，close()），错误类型是 ExecutionTargetError，TargetErrorCode 已包含 unreachable / connection-lost / cancelled / incompatible / conflict 等。
- connect() 的重量在于它会**发布状态**：写入 this.live / this.states（connecting → ready）、占用 generation、并在失败时置 error 状态。测试不该有这些副作用。

设计：

1. 新增 test(request: TargetRevisionRequest, signal?): Promise<TargetTestResult>，只读地取出目标记录，构造一个**一次性** SshTargetConnection，open() 后立即 close()，全程不写 this.live / this.states / retainedExecutions，也不占用 generation。
2. 结果形状：{ reachable: true, rootCount } 或 { reachable: false, code: TargetErrorCode, message }；用短 deadline（独立的 test 超时配置，而非 operationTimeoutMs）。
3. 并发：与 connect 相同的互斥（mutate 队列）只用于读取记录；探测本身不进入队列，避免长时间占用。
4. 测试：可复用现有 harness 的真实隔离 SSH 服务器（ssh2 已链接，本机可跑），覆盖「可达」「认证/主机密钥失败」「超时」「记录不存在」。

同时发现一个必须记下的接线缺口：connection 目前是用 `new SshTargetConnection(this.ctx.subprocess, this.config, record.sshAlias, onLost)` 构造的——**只用 sshAlias，不消费 endpoint**。也就是说切片 2.1 加进模型的 host/port/username/privateKeyFile/hostKeySHA256 与高级字段，今天还没有真正接到拨号路径上；「消费端接线」这一步的核心就是把 endpoint 传进连接构造，而不是改 UI。

### 接线阻塞：endpoint 到底是「目的地」还是「细化项」

读完 connection.ts 的事实：

- 拨号是用 sshArguments(executable, alias, connectTimeoutMs, sshConfigFile) 构造的：ssh -F <config> -o BatchMode/StrictHostKeyChecking/… -- <alias> "dsh --profile execution-host"。**目的地是 alias**，配置由 -F 指定的 ssh_config 提供。
- 记录里同时有 sshAlias 与 endpoint{host,port,username,privateKeyFile,hostKeySHA256}；测试还明确断言 resolveExecution 的 host 等于 target.sshAlias（alias 仍是 destination）。
- Orca 的模型是**一个字段**「主机或别名」；我们是**两个字段**。

因此接线前必须定一件事：

**A. endpoint 是细化项（保持 alias 为目的地）**：ssh 仍在 -F <config> -- <alias> 上拨号，只是把 port/privateKeyFile/proxyCommand/jumpHost/multiplex/keepAlive/connectTimeout 作为额外 -p/-i/-o 追加进去；endpoint.host 仅作记录与展示，hostKeySHA256 继续用于校验。改动小、25 条绿测试不受影响。

**B. endpoint 是目的地（alias 退化为查找键）**：ssh 改为拨 user@host:port（必要时仍带 -F 取得密钥），alias 只用于定位既有 OpenSSH 配置条目。这与 Orca 的「主机或别名」一致，但**会改变拨号语义**，需要同步改 harness 与测试期望（现有 fixture 就是靠 alias + -F 连到隔离服务器的）。

我倾向 A：它不动已经验证过的拨号路径，且 hostKeySHA256 的主机密钥固定比 Orca 更严；若目标是「Orca 那样的单一主机或别名输入框」，则其实要做的是 **B + UI 合并成一个字段**，那是一次更大的语义变更，需要你确认后再动。
**已确认为 A。**

### 接线实验结果（已回滚，树回到 25/25 绿）

按决定 A 实做了一版：在 sshArguments 里追加 endpoint 细化项（-p / -i / -o ProxyCommand= / -o ProxyJump= / -o ServerAliveInterval= / -o ConnectTimeout=，置于插件自带 -o 之后），SshTargetConnection 构造函数接收 endpoint，index.ts 传 record.execution?.endpoint。tsc 干净，但**一条测试转红**：keeps an active inspection connection and generation usable during runtime activation。

失败本身就是决定性证据：harness 生成的客户端密钥写在 <root>/client_key，而 deployment() 记录的 privateKeyFile 是 <root>/private-key——**这个路径根本不存在**。以前没有任何代码把它传下去，所以没人发现；一旦真的 `-i <不存在的路径>`，ssh 直接失败。

由此得出的事实：**endpoint 的 port 与 privateKeyFile 今天扮演的是「记录并被校验的身份」，不是拨号参数**；ssh_config 才是拨号来源。A 只定了「追加细化项」，没有定**两者冲突时谁优先**——而这正是接线必须先解决的点。

两条可选路径（需明确后再实现）：

1. **记录优先**：endpoint.port / privateKeyFile 作为权威拨号参数（缺省才回落 ssh_config）。需要：真实部署与 harness 都保证该路径存在（harness 需把密钥同时写到记录所指路径，并处理 Windows ACL），迁移期为旧记录保留「记录与 config 一致」的约束。
2. **config 优先**：仅把 config 无法表达的选项（proxyCommand / jumpHost / keepAlive / connectTimeout）接入 argv，port 与 privateKeyFile 继续只作记录与校验。改动小，25 条绿不变，但与 Orca「表单即连接参数」的体验不完全一致。

我按「不猜」原则回滚了实验版本：connection.ts 已 git checkout 还原，index.ts 的构造调用改回原样，当前 tsc 干净、execution.spec.ts 25/25 绿。

### 推荐：路径 1（记录优先）

理由：

1. **与既定方向一致**：你要的是「完整端点模型 + 按 Orca 的 UI」。Orca 的表单就是连接定义；若取路径 2，port 与身份文件在界面上可填却**不驱动任何行为**——正是这一路在清理的「没有消费者的设置项」。
2. **我撞到的那条红是夹具产物，不是生产阻塞**：ui-settings-hosts 的既有表单本来就在采集 host/port/username/私钥路径/指纹（见其 README 的 runtime setup 段），真实记录里的路径是真实存在的；出问题的是测试夹具把 privateKeyFile 写成 <root>/private-key，而 harness 把密钥生成在 <root>/client_key。修夹具即可。
3. **迁移风险可控**：alias 仍是目的地**名称**（ssh -F <config> -- <alias>），只是显式端口/密钥/代理等覆盖它；只有别名、没有 execution 配置的老记录行为完全不变。
4. **hostKeySHA256 不受影响**：主机密钥固定继续生效，比 Orca 更严，这条不要动。

实现要点（路径 1）：

- sshArguments 追加细化项（已试过、可用），并把「记录优先、缺省回落 config」写进注释与文档。
- harness 夹具把客户端密钥写到记录所指路径，并同步 Windows ACL 处理（生成处与记录处对齐）。
- 注意 -S none 仍使 multiplex 在本连接不可细化（已在 2.1 文档写明）；若要支持复用，需单独设计控制 socket 路径与生命周期。
- 顺序建议：路径 1（接线 + 夹具）→ 切片 2.2 test 操作（探测同一套权威端点）→ Remote → Orca UI。

### 路径 1 的硬阻塞（已查明，必须先解决才能实现）

继续实现时发现的**顺序矛盾**：

- **记录先于服务器**：spec 的 configured() 先 targets.create(...)（记录里带 endpoint.port = 2222 与 <root>/private-key），测试随后才 h.worker(alias) 启动隔离 SSH 服务器，且服务器用**临时端口**并写进 ssh_config（避免 vitest 并行跑文件时抢端口）。
- 所以「记录里的 port 驱动拨号」与「夹具先建记录、后起服务器」天然冲突：一接线，-p 2222 就指向一个没有监听的端口；同理 privateKeyFile 指向夹具并未创建的 <root>/private-key。

结论：路径 1 不是接线一行就够，它要求夹具与真实部署一样**先有服务器、再按真实端点建记录**。生产侧没有问题（用户填的是真实端口与真实密钥路径），卡点全在夹具的时序与取值。

实现路径 1 的完整顺序（每步可独立回滚）：

1. harness.worker() 暴露实际监听端口（返回 { port } 或记录 h.sshPort）。
2. 需要连接的用例改为：先起服务器取端口 → 用该端口构造 endpoint → create/update → 再 connect/activate。
3. 夹具把客户端密钥写到记录所指路径（含 Windows ACL），保留 client_key 供 ssh_config 使用。
4. 再重放生产侧接线（sshArguments 追加项 + 构造函数 + index.ts 传参）——此时记录与服务器一致，测试应转绿。
5. 补 argv 断言：记录优先（-p/-i/Proxy* 排在插件默认之后）、缺省时逐字不变。

当前状态：树停在 25/25 绿，生产侧接线已回滚，未留半成品。

### 路径 1（记录优先）已实现并验证

按上述五步顺序完成，每步后重跑 execution.spec.ts 均保持 25/25 绿：

1. tests/harness.ts 的 worker() 返回值新增 port（真实监听端口）。
2. execution.spec.ts 唯一需要真实连接的用例改为「先起服务器 → 用 worker.port 构造 endpoint → create → connect/activate」。
3. 夹具把客户端密钥同时写到记录所指的 <root>/private-key（与 client_key 相同权限处理，Windows 走 icacls ACL），保留 client_key 供 ssh_config。
4. 生产侧接线：src/connection.ts 的 sshArguments 在插件自带 -o 之后按固定顺序追加 endpoint 细化项（-p / -i / -o ProxyCommand= / -o ProxyJump= / -o ServerAliveInterval= / -o ConnectTimeout=；OpenSSH 后者胜出，即记录优先）；SshTargetConnection 构造函数接收 endpoint；src/index.ts 以 record.execution?.endpoint 传入。hostKeySHA256 不动（继续主机密钥固定），multiplex 因本连接 -S none 不可细化；不填端点时 argv 与旧行为逐字一致。
5. 新增 tests/arguments.spec.ts：无端点时逐字等于旧 argv；全字段时细化项排在插件默认之后且固定顺序；仅必填字段时只追加 -p/-i；multiplex 请求不产生 ControlMaster/ControlPersist。

验证证据：execution.spec.ts 25/25、arguments.spec.ts 3/3、tsc -b 干净；连接用例实际经 OpenSSH 拨到 -p <worker.port> 与 -i <root>/private-key 且认证成功。README（中英）已同步记录优先语义。

### lockfile 隐患已排除

早先 pnpm install 连续报 Windows EBUSY（无法 rename pnpm-lock.yaml），只能用 --lockfile=false 链接依赖，因此担心新声明的 ssh2 没写进 lockfile。现已验证：

- pnpm install --lockfile-only → 退出码 0，报告 Already up to date；
- **pnpm install --frozen-lockfile → 退出码 0**（这正是 CI 校验用的命令），说明 lockfile 与各 package.json 一致，ssh2 的声明已被记录。

结论：不需要额外的 lockfile 补救步骤；此前记录的「lockfile 待补」作废。

剩余：test 操作（非交互连通性检查 + 稳定结果码）、消费端接线确认（execution-host-local / execution-runtime 侧）、Remote 暴露、Orca UI。

### 悬案定性：execution-host-controller 的 composition.spec.ts 那条失败是既有问题（已取证）

按要求做 stash 对照（去掉 packages/bundle/web-app 的两个改动文件后重跑整包）：

| 运行 | 结果 |
|---|---|
| 带 bundle 改动（工作树原状） | Tests 1 failed \| 19 passed (20) |
| git stash 去掉 bundle 改动后 | Tests 1 failed \| 19 passed (20)，同一条、同一签名 |

失败签名两次完全一致：

```
FAIL |thread-safe| packages/api/execution-host-controller/tests/composition.spec.ts >
  executionHosts real Loader composition > persists management through HTTP and the desktop
  carrier from the security-research profile
TypeError: Cannot read properties of undefined (reading 'bundles')
 ❯ createHarness packages/api/execution-host-controller/tests/harness.ts:64:46
   const layers = PROFILE_TEMPLATES[profile]!.bundles.map(...)
```

根因（读码确认，与 bundle 改动无关）：harness.ts:48 的 `profile` 参数类型是 `'web' | 'security-research'`，spec 对这两个值各跑一次；但 app-boot 的 `PROFILE_TEMPLATES`（packages/boot/app-boot/src/profile.ts:179）只有 acp / web / headless / sdk / sdk-minimal 五个模板，**没有 security-research**，于是 `PROFILE_TEMPLATES['security-research']` 为 undefined，`!.bundles` 抛错。security-research 在本仓库是**可选 bundle**（packages/bundle/security-research/cordis.patch.yml，被 apps/web/tests/security-capabilities.e2e.ts 以显式 overlay 使用），从来不是一个 profile 模板。

结论：**既有失败，非本线引入**；git-settings 行 id 改名与此无关。下一步（未做）：该 spec 要么改用真实存在的 profile 模板，要么把 security-research bundle 作为显式 overlay 层叠加到 web 模板上——属于该包自己的测试修正，不属于本次交付。

### 第二步设计：按 Orca 重做 ui-settings-hosts（先记插入点，再动代码）

#### 取证结论：两处规格当前**没有后端**

1. **导入**没有 Remote：execution-host-controller 今天只有 list / follow / test / create / update / removeTarget / connect / disconnect / inspectDirectory / detectRuntime / startRuntime / getRuntimeTask / followRuntimeTask / cancelRuntimeTask / listRuntimeTasks，**没有任何读取 OpenSSH 配置的方法**。
2. **口令对话框**没有通道：test/connect 只接受 `{ id, revision }`，没有把口令交给 ssh 的参数；本连接固定 `-o BatchMode=yes`，设计上就不弹交互口令。方案自己的「待确认 3」也把这件事列为未决。

因此本次对后端做**最小补齐**，口令一项按「不留半成品」记入待办而不是假做。

#### 后端最小补齐（packages/execution-host/execution-host-targets）

事实：Orca 表单采集的 主机 / 用户名 / 端口 / 身份文件 / Advanced 五项，今天只能存进 `SshExecutionConfiguration.endpoint`，而 `execution` 是**运行时部署身份**（endpoint + node/helper/helperHash/workspace + bootstrap 两字段），由运行时安装成功后写入，UI 从不创建。也就是说：一个还没部署运行时的新目标，今天**没有地方**存「用户名/端口/身份文件/Advanced」。

插入点：

- `src/types.ts`：新增 `SshConnection`（host / port / username / privateKeyFile? + `SshEndpointOptions`），并在 `CreateTargetRequest` 上加可选 `connection`。语义：**connection 是可编辑的拨号描述，execution.endpoint 是固定指纹的部署身份**。
- `src/spec.ts`：`connectionSchema` 加进 `createTargetSchema`，字段可选 → 旧记录（v2）照常解析，**领域版本仍是 2，不变更、不迁移**。
- `src/connection.ts`：`endpointArguments` 的入参放宽为结构化拨号端点（端口必填、身份文件可选），无身份文件时不追加 `-i`；`SshTargetConnection` 的 endpoint 入参同步放宽。
- `src/index.ts`：连接与探测统一走 `record.connection ?? record.execution?.endpoint`；`create/update` 透传 `connection`；`view()` 天然带出。
- `src/import.ts`（新）：`listSshHostEntries(config)` 读 `config.sshConfigFile ?? ~/.ssh/config`，解析 Host 块（跳过通配与 Match），返回 `{ source, exists, entries: [{ alias, host?, username?, port?, identityFile?, proxyCommand?, jumpHost? }] }`，**只读，不写回**。

#### Remote（packages/api/execution-host-controller）

`@Remote listImportableHosts(signal): Promise<ImportableHostsValue>` → `ctx.executionHostTargets.listImportableHosts()`；types.ts 同步再导出。新增 `@Remote` 后必须重跑 `tsx scripts/build-remote-contracts.ts` 重新生成 `lib/typert.remote-client.*`，客户端才能编译。

#### 客户端（packages/client/ui-settings-hosts）

- `HostsSection.tsx` 重写：页头（执行主机 + 说明 + 导入/添加目标）、「目标」分区（说明 + 空状态）、目标卡片（状态点 + 行内摘要 + label + 次行 `用户名@主机:端口 · 保活策略` + 失败原因 + 测试/连接/编辑/删除），删除走 Modal 二次确认。
- 新组件：`TargetForm`（添加/编辑对话框，含 Advanced 折叠）、`ImportDialog`（OpenSSH Host 条目列表 → 预填表单）。
- `callbacks.ts` 增加 `test`、`listImportableHosts`；`types.ts` 同步；`index.ts` 注入；`locales.ts` 全部新文案（中英）。
- 保留：现有 DirectoryInspector / RuntimeSettings / 运行时任务面板（它们是这一页已有的能力，Orca 没有对应物，但删掉会丢功能）；现有「当前本机 Host」「新会话默认值（不可用）」两段保留。
- 测试：新增组件用例覆盖 表单校验 / Advanced 折叠 / 测试与连接按钮 / 删除二次确认 / 导入预填。


### 第二步落地：已实现并验收（2026-10-03）

#### 实际改了什么（与上文设计一致，含一处修正）

- **模型**（packages/execution-host/execution-host-targets）：新增可选 `connection`（port / username / privateKeyFile / proxyCommand / jumpHost / multiplex / keepAliveIntervalSeconds / connectTimeoutSeconds，全部可选），**别名仍是目的地**。拨号与探测统一走 `record.connection ?? record.execution?.endpoint`；细化项顺序为 `-p` / `-i` / `-o User=` / ProxyCommand / ProxyJump / ServerAliveInterval / ConnectTimeout，排在插件自带选项之后（OpenSSH 后者胜出）。范围校验沿用既有 endpointOptions；`username` 这次真正驱动拨号（`-o User=`）。领域版本仍是 2，旧记录照常解析。
- **导入**：新增 `src/import.ts` 的 `readImportableHosts()` 与服务的 `listImportableHosts()`，读 `config.sshConfigFile ?? ~/.ssh/config`，返回具体 Host 条目（别名 + 首个 HostName/User/Port/IdentityFile/ProxyCommand/ProxyJump），跳过通配/取反、`Match` 之后的内容与 `Include`，**从不写回**。
- **Remote**：`@Remote listImportableHosts(signal)`；`configuration-unreadable` 加入稳定错误码表。
- **UI**：HostsSection 按 Orca 重做（页头标题/说明 + 导入/添加目标、目标分区与空状态、目标卡片、测试/连接/编辑/删除、删除二次确认），新增 TargetForm（含 Advanced 折叠）与 ImportDialog，文案全部走字典（中英各 189 键）。保留当前本机 Host、运行时面板、目录检查、默认值不可用三段。

**设计修正一处**：原设计写的是「connection 记录 host/username/port + 细化项」。落地改为 **connection 不含 host**——别名已经是目的地，再加一个 host 会让同一个问题有两个答案。用户名/端口/身份文件/Advanced 才是细化项。

**保持终端运行开关的映射**：模型没有布尔保活字段，开关 ON 写入 `keepAliveIntervalSeconds = 60`（KEEP_ALIVE_INTERVAL_SECONDS，与「端口默认 22」同类的表单常量），OFF 不写该字段。

#### 过程中踩到并修好的真缺陷：Host 侧 typert 描述符陈旧会静默剥离参数

第一次浏览器验收时，表单填的用户名/端口/Advanced 全部没有落库（记录里只有 label + sshAlias）。定位链：

1. 客户端产物已重建、存储单元是 v2、生成的服务端参数 schema（`lib/typert.remote-client.js`）确实含 `connection`；
2. 但 **`lib/typert.host.js` 是改动前的旧文件**——它才是 Loader 注册给 Host 侧的方法描述符；
3. 旧 schema 不含 `connection`，且生成的 schema 对未知键是**剥离**而非拒绝，于是参数在到达服务前就被丢掉，看起来像持久化缺陷。

根因是构建面缺口：`scripts/build-remote-contracts.ts` 只写 `lib/typert.remote-client.*`，Host 描述符由 host face 构建（`tsdown --env.DSH_BUILD_FACE host`）产出。本次为该包单独重生成 `lib/typert.host.{js,d.ts}`（用同一个 `WorkspaceTypertGenerator`），随后端到端通过。**结论：任何新增 `@Remote` 方法的改动，都要重生成 Host 描述符，否则参数会被静默剥离。**

#### 验收证据

| 检查 | 命令 | 结果 |
|---|---|---|
| 客户端类型 | `tsc -b packages/client/ui-settings-hosts/tsconfig.json` | exit 0 |
| 目标域类型 | `tsc -b packages/execution-host/execution-host-targets/tsconfig.json` | exit 0 |
| 客户端组件测试 | `vitest run packages/client/ui-settings-hosts` | 6 files / **36 passed** |
| execution.spec.ts | `vitest run .../tests/execution.spec.ts` | **27 passed**（保持全绿） |
| 目标域新增/既有非平台套件 | import + connection + arguments + execution | **40 passed** |
| execution-host-controller 回归 | `vitest run packages/api/execution-host-controller` | 19/20，唯一红是**既有**的 composition.spec.ts（本文件顶部已定性） |
| 客户端 i18n 门禁 | `tsx scripts/verify-client-ui-i18n.ts` | ui-settings-hosts **0 条**；仅 12 条既有的别包命中（ui-better-sidebar / ui-primitives） |
| 落后产物扫描 | 逐包比较 `src` 最新时间与 `lib/client.js` | NO STALE CLIENT ARTIFACTS |
| 人工验收 | `http://127.0.0.1:3080/?token=NzJrN0v0-lxZibdzqjBMZ4JQu4Xvjxa3vjni5q4LvPQ` | 见下 |

#### 人工验收实测（浏览器，真实服务）

用 cinlan computer 操作 Chrome 窗口 590900，地址栏 element 17，页面状态读 `get-app-state --json` 的 `treeText`：

1. **导入**：读取自 `C:\Users\ASUS\.ssh\config`，列出 `dev-box`（deploy@127.0.0.1:2222）与 `staging`（operator@staging.example.com:22），并提示通配模式不列出；选择 dev-box 后表单预填 标签/主机或别名/用户名=deploy/端口=2222/身份文件=~/.ssh/id_ed25519。
2. **Advanced**：展开后 代理命令 / 跳板主机 / 复用 SSH 连接 / 保持终端运行 / 断开连接后的超时时间 五项齐全，逐项填写并保存。
3. **添加目标**：卡片出现，次行为 `deploy@dev-box:2222 · 保活间隔 60 秒 · 已复用连接`；存储单元里 `connection` 的 **8 个字段全部落库**（含 proxyCommand、jumpHost、connectTimeoutSeconds=600）。
4. **测试**：呈现 `execution-host/unreachable` 与中文原因「无法访问目标。请检查主机、端口与网络连接。」，且目标状态仍为「未连接」（探测不发布连接，符合 test 语义）。
5. **连接**：卡片转为「连接错误」，卡片内给出同一具体原因。
6. **编辑**：对话框回填标签/目的地/用户名/端口/身份文件；改标签保存后卡片标题更新，连接细节保留。
7. **删除**：弹出「删除目标？」二次确认（含断开与不修改远端文件的说明），确认后卡片消失、回到空状态并提示「目标已删除。」。

（验收用的 `~/.ssh/config` 是本机此前不存在、为演示导入而新建的**样例文件**，仅含 dev-box / staging / 一条通配示例；未修改任何既有文件。）

#### 剩余未做项

1. **口令对话框**：仍然没有通道。`test`/`connect` 只接受精确版本，连接固定 `-o BatchMode=yes`，Host 侧没有把口令交给 ssh 的参数。页面因此把 `authentication-required` 报成「配置密钥或智能体」的问题，不假做对话框。要落地必须先定「待确认 3」——是一次性 secret 通道还是只支持密钥/agent。
2. **Git 线的 README 与 Agent Note**：属于另一条线，本次未动。

## 待确认

1. 端点是存在**新的 execution-hosts 命名空间**，还是并入现有执行主机存储（后者与工作区绑定同源，但命名空间要按加载器行 id 对齐）。
2. 导入是否只读 ~/.ssh/config，还是也写回该文件（Orca 的导入看起来是只读预填）。
3. 口令交互：允许 Host 现场索取一次，还是直接要求使用密钥/agent 而不支持口令。


### 第三轮：按真实参考实现重做版式（2026-10-03）

用户以两张 Orca 截图指出第一版「不像」。据此改为**对照参考实现的源码**构建，而不是继续按文字规格推断。参考实现在本机：

| 文件 | 作用 |
|---|---|
| `D:\Company\cinlan\orca\src\renderer\src\components\settings\SshPane.tsx` | 分区版式：分区行（标题+说明，右侧 导入/添加目标）、虚线空状态框、卡片列表 |
| `...\SshTargetCard.tsx` | 卡片：机器图标 + 标签 ● 状态 + `账户@主机:端口 • 身份文件 • 终端保持` + 失败红字一行 + 图标/文本动作组 |
| `...\SshTargetForm.tsx` | 两列对话框：标签/主机或别名*、用户名/端口、身份文件整行、Advanced、底部 取消/添加目标 |
| `...\SshHostAdvancedFields.tsx` | Advanced 折叠：代理命令、跳板主机、复用连接开关、终端保持开关、断开超时（受开关联动） |
| `...\ssh-target-draft.ts`、`...\ssh-target-save-payload.ts` | 目的地解析（`ssh://`、最后一个 `@`、`host:port`、`[v6]`）、默认值与校验 |

#### 修正掉的偏差

1. **页头不再放操作**：导入/添加目标移到「目标」分区行右侧（页头只留标题+说明）。
2. **分区说明与空状态**改为参考口径：「添加远程主机以在 Cinlan Harness 中连接到它。」「未配置 SSH 目标。」（产品名按本项目取，参考里是 Cinlan IDE）。
3. **标题拆成两个键**：页面标题「SSH 远程主机」，左侧导航标签「SSH 主机」——参考里两者本就不同。
4. **卡片重做**：图标 + 标签 ● 状态 + 一行 `账户@别名:端口 • 身份文件 • 终端保持`（终端保持=「终端保持运行直到重置」或「终端超时：1h」）+ 失败时一行红字 + 右侧动作组（图标：编辑/删除；文本：测试、连接/断开）。
5. **对话框重做**：两列栅格、身份文件整行、Advanced 折叠带箭头、开关在右、超时字段在开关打开时**锁定并显示「直到重置」**。

#### 语义修正（重要）

第一版把「保持终端运行」映射成 `ServerAliveInterval`，并总是写 `multiplex`。参考实现是**联动**的：

- 「保持终端运行直到重置」ON（默认）→ 断开期限**无上限**，不写 `connectTimeoutSeconds`；
- OFF → 写入 60..604800 的有限值 → 记录里的 `connectTimeoutSeconds`（范围与参考的 60 秒–7 天完全一致）；
- 「复用 SSH 连接」只在**关闭**时写 `multiplex: false`（复用是能力默认值，参考也只记录显式关闭）；
- 端口总是按表单值保存（默认 22），与参考一致。

#### 仍与参考不同（有意，且已知）

- 参考卡片上的「结束远程终端」「重置远程中继」两个图标动作**在我们的 Host 上没有对应能力**，故不渲染（不放假按钮）。
- 卡片前的机器图标用内联 SVG 还原；身份文件标签前的钥匙图标省略（原语图库无对应字形）。
- 「当前本机 Host」与「执行运行时」两段是本仓库已有能力，参考没有对应物，保留。

#### 第三轮验收

- `tsc -b packages/client/ui-settings-hosts/tsconfig.json` → exit 0；
- `vitest run packages/client/ui-settings-hosts` → **37 passed**；
- 浏览器实测（重启后新地址 `http://127.0.0.1:3080/?token=JiB0-sM8pE32NStoVrcwbXiHjNLjdeiuxMRuwhLo9kA`）：页标题与分区行、空状态、导入对话框、两列添加对话框（Advanced 展开后五项齐全、超时显示「直到重置」且禁用）、保存后卡片次行 `deploy@dev-box:2222 • ~/.ssh/id_ed25519 • 终端保持运行直到重置`、测试给出 `execution-host/unreachable` 具体原因、删除二次确认后回到空状态。

> 上一条「人工验收实测」记录的是第一版版式；第 4 条里卡片次行的「保活间隔 60 秒 · 已复用连接」与存储里 8 个字段的写法，在第三轮之后被上面的联动语义取代。

#### 第三轮续：页面只保留 Orca 的内容（用户确认）

第二轮之后页面仍有 Orca 没有的三段：**当前本机 Host**、**执行运行时**、**新会话默认值**。经用户选择「全部移除，只留 Orca 的 标题+说明+目标」，已执行：

- 删除 `RuntimeSettings.tsx`、`DirectoryInspector.tsx`、`runtime-observation.ts` 及其用例；
- `HostsSection` 只渲染一句说明 + `hosts` 分区（标题/说明/导入/添加目标 + 空状态 + 目标卡片）；
- `HostsCallbacks` 收窄为 list / follow / create / update / removeTarget / connect / disconnect / test / listImportableHosts；
- 标题归属改为**页面自持**：`registerSection` 用 `heading: 'feature'`（`ui-settings-general/src/client/SettingsRoot.tsx:47` 只在 `'shell'` 时渲染 `<h1>{slot label}</h1>`），于是导航项用 `navLabel`=「SSH 主机」、页面自渲染 `<h1>`=`title`「SSH 远程主机」，两者终于可以不同——这正是 Orca 的形态。第二轮里最刺眼的「标题重复三层」（外壳标题 + scope + h2）随之消失；
- 字典从 185 键裁剪到 **104 键**，删掉的 81 键全是上述三段的文案；
- `loader.client.spec.tsx`（本包唯一的真实 Loader 组合用例）改为经生成的 Remote 编解码器**编辑一条已保存目标**，保住该测试面。

**未动**：执行主机域的 Remote 方法、执行运行时服务、目录检查服务都原样保留（只是本页不再展示），所以不存在「删了后端」的问题；要恢复界面只需把组件挂回来。

#### 第三轮续 2：补齐卡片动作（用户要求「跟 Orca 一样」）

Orca 卡片比我们多两个图标动作。逐一处理后：

- **重置远程中继 → 已补，且不需要新后端。** 事实依据：`connectOperation` 的第一步就是 `disconnectCurrent(record.id)`（index.ts:303），也就是说「对已持有连接的目标再次 connect」本身就是「关掉旧 worker、重拨新 worker」。因此卡片在目标 `ready` 时渲染一个旋转图标（`IconRefreshOutline16` + Tooltip「重置远程中继」），点击直接调既有的 `connect({id, revision})`，pending 键为 `reset:`，成功后提示「远程中继已重置。」。替换期间目标进入 connecting，图标按 Orca 的做法收起。
- **结束远程终端 → 不渲染，理由有据。** 远端 worker 的能力元组是写死的 `['directory-inspection']`（execution-host-worker/src/protocol.ts:46），worker 源码里没有任何 terminal 引用；本产品的终端会话（`TerminalSessionService`）按 **Agent 所有者**归属、跑在管理 Host 本地，与执行目标没有绑定关系。也就是说这个目标名下**不存在**可结束的远端终端。按仓库「不留假控件」的规则，宁可不渲染，也不放一个永远不能执行、或点了什么也不做的按钮——这也正是「成熟产品」该有的判断。

第三轮续的验收：`tsc` exit 0；客户端 **31 passed / 5 files**；浏览器（新地址 `http://127.0.0.1:3080/?token=pZVMRcioroQnpEcuoplqohnFW5wBciRNENm6uR-93ak`）页面为「SSH 远程主机 + 说明 + 目标面板（导入/添加目标 + 空状态）」——与 Orca 截图同构。

### 第四轮：文案与字段的「名实不符」纠偏（2026-10-03，只改文案与表单）

用户指出页面上三处名实不符。本轮不动 Host 侧方法与数据模型，只改字典、表单、文档与测试。

#### 「承诺 vs 现实」核对表

页头说明（`locales.ts:8` en / `:123` zh）承诺「通过 SSH 使用已有机器处理文件、终端、Git 和工作区」四项，逐项核对：

| # | 承诺 | 状态 | 证据 |
|---|---|---|---|
| 1 | 文件 | 已达成 | `packages/ssh/fs-ssh`；消费方按租约取得 provider，见 `packages/execution-host/execution-binding/README.md:44`（文件、命令与终端操作都使用被捕获的 provider） |
| 2 | 终端 | 已达成 | `packages/ssh/subprocess-ssh` + `packages/client/ui-better-sidebar/src/terminal-provider.ts:70/112/153`，其中 `:156` 以 `lease.ctx.get('subprocess')` 在远端起 shell |
| 3 | Git | 已达成 | `packages/git/sidebar-git/src/index.ts:322`（`lease.ctx.get('subprocess')`，Git 命令跑在被捕获的执行世界） |
| 4 | 工作区 | **未达成** | `packages/execution-host/execution-binding/README.md:62`：远端 Workspace 隔离与 worktree-task 创建在消费方改用同一执行世界之前一律拒绝；随附远程组合还排除 project instruction 与 filesystem skill discovery |

处理：页头说明按用户要求**逐字保留 Orca 原文**（四项仍是目标，不改成三项）；第 4 项登记为已知限制（`packages/client/ui-settings-hosts/README.md` / `README.zh.md` 各一条，指向 `execution-binding/README.md:62`），实现补齐见下面的 T2。

#### 表单纠偏（本轮已实现）

| 问题 | 事实 | 处理 |
|---|---|---|
| 提示引用不存在的动作 | 「保持终端运行直到重置」的提示写着「使用『结束远程终端』或『重置中继』」，而卡片上只有「重置远程中继」（不渲染「结束远程终端」的理由见 ui-settings-hosts README:78） | 该提示随开关一并删除 |
| 控件名实不符 | 「保持终端运行直到重置」+「断开连接后的超时时间（秒）」写的是 `connection.connectTimeoutSeconds`，即 `-o ConnectTimeout=`（SSH **建连**截止），与远端终端断开后存活多久无关；后者是侧边栏终端插件的部署配置 `reconnectGraceMs`（`packages/client/ui-better-sidebar/src/config.ts:92`，默认 30s） | 降级为**单个可选字段**「连接超时（秒）」：留空 = 不写字段、沿用插件默认（`connectTimeoutMs`，默认 15s，`execution-host-targets/src/config.ts:30`）；填写则写入记录并追加 `-o ConnectTimeout=<秒>`。开关与「直到重置 / 86400」联动全部删除 |
| 自造范围 | 表单下限 60 秒，而记录 schema 接受 1..604800（`execution-host-targets/src/spec.ts:19`） | 范围对齐 schema |

连带改动：

- 卡片次行（`HostsSection.tsx` 的 `connectionLine`）：设置时显示「连接超时：Ns」，未设置时不显示该段；`terminalUntilReset` / `terminalTimeout` 两键删除。
- `formatGracePeriod`（7d/4h/30m）与 `DEFAULT_GRACE_PERIOD_SECONDS` 删除，超时按秒呈现，与 OpenSSH 选项一致。
- 字典：删 6 键（`formKeepAliveUntilReset`、`formKeepAliveUntilResetHint`、`formGracePeriod`、`formGracePeriodPlaceholder`、`formGracePeriodUntilReset`、`formGracePeriodHint`），加 4 键（`formConnectTimeout`、`formConnectTimeoutPlaceholder`、`formConnectTimeoutHint`、`connectTimeout`），改写 `formInvalidTimeout`。
- 测试：删「联动锁定」1 条，加「只在填写时写入截止时间（含 0 / 604801 拒绝）」与「已保存值经编辑器往返」2 条，卡片文案断言同步。

验证（本轮实测）：

| 检查 | 结果 |
|---|---|
| `tsc -b packages/client/ui-settings-hosts/tsconfig.json` | exit 0 |
| `vitest run packages/client/ui-settings-hosts` | **35 passed / 5 files**（原 33） |
| `verify-translation-pairing --write` 后校验 | README 双语对一致 |
| `verify-client-ui-i18n` | 本包 **0 命中**（12 条命中全在既有别包 ui-better-sidebar / ui-primitives） |

#### 遗留任务清单

1. **结束远程终端（方案 B）**——今天不渲染。要落地必须先二选一：给远端 worker 增加终端能力（能力元组写死为 `['directory-inspection']`，`execution-host-worker/src/protocol.ts:46`），或把终端会话按执行目标归属（今天 `TerminalSessionService` 按 Agent 所有者归属管理 Host）。选定后才有卡片动作的语义。
2. **工作区远端化**——见下一节 T2。
3. **口令通道**——`test` / `connect` 只接受 `{ id, revision }`，连接固定 `-o BatchMode=yes`，Host 侧没有把口令交给 ssh 的参数；页面把 `authentication-required` 报成「配置密钥或智能体」的问题。要落地需先在「待确认 3」定：一次性 secret 通道，还是只支持密钥/agent。

#### 第四轮收尾：两个 e2e 门禁已按新页面重写并跑绿（2026-10-03）

旧门禁仍在断言 Orca 改版前的页面（`Execution hosts` / `Add host` / `Host label` / `Save host`、目录检查器、运行时面板），本轮改成断言当前真实行为：

| 门禁 | 现在断言什么 | 结果 |
|---|---|---|
| `packages/execution-host/execution-host-targets/tests/ssh-settings.e2e.ts` | 真实隔离 OpenSSH + 真实 worker 子进程：设置页 保存 → 连接（`Connected · root inspected`）→ 断言 `dsh --profile execution-host` 与公钥认证 → 断开 → 删除 → 空状态 | **1 passed**（11.5s） |
| `apps/web/tests/execution-hosts.e2e.ts` | 构建产物 Client 的设置页：空状态 → 添加目标 → Host 侧落库 → 刷新后卡片仍在 → 删除 → 空状态；无 console 警告与页面错误 | **1 passed**（9.1s） |

顺带修掉与记下的两点：

- 表单**总是保存端口**，而保存的端口以 `-p` 覆盖 `ssh_config`（既定语义），所以 e2e 必须显式填写夹具实际监听的端口，不能只填别名。
- `execution-hosts.e2e.ts` 里原属 T3 的「Choose Workspace Host / `targetRevision` / 过期 revision」断言已移入 T3 的验证计划——那段 UI 今天还不存在，测试不能先于实现。

**踩坑记录（维护者必读）**：web lane 的 Host 从**构建产物** `lib/` 加载插件，`lib/` 落后于 `src/` 时在浏览器里表现为 `execution-host/invalid-request`——旧的 `createTargetSchema` 不含 `connection`，而它是 `strictObject`，于是参数被直接拒绝。本机修法：

- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json`（noEmit，include 覆盖各包 `tests/**/*.ts`，exit 0）只刷 `lib/types`；
- 单包重新打包：`node_modules/.bin/tsdown.CMD --env.DSH_BUILD_FACE host -F '<包名>'`（从仓库根执行）。**直接跑不带 `-F` 的 `tsdown --env.DSH_BUILD_FACE host`** 在缺少 pnpm 生命周期变量时会去构建根包并失败：`Cannot find entry: lib/types/{index,invariant,startup}.js`；
- 标准路径仍是 `pnpm run build`（也正是 `test:web` 的第一步）。

### T2：工作区远端化任务清单（只登记，未写代码）

目标：解除 `execution-binding/README.md:62` 的两条「拒绝」——(a) 让 `workspace-isolation-git` / `worktree-task-git` 的消费方改用**被捕获执行世界**的 provider；(b) 把 project instruction 与 filesystem skill discovery 的 controller 专属路径 API 远端化。

#### 现状（已核实）

- 两个 Git provider 都长在管理 Host 上：`workspace-isolation-git/src/index.ts:210` 注入 `['agents','storageDomain','subprocess']`，`:4-5` 直接用 `node:fs/promises` + `node:path`，`:116/:484` 用 `process.platform` 判断路径语义，`:233` 把 checkout 根定在 `<DSH_HOME>/worktrees/v1`，`:1137` 用 `this.ownerCtx.subprocess.spawn` 跑 git；`worktree-task-git/src/index.ts` 同形（`:4-5`、`:134`、`:200` root = `<DSH_HOME>/worktree-tasks/v1`、`:1049-1051` ownerCtx.subprocess）。
- 消费方是 Host 平面的单例控制器，没有 session/租约概念：`workspace-isolation-controller/src/index.ts:251` 与 `worktree-task-controller/src/index.ts:249` 都用 `this.ctx.get('<service>')`。
- 正确形态的先例：`git/sidebar-git/src/index.ts:278` 先 `ctx.executionBindings.forSession(sessionId, caller)`，`:322` 用 `lease.ctx.get('subprocess')`；终端同理（`terminal-provider.ts:70/153/156`）。租约自带 `binding` / `ctx` / `cwd` / `platform` / `incarnation` / `signal` / `assertCurrent()` / `release()`（`execution-binding/src/types.ts:11-23`）。

#### 任务 1 · 隔离与 worktree-task provider 改用被捕获执行世界

插入点：

1. `workspace-isolation-git` / `worktree-task-git` 的每次操作按 `sessionId` 取租约（`ctx.executionBindings.forSession(sessionId)`），把 `this.ownerCtx.subprocess` 换成 `lease.ctx.get('subprocess')`（缺服务即拒绝、不回落 Host，遵循 `execution-binding/src/types.ts:13`），操作结束 `lease.release()`。
2. `node:fs/promises` 的点状使用（`lstat` / `exists` / `mkdir` / `realpath` / `stat`）换成 `lease.ctx.get('fs')` 的 provider 调用；`node:path` 拼接与 `process.platform` 分支换成租约的 `cwd` / `platform` + provider 的路径语义。
3. 记录里保存取得租约时的 `binding` 快照（kind / targetId / revision），使同一记录不会被另一个执行世界认领；每次 git 调用前用 `lease.assertCurrent()` 校验。
4. 控制器与 Remote：`workspaceIsolationController` / `worktreeTaskController` 今天只有 leaseId / taskId，需补 session 归属（或由 Host 路由把 sessionId 传入），客户端 `ui-workspace-isolation` / `ui-worktree-task` 同步改。
5. 挂载时机：`execution-binding/src/index.ts:377-390` 的 `selected.kind === 'ssh'` 分支已经在给 agentCtx 装 isolate 映射并 `mountCapabilities`；远端会话应在这里把隔离/任务 provider 挂进该执行 scope，而不是继续由全局单例服务。

验证方式：

- provider 面：`workspace-isolation-git/tests/git-workspace-isolation.spec.ts` 与 `workspace-isolation.e2e.ts`（用真实 git，本机可跑）；`worktree-task-git` 对应套件同形扩展——加「租约来自远端 provider」的夹具。
- 组合面：`execution-binding/tests/publication.host.spec.ts` / `binding.host.spec.ts` 加一条「远端会话 + workspace 隔离」用例，断言 checkout 落在远端根、本地根未被创建。
- 契约面：受影响包 `tsc -b`；新增 `@Remote` 方法必须重生成 `lib/typert.host.js`（见上文「Host 侧 typert 描述符陈旧会静默剥离参数」一节），并同步 `packages/api/remotes` 的客户端门面。
- 真实远端验收需 POSIX/CI 或显式配置的端点：`packages/ssh/{ssh,subprocess-ssh,sandbox-ssh}/tests/**` 在本机被 process-bound 排除，不能计入本机结论。

风险：

- **租约生命周期错配**：provider 记录是持久的（storage-domain），租约是进程内的。今天 `Service.init` 的启动恢复（`workspace-isolation-git/src/index.ts:264-275`）假设本地路径始终可访问；远端化后必须定义「会话不在时如何 reconcile」，否则崩溃恢复会对着不可达的远端路径操作。
- **容量与并发**：`maxActiveCheckouts` 与 reservations 目前是进程全局；按执行世界拆分后，「最久未用先 hibernate」的排序与容量语义需要重新定义。
- **远端 git 可用性**：远端需要 git 可执行文件与可写根；`filterOverrides` 与 `core.hooksPath` 指向的 `.disabled-hooks`（`index.ts:1128-1132`）都要落到远端。
- **平台差异**：控制器与远端平台不同时，`pathKey` 的大小写归一化（`index.ts:114-117`）必须改用租约的 `platform`，不能读 `process.platform`。
- **权限面扩大**：把项目路径语义搬到远端会扩大可读范围，必须与 fs provider 的导出根约束一致（远端目录必须落在导出的 root 内）。

#### 任务 2 · project instruction 与 filesystem skill discovery 远端化

插入点：

- `packages/context/agent-instructions/src/index.ts:119` 今天取 `ctx.get('fs')`；`:127` 用 `agent.session.header.cwd ?? process.cwd()`，`:128` 调 `findProjectRoot`。应改为经 `executionBindings.executionForAgent(agent)` 取被捕获的 provider 与 `lease.cwd`。
- `packages/context/agent-instructions/src/files.ts:7-9` 直接用 `createReadStream`（node:fs）、`stat`（node:fs/promises）与 `node:path` 的 `dirname/isAbsolute/join/relative/resolve`——这些 controller 专属路径 API 必须换成 provider 的读与路径解析。
- `packages/skill/skill-filesystem/src/index.ts:12-15` 同样是 node:fs/promises、node:fs 的 watch、node:path 与 `node:os` homedir；`:168` agentsHome、`:248` `findProjectRoot(resolve(cwd), …)`、`:250-251` 把 `.dsh/skills` / `.agents/skills` 拼在项目根上；chokidar 监视（`:17`）在远端没有对应能力，需要显式降级（禁用监视或改用 provider 事件）。
- **先取证排除发生在哪一层**：`execution-binding/README.md:62` 与 Agent Note `.agents/notes/implemented/architecture/2026-09-20-immutable-session-execution-binding.md:31` 记为 fail closed，而 `execution-binding/src/index.ts:377-390` 的 isolate 组装只隔离 provider 名称；预设行真正解析到哪个 `fs`、失败点是路径构造还是 host 侧读写，需要先复现并记录，再决定「远端化」还是「显式禁用 + 报错」。

验证方式：复用 `agent-instructions` 与 `skill-filesystem` 既有套件，加「远端绑定的 Agent 只读远端项目根」用例；组合面用 execution-binding 的 Loader 用例；路径语义用 fs provider 单测覆盖相对路径、`..` 越界与平台分隔符。

风险：

- **cwd 语义混用**：`session.header.cwd` 是控制器路径，`lease.cwd` 是远端规范化路径，今天多处混用（`agent-instructions/src/index.ts:127` 就是一例），改动要逐处确认。
- **监视能力缺失**：远端无 watch 时技能目录变化不触发重扫，需文档化或补 provider 事件。
- **model-visible ⟺ logged**：project instruction 与技能目录进入模型请求，远端化不得改变已记录内容的重建方式。

### T3 设计：工作区/会话远端化（让「文件、终端、Git」真正可达）

目标：给「SSH 远程主机」页承诺的后三项补上用户路径——在 Web 客户端选一个已保存目标建工作区，Host 捕获不可变执行快照，该工作区的会话在被捕获的执行世界里运行（shell/文件/Git/终端都由远端 provider 提供），不可用时明确拒绝，绝不静默回退本机。

#### 现状（已核实，全是缺口）

| 环节 | 现状 | 证据 |
|---|---|---|
| 客户端的执行选择 | 没有 | `workspaces/create` 只发 `{ path }`；客户端里唯一消费 `executionHosts` 的是设置页本身 |
| 工作区记录 | 只有 path/title/sessionIds/时间戳，无执行字段 | `packages/workspace/workspace/src/spec.ts:24-30`；`packages/api/workspace-controller/src/types.ts:18-30` |
| 工作区创建 | `create(path, title?)`，路径用控制器的 `realpath` + `stat` 规范化 | `packages/workspace/workspace/src/index.ts:236-242` |
| 会话准入 | `composeAgent` 只装模型选择并挂 preset，从不调用执行绑定 | `packages/api/session-controller/src/agent.ts:381-397`；`commands.ts:105-144` |
| 执行绑定服务 | `setup` / `acquire` / `forSession` / `bindingForSession` 齐备，不可变、冲突窗口、隔离 realm 都已实现 | `packages/execution-host/execution-binding/src/index.ts:230-274`、`:332-404`；`README.md:44-46` |
| 生产调用方 | 只有 automation，且恒为 `{ kind: 'local' }` | `packages/automation/automation/src/run.ts:65` |
| 目标快照捕获 | `snapshotExecution({ id, revision })` 固定部署身份；未激活运行时的目标直接拒绝 | `packages/execution-host/execution-host-targets/src/index.ts:188-198`、`:230` |

#### 第 1 步 · 捕获（Host，workspace 层）

- `WorkspaceCreateRequest` 增加可选 `targetRevision: { id, revision }`；`workspaceRegistry.create(path, title?, execution?)` 增加可选执行快照，`WorkspaceView` 增加只读 `execution`。
- Host 流程：带 targetRevision 时先 `executionHostTargets.snapshotExecution(...)`（revision 漂移 / 未激活 / 不兼容按稳定错误码拒绝），再**在该目标的执行世界里**规范化路径并校验目录：`executionBindings.acquire(snapshot, path)` → `lease.ctx.get('fs')` 的 `resolve` / `stat` / `contains` → 立即 `release()`（远端目录必须落在该目标导出的 root 内，这条规则 `acquire` 已经实现，见 `execution-binding/src/index.ts:262-268`）。本机路径继续走现有 `realpathNormalize` + `stat`。
- 记录里存 `execution: ExecutionBinding`（ssh 快照或 `{ kind: 'local' }`）。**不升域版本**：`workspaceRecord` 是 `z.object`，新增可选字段后旧记录照常解析——与切片 2.1 给目标记录加 `connection` 同法（见上文「领域版本仍是 2，不变更、不迁移」）。
- 语义：工作区的执行位置**创建即固定**，与 Session 绑定的不可变规则一致；同一工作区不允许「一半本机、一半远端」。

#### 第 2 步 · 准入（Host，session 层）

`composeAgent(presetId, binding?)` 的 setup 改成固定顺序的四段：

1. `installSelection(agent)`；
2. `executionBindings.setup(agentCtx, agent, binding)` —— 它返回发布提交点，并且**必须早于 preset 挂载**，因为正是它把 isolate realm 与远端 capability 装进 `agentCtx`（`execution-binding/src/index.ts:377-390`）；
3. `presets.mount(agentCtx, resolvedId)` —— 此时预设行解析到的 `fs` / `subprocess` / `shell` / `ptcRuntime` / `git` / `terminals` 已经是远端 provider；
4. 把第 2 步的 `commit` 原样返回，让 `agents.create` 的未发布-提交事务继续成立。

`session-controller.create` 查到 workspace 后把 `workspace.execution` 传下去；**resume / fork 不传 binding**，由 `setup` 从会话日志折叠（`index.ts:334-336` 已实现「已有绑定不得改变」；`execution-binding/README.md:44` 记录 resume/fork 保留该事件）。拒绝规则沿用现有实现：已发出消息的本机会话不能迁到远端（`index.ts:337-339`）；准入窗口内目标被编辑/删除时 `reserveExecution` 给出可重试冲突。

#### 第 3 步 · 选择（Client）

- `ui-workspace` 的「Add workspace」对话框加一步「工作区 Host」：本机（默认）+ 已保存目标列表（`executionHosts/list` + `follow`）；选目标后再给「远程目录」，默认填该目标的 `execution.workspace`。
- 跨包只走 cordis 服务：`ui-workspace` 新增 `remote.executionHosts` 注入边（符合 packages/client 的导出纪律，不做运行时互相 import）。
- 选择项按 **`id:revision`** 提交，revision 漂移时提示「This target changed or became unavailable. Select an available revision again.」并禁用继续——这就是旧 `apps/web/tests/execution-hosts.e2e.ts` 已经写下的口径。
- 运行时前置：没有 `execution`（未安装/未激活运行时）的目标不能提供快照，选择器里标记不可选并给安装入口。Orca 是自动部署 relay；我们要么把第三轮删掉的运行时面板挂回设置页，要么把安装折进选择器。

#### 验证计划（每层都要，缺一层不算完成）

- **单元**：workspace 记录往返（含 `execution`；不含该字段的旧记录照常解析）；`workspace/create` 的快照捕获与冲突映射；`composeAgent` 的调用顺序（断言 `setup` 先于 `presets.mount` 且 `commit` 被透传）；resume 不带 binding 时从日志折叠。
- **组合（Loader）**：`execution-binding` 的发布用例加一条「远端会话 + 预设行」，断言预设行通过 isolate 取到的 `fs` / `subprocess` 是远端 provider（现有 `publication.host.spec.ts` 已有本地/远端双世界与冲突用例可复用）。
- **Web e2e**：把工作区 Host 选择用例补回 `apps/web/tests/execution-hosts.e2e.ts`（对话框、`Remote directory` 预填、过期 revision 提示 + Continue 禁用、`workspace/create` 以 `conflict` 拒绝、不发布任何 ssh 工作区）。本轮已把该文件改成断言**今天真实存在**的行为，T3 落地时把这一段加回来。
- **真实端点验收**：`apps/web/tests/windows-linux-ssh.acceptance.e2e.ts`（无场景时 `it.skip`）已经断言整条链——`workspace/create` 带 `targetRevision` → `workspace.execution.kind === 'ssh'` → `acquire` 重连换 incarnation → 会话在该世界运行。**这份验收用例就是 T3 的验收规格**：实现应当让它通过，而不是改它的期望。

#### 风险

- **两处权威**：工作区记录里的快照是「创建时的选择」，会话日志里的 `execution/bound` 是「该会话的准入」。运行中的会话不能因目标被编辑而换世界，所以 T3 只能让**新会话**重新解析；旧快照失效时必须以冲突拒绝并让用户重选，不能回落本机。
- **远端路径语义**：工作区的 `realpath` / `stat`、`SessionHeader.cwd` 与成员校验今天都假设控制器本地路径。远端工作区必须走目标的 `fs` provider，`SessionHeader.cwd` 存远端 POSIX 路径，且所有目录探测按 binding 分流（成员校验仍是 header cwd == workspace.path 的字符串相等）。
- **预设行**：Agent Note `.agents/notes/implemented/architecture/2026-09-20-immutable-session-execution-binding.md:31` 记录 project instruction / filesystem skill discovery 在实现远端语义前 fail closed；T2 的任务清单就是解除条件。未完成前，远端预设必须显式排除它们，而不是让它们读控制器的路径。
- **顺序与回滚**：绑定先于 preset；preset 挂载失败必须回滚绑定（`setup` 已用 `agentCtx.effect` 注册 teardown，`index.ts:348-364`）；`agents.create` 的 setup 是未发布阶段，任何一步失败都不能发布半个世界。
- **共享世界**：`worlds` 按 binding JSON 复用并计数（`index.ts:249-256`），同一目标上的多个会话共享一个世界；目标 disconnect 后所有引用它的会话都必须以 `connection-lost` 拒绝新工作，绝不切回本机。
- **容量与租约生命周期**：与 T2 同源——租约是进程内的，工作区记录是持久的；冷启动恢复必须重新 acquire，不能在目标不可达时把记录当成可用。

#### 待确认（实现前需拍板）

1. 目标没装运行时时：把运行时安装面板挂回设置页，还是在选择器里内联安装（Orca 是自动部署 relay）。
2. 远程目录可选范围：只允许目标 `execution.workspace` 之内，还是导出根内任意目录（后者需要新的列目录 Remote）。
3. 同一工作区是否允许本机与远端会话并存——建议禁止，与「创建即固定」一致。
