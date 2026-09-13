# 原生迁移续批：Work Items 与 Typert

日期：2026-09-13

## 结论

已完成 Work Items 原生可选 profile、Host/Client Remote、Settings 读取与本地关联链路接入；修复 Typert 的导入值查询崩溃和侧栏版本漂移。不是全部迁移完成，也不是所有功能均经过真实外部 Provider 验证。

## 本批改动

- packages/bundle/cinlan-work-items：独立 bundle；packages/boot/app-boot/src/profile.ts：可选 work-items profile。通用 web profile 不挂载这项能力。
- packages/api/remotes：生成式 workItems Remote 描述符及类型组合；更新 tsconfig、安装解析依赖和 pnpm-lock。
- packages/api/work-items-controller：适配当前 Workspace 删除和 Session 归档语义；异步 Provider 读取后重查归属。删除再创建 Workspace 不复用旧关联；Provider 不可用时仍可清理本地链接。
- packages/client/ui-work-items：适配当前 Workspace 投影与归档 Session；修正窄容器内列表/详情和表单宽度，不以裁切隐藏溢出。
- packages/work-items：GitHub REST 与 Linear GraphQL 的 Harness 原生 Provider；使用既有预览/确认/取消账本。两个 Provider 默认 allowWrites: false，本次未启用真实外部写入。
- packages/typert/generator：typeof import 值查询保留表达式，不误送进 class/interface 成员收集器；回归覆盖常量与泛型函数。
- packages/client/ui-better-sidebar：package.json、dsh.plugin.json、SIDEBAR_SERVICE_VERSION 对齐当前 0.1.5-alpha.1；补充公开 Service 方法 JSDoc，未改变侧栏交互行为。
- scripts/gen-tool-catalog.ts：增加 Work Items 原生注册配方；重新生成英文目录并补齐中文对应段落。Work Items 类型/服务归属单独登记，不批量豁免其他迁移包。

## 实际验证

日志统一位于 .artifacts/native-migration-20260913/continuation/。

| 验证 | 结果 | 日志 |
|---|---|---|
| pnpm run build | 通过；248 个 Client artifact。该次调用使用 NODE_OPTIONS=--max-old-space-size=8192；原 4 GiB Host 构建曾出现 OOM | build-final.log |
| pnpm run hygiene | 16/16 通过，包含 NodeNext、built invariants、包依赖、入口分类及 Cordis 配置 | hygiene-final.log |
| Work Items、profile、Typert 聚焦测试 | 15 文件、230 测试通过 | final-focused.log |
| Web replay：Work Items、原生 Browser、安全证据 | 3 文件、7 测试通过 | web-replay-final.log |
| built SQLite 顺序进程恢复 | 2 测试通过；成功回执不重复发送，外部操作后中断恢复为 unknown | work-items-restart.log |
| 侧栏版本修复复验 | 2 文件、75 测试通过 | sidebar-version.log |
| 本批代码 lint | 通过 | lint-focused.log |
| 文档结构与站点投影聚焦测试 | 2 文件、75 测试通过 | doc-focused.log |

Web 场景实际走 Settings → generated Remote → native GitHub Provider，只有外部 HTTP 被测试替身替换；校验只读默认值、本地关联、Host 重启和未安装时不显示。1680/1000/600px 均检查内容宽度及控件命中。Browser 与安全证据为上一批能力的回归，不代表新增了 Cookie 导入或授权执行覆盖。

全量 test:gui 最初为 435 文件通过、2 文件失败；失败原因是侧栏旧版本号。修复后仅重跑两个拥有这些失败的测试文件，未将初次全量命令报告为通过。

全量 doc-sync 实际运行结果为 17/34 通过。随后本批引入的 tool catalog、README Model Experience/limitations、文档预算、站点条目计数与相对链接问题分别修复并复验；未再次把全部 34 项跑成绿色。其他迁移包的类型/服务归属、源码 JSDoc、生成目录及既有 docs/dev/暂存文档的配对和换行债务仍需处理。

## 尚未完成

1. Browser：Cookie 导入、主页/搜索引擎、上传下载、网络检查、历史和 profile 管理。本批未实现这些新增操作。
2. Security Research：scope 编辑、Findings/报告下载 UI、全 shell/network/browser Consumer 授权强制执行、原生 Skill 安装更新。空 grant 仍不等于全局执行隔离。
3. Computer Use / Mobile Device：Windows、Android、iOS 原生 Provider 未交付，旧 CLI 适配器未替换。
4. Work Items：专用 Provider scope/凭据配置 UI、真实 GitHub/Linear 账户验收、模型对话录制场景、同时多 Host 共享写账本仍未交付；此批不等于 Orca 全部任务集成能力。
5. Design Studio、Voice、SSH、TUI 仍未接入正式原生组合。
6. 完整 doc-sync、跨平台打包、GitHub 分发与安装/更新/卸载验收仍未完成。

## 保留与知识增量

sourceDeletionAllowed: false。三个旧目录全部保留，未 push、tag、release 或发布包。

新增 Agent Notes：2026-09-13-native-work-items-profile 与 2026-09-13-typert-import-value-queries。相关旧决策仍有效，没有归档或删除既有 Note。

已将 Workspace 生命周期适配、重启测试存储根和 Typert 值查询处理的可复用经验写入 runtime reverse-skill KB：harness-native-capability-migration.md。当前项目没有 docs/rules/reverse-skill/kb，因此未创建伪同步目录。
