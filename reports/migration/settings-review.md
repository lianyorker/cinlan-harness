# 设置与动态侧栏复审结果

## 结论

本轮完成设置展示、侧栏位置与可选安全研究预设的修复；没有将界面状态等同于软件安装或 Provider 可用性。整体旧目录迁移和发布验收仍未完成。

## 已完成

| 项目 | 结果 |
| --- | --- |
| 插件架构 | Settings 页面和导航图标仍通过 Slot 注册；设备能力保留 Service / Provider / Tool 分层；没有修改 Agent loop。 |
| 右上角侧栏 | 用真实的 Session header utilities Slot 替换不存在的标记；默认收起时与 Session 日志居中对齐，点击后移动到面板标签栏。 |
| 设计 | 按参考图恢复主卡片与三张说明卡；安装/替换尚未决定，不提供虚假的安装命令。 |
| 计算机控制 | 保留主卡片、可复制 profile 启动命令、真实只读检查与操作说明；组件清单收进详情。 |
| 手机模拟器 | 改名并明确区别于“移动端”；参考 Orca 分开呈现可用性、SDK/默认设备限制及 Agent 控制步骤。 |
| 浏览器 | 参考 Orca 改为分步设置与示例提示；尚无 Cookie API，不提供假导入按钮或假开关。 |
| 安全研究 | 改名；只有 Host 名单包含 security-research 预设时才注册导航和页面，不匹配通用 Skill 或设置包自身。 |
| 可选预设 | 预设随 security-research bundle 交付，通过 AgentPresets.registerSystemRoot 注册；普通 Web 名单不自动添加它。贡献撤回不删除文件或已有组装。 |
| 清理 | 删除被替代的通用页面实现、无用文案及注释掉的旧挂载项；清理失败编译产生的 604 个已确认产物，保留原始源码和先前文件。 |

## 验证

- `pnpm run build`：通过，记录 246 个 Client artifact。
- 设置、预设注册、预设 UI 和侧栏对齐聚焦测试：22 个文件、362 项通过。
- 相关 Web 场景：8 个文件、48 项 refresh 与 replay 均通过。
- 1680px、1000px、600px 下侧栏几何检查通过，并验证移除偏移的反例会失败。
- 当前运行 Web 实测：toggle top=14px、height=28px；Session 日志 top=15px、height=26px；垂直中心差=0px。
- 本轮修改范围的 lint、Client UI 本地化、包依赖、Cordis 配置和 README 模型体验检查通过；`git diff --check` 无输出。
- 全量 GUI：5618 通过、7 跳过、1 超时。超时位于 `ui-better-sidebar/tests/smoke.spec.ts` 的 Git 日志分页；单独复测该文件 37 通过、1 跳过。不能将聚焦复测写成全量通过。
- 全库 lint 仍报告 2111 条错误；未对无关迁移包执行批量自动修复。
- `test:docs` / `doc-sync` 未全绿：文档双语配对与硬换行问题仍在，Typert catalog 生成器报 `TypeError: members is not iterable`。本轮新增 README 规则错误已修复；生成 API 区域未手工改写。

## 尚未接入或待决定

1. **Design Studio**：当前目录没有独立 Design Studio Service/Provider/UI；现有 cinlan-design Skill 是设计方法，不等同于文档存储、预览和导出服务。Orca 的功能标题不能单独证明存在可替换的同层 API，因此暂不覆盖或重装原有设计能力。
2. **旧 Design 候选实现**：staged-final 的本地 Provider 当前只导出 HTML；PDF/PNG 明确返回不支持，并非可用的完整导出链。
3. **手机模拟器**：Android SDK 路径、设备生命周期、默认设备持久化与完整模拟器管理未迁入；当前页面只呈现实际接口所能证明的状态。
4. **浏览器**：CLI 就绪检查、独立技能安装与 Cookie 导入管理未提供完整 Host API；页面不伪造这些动作。
5. **GitHub 分发**：未上传、未发布，也未实现下载校验、版本更新、安装 UI 和发布依赖闭包；继续采用现有 profile/bundle 机制，而非在 Settings 内另造安装器。
6. **实际执行**：没有执行原生桌面输入、模拟器输入、Cookie 导入或安全研究 Agent 的真实模型回合；没有验证 macOS/Linux。

## 删除决定

以下目录均保留，`sourceDeletionAllowed` 仍为 false：

- `D:\Company\cinlan\cinlan-harness-integration`
- `D:\Company\cinlan\cinlan-harness-integration-20260909`
- `D:\Company\cinlan\cinlan-harness-staged-final-b84814d3`

目录包名齐全不等于源码、资源、配置、测试和能力等价。Work Items、Design Studio、Voice、SSH execution host、TUI 等剩余差异仍须按现有迁移清单逐项决定；本轮没有删除这些来源。

## 产物与后续复核

- 设计参考：`D:\Company\cinlan\cinlan-harness\packages\client\ui-settings-security\DESIGN.md`
- 截图：`D:\Company\cinlan\cinlan-harness\.artifacts\device-control\`
- 日志：`D:\Company\cinlan\cinlan-harness\.artifacts\settings-review-*.log`
- 架构与未决项已同步到现有 Agent Notes，未新增重复的决策记录。
- 工作分支：`codex/capability-settings-review`；未 commit、push、tag 或 release。
