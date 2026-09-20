# Agent Note: Host 管理的安全技能资源

Status: implemented

[English](2026-09-20-managed-security-skill-resources.md) | 中文

## Problem

研究预设可见或插件已加载，不能证明完整技能资源存在。资源下载会跨越单次 Settings 访问，在原目录覆盖文件可能使已返回给 Agent 的相对引用失效。把内置复制当作下载也会掩盖真实发布源的缺失。

## Decision

[Host 资源管理器](../../../../packages/security/security-skills/src/resources.ts)负责安装、重新下载、更新检查、更新、取消与移除。[资源 Remote](../../../../packages/api/security-research-controller/src/index.ts)暴露管理器状态和操作，不另存安装记录。请求信号在操作受理前生效；受理后，操作归管理器所有。离开页面或重载 controller 只结束观察，显式取消按已观察到的操作 id 定位并等待结算。管理器释放时会中止并等待其工作结束。

[资源存储](../../../../packages/security/security-skills/src/resource-store.ts)在写锁内原子替换 active 指针，发布不可变 generation。下载、归档检查、解包与技能验证在发布前于私有 staging 中完成。发布前失败或取消的工作保留已提交 generation。一旦开始原子替换指针，提交优先：取消等待结算，可能返回新安装版本，不回滚已发布状态。每次激活和移除均递增 active 记录的 revision，空状态墓碑也保留该修订号。提交比较操作预期的 revision；即使中间发生安装和移除、两次观察均为未安装，也会拒绝延迟写入。Generation 重命名准备与指针原子替换共用同一短写锁，启动回收因而不能在发布过程中删除 generation。启动恢复只回收没有存活或未知租约所有者的非活动 generation；staging 则仅在所有者已确定死亡时移除。

既有 [Skill Provider](../../../../packages/security/security-skills/src/index.ts)通过官方 registry 注册已提交 generation，并在其变化或移除时撤回注册。[Web 组合](../../../../packages/bundle/web-app/cordis.patch.yml)挂载管理器与全局 Provider，使普通 standard、PTC 和 Cordis Agent 可以发现已安装技能；可选研究预设可贡献更近作用域的 Provider。成功加载的技能跨 Provider 重载保留 generation 租约：全局 Provider 持有至 Host 根释放，带作用域的 Provider 持有至所属 Agent realm 释放。Standing 预设 realm 可以长于单个 Session，因此 Session 结束本身不会释放文件。因此移除会停止发现，却不会删除已加载工作仍引用的文件。发布、租约获取和回收共用存储锁，避免回收与新读者获取发生竞态。Provider 临时刷新失败会记录日志，但不会使后续刷新链持续失败；后续资源通知可以重试当前 generation。

配置的发布 manifest 提供由内容派生的版本、精确归档大小与 SHA-256、有序文件清单、技能清单、平台、许可和来源。[归档验证器](../../../../packages/security/security-skills/src/resource-files.ts)拒绝非法元数据、不安全路径以及损坏或超限内容。除受控 loopback HTTP 外，必须使用 HTTPS。实现不推断公开端点；缺少 releaseManifestUrl 时，网络操作保持不可用并给出明确原因。显式内置安装读取包资产并记录 bundled 来源。[共享清单 owner](../../../../packages/security/security-skills/src/resource-inventory.ts)为内置安装和[离线 ZIP 构建器](../../../../scripts/build-security-skill-resource.ts)应用相同筛选、UTF-8 规范化和内容哈希。两条路径均不执行资源脚本或安装外部工具。

[安全研究页面](../../../../packages/client/ui-settings-security/src/client/SecurityResourcesSection.tsx)独立于预设名单注册。它通过框架绑定的 Host 快照展示已安装和可用版本、来源、进度、不可用原因、重试与显式移除。页面切换只释放其[观察](../../../../packages/client/ui-settings-security/src/client/resource-observer.ts)。该页面管理资源；评估授权与认证报告交付仍由各自 owner 负责。安装技能不授予目标、工具或导出权限。

## Alternatives considered

**把安装绑定到页面请求。** 页面切换和连接变化属于观察事件，不能证明用户想取消下载。Host 所有权保留已受理工作，并让显式取消只有一个结算点。

**覆盖或删除活动目录。** 已加载技能可能包含相对路径，并在初始读取返回后继续使用。不可变 generation 与 realm 租约保留这些路径，同时让新发现切换到已提交 generation。代价是读者释放租约前暂时保留磁盘内容。

**把内置复制称为下载成功，或虚构发布 URL。** 两者都使来源可用性无法验证。明确的内置来源和单独配置的网络 manifest 区分本地可用性与传输证据。

**用资源安装引导 MCP server，或呈现范围/报告控制台。** 资源文件不能证明执行组件就绪，也不能建立评估授权。复用既有 MCP、Settings、范围与报告 owner，避免下载事务耦合无关安装和权限。

## Consequences

没有研究预设或已安装包时，资源管理器仍可用。资源可见性来自已提交文件，评估权限仍由各 Consumer 独立执行。Realm 保留已加载路径期间，旧 generation 会占用磁盘；租约所有者不明确时，优先保留而非冒险删除。Host 关闭会结束进行中的下载，不持久化部分传输进度。写锁所有者崩溃后，需要操作者确认其已停止，再人工恢复；PID 年龄或超时不构成自动移除写锁的授权。

内置资源包含 22 个技能入口。[来源记录](../../../../packages/security/security-skills/assets/resource-provenance.json)与 [NOTICE](../../../../packages/security/security-skills/assets/NOTICE)保留已知许可，并标明尚未确认的第三方修订和权限。平台元数据描述可读取的资源文件，不代表引用工具普遍支持各平台。缺失的 bootstrap helper 保持为明确限制，不补造安装器。本决策不证明已有公开资源发布。

## Verification

[管理器测试](../../../../packages/security/security-skills/tests/resources.spec.ts)、[存储测试](../../../../packages/security/security-skills/tests/resource-store.spec.ts)和[归档测试](../../../../packages/security/security-skills/tests/resource-files.spec.ts)验证 generation 切换、基于 revision 拒绝跨空状态转换的过期写入、启动回收、Provider 刷新失败后的恢复、相对文件保留、取消、竞争所有权与非法归档。[真实 Host Remote 场景](../../../../packages/api/security-research-controller/tests/resources-lifecycle.host.spec.ts)覆盖观察断开、controller 重载、管理器释放与显式内置安装；[管理器缺失场景](../../../../packages/api/security-research-controller/tests/resources.host.spec.ts)固定不可用行为。

[资源组件测试](../../../../packages/client/ui-settings-security/tests/SecurityResourcesSection.client.spec.tsx)和[观察测试](../../../../packages/client/ui-settings-security/tests/resource-observer.client.spec.ts)固定可见状态与观察释放行为。[Web 资源场景](../../../../apps/web/tests/security-resources.e2e.ts)使用真实 loopback manifest 与 ZIP server，覆盖导航、取消、下载失败重试、重新下载、更新、Host 重启和移除。[可选研究场景](../../../../apps/web/tests/security-capabilities.e2e.ts)保留范围和报告后端检查，并断言资源页没有范围/报告控件。这些场景定义不代表完整 Web 执行已通过；发布验证单独记录其结果。

[模型可见资源测试](../../../../packages/security/security-skills/tests/model-visible.spec.ts)验证真实 Session 请求、技能工具结果、重新打开后的持久结果与内置 Provider；其预期输出为[managed-security-skills.json](../../../../packages/security/security-skills/tests/expected/managed-security-skills.json)。[构建器测试](../../../../scripts/build-security-skill-resource.spec.ts)独立验证归档内容、确定性时间与换行、不安全输入拒绝和真实 loopback 传输。已观察到的本地构建包含 503 个文件和 22 个技能，共享内置清单与 ZIP 描述符完全一致。这验证打包，但不宣称存在公开下载端点。

## Related decisions

本决策部分替代 [Worktree/Sidebar 组合记录](2026-09-10-worktree-sidebar-security-integration.zh.md)中的安全研究菜单门控，以及[范围与报告记录](2026-09-13-security-scope-and-report-downloads.zh.md)中的范围编辑器/报告控件展示。其 Worktree/Sidebar 和授权依据继续有效。[原生浏览器与证据记录](2026-09-13-native-browser-and-security-evidence.zh.md)保留独立 Provider 与持久化证据归属；这些记录均未被完整替代或归档。
