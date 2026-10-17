# Orca → Harness 迁移进度跟踪

**最后更新**：2026-10-10  
**当前阶段**：P0 - 核心基础设施  
**总体进度**：0% (0/11 子系统完成)

---

## 图例

- ✅ 已完成
- 🚧 进行中
- ⏸️ 已暂停
- ⏳ 待开始
- ⚠️ 遇到阻塞

---

## P0：核心基础设施

### 1. 配置与设置系统 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的 `orcasettings` 格式
- [ ] 设计 Harness 的配置加载器接口
- [ ] 实现配置文件解析与验证
- [ ] 实现三级配置合并逻辑（用户/项目/全局）
- [ ] 实现配置热重载机制
- [ ] 编写配置迁移工具
- [ ] 单元测试（目标覆盖率 > 80%）
- [ ] 集成测试
- [ ] 文档：配置项说明
- [ ] 文档：从 Orca 迁移指南

**阻塞因素**：无

**相关文件**：
- 参考：`samples/.cache/upstream/src/shared/global-settings-types.ts`
- 参考：`samples/.cache/upstream/src/shared/default-global-settings.ts`
- 实现：`harness/extensions/settings/` (待创建)

**备注**：
- 这是整个迁移的基础，优先级最高

---

### 2. 会话生命周期管理 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的 `director.ts` 调度逻辑
- [ ] 分析 Orca 的 `cell.ts` 执行单元
- [ ] 设计 Harness SessionManager 接口
- [ ] 实现会话状态机（创建/运行/暂停/恢复/终止）
- [ ] 用 AbortController 替代 process.kill()
- [ ] 实现会话持久化
- [ ] 实现会话恢复机制
- [ ] 实现并发会话管理
- [ ] 单元测试
- [ ] 集成测试：模拟 Orca 的会话场景
- [ ] 文档：会话生命周期 API

**阻塞因素**：依赖配置系统完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/main/runtime/orca-runtime.ts`
- 参考：`samples/.cache/upstream/src/main/director/director.ts`
- 参考：`samples/.cache/upstream/src/main/cell/cell.ts`
- 实现：`harness/extensions/session/` (待创建)

**备注**：
- 这是 Orca 与 Harness 最大的概念差异点，需要仔细设计

---

## P1：核心功能层

### 3. 中继与 E2EE 通信层 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 提取 Orca 的 E2EE 协议规范
- [ ] 提取 Orca 的中继协议规范
- [ ] 设计 Harness 的通信层接口
- [ ] 实现加密握手流程
- [ ] 实现设备配对流程
- [ ] 实现密钥轮换机制
- [ ] WebSocket/gRPC 传输层选型与实现
- [ ] 安全审计：密钥管理
- [ ] 安全审计：重放攻击防护
- [ ] 单元测试
- [ ] 集成测试：端到端加密通信
- [ ] 文档：协议规范
- [ ] 文档：安全模型说明

**阻塞因素**：依赖配置系统、会话管理完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/shared/mobile-e2ee-v2-contract.ts`
- 参考：`samples/.cache/upstream/src/shared/mobile-relay-phone-protocol.ts`
- 参考：`samples/.cache/upstream/src/relay/protocol.ts`
- 实现：`harness/extensions/relay/` (待创建)

**备注**：
- 安全相关，需要额外的审计和测试

---

### 4. 桌面端终端 UI ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的终端 UI 交互模式
- [ ] 选择 Harness 的 UI 技术栈
- [ ] 实现流式输出渲染
- [ ] 实现命令输入与快捷键
- [ ] 实现多终端标签页管理
- [ ] 实现终端主题系统
- [ ] 性能优化：大量输出不卡顿
- [ ] 可访问性：屏幕阅读器支持
- [ ] 单元测试
- [ ] UI 测试
- [ ] 文档：快捷键列表
- [ ] 文档：主题定制指南

**阻塞因素**：依赖会话管理完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/renderer/src/components/terminal-pane/TerminalPane.tsx`
- 实现：`harness/ui/terminal/` (待创建)

**备注**：
- UI 技术栈需要与 Harness 现有架构协调

---

### 5. 任务调度与执行 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的任务管理机制
- [ ] 设计 Harness 的任务调度器
- [ ] 实现任务队列
- [ ] 实现任务优先级
- [ ] 实现任务状态跟踪
- [ ] 实现任务取消机制
- [ ] 实现任务自动重试
- [ ] 实现任务结果持久化
- [ ] 单元测试
- [ ] 压力测试：100+ 并发任务
- [ ] 文档：任务调度 API

**阻塞因素**：依赖会话管理完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/main/runtime/task-manager.ts`
- 实现：`harness/extensions/scheduler/` (待创建)

**备注**：
- 需要考虑与 Harness 现有的异步机制集成

---

## P2：扩展功能

### 6. 移动端协议实现 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 提取 Orca 移动端的 JSON-RPC 协议
- [ ] 实现移动端特有 API（触觉反馈、语音等）
- [ ] 实现移动端配对流程
- [ ] 实现设备管理
- [ ] 实现离线模式
- [ ] 实现消息队列与同步
- [ ] 单元测试
- [ ] 集成测试：移动端 Mock
- [ ] 跨平台测试：iOS + Android
- [ ] 文档：移动端协议规范

**阻塞因素**：依赖中继层完成

**相关文件**：
- 参考：`samples/.cache/upstream/mobile/` 目录
- 实现：`harness/extensions/mobile-protocol/` (待创建)

---

### 7. 工作区与文件管理 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的文件浏览器
- [ ] 实现文件树渲染
- [ ] 实现文件搜索与过滤
- [ ] 集成 Git 状态显示
- [ ] 实现工作区切换
- [ ] 性能优化：大型仓库（10k+ 文件）
- [ ] 单元测试
- [ ] UI 测试
- [ ] 文档：文件管理 API

**阻塞因素**：依赖桌面端 UI 完成

**相关文件**：
- 参考：`samples/.cache/upstream/mobile/src/files/MobileFileExplorerPanel.tsx`
- 实现：`harness/ui/workspace/` (待创建)

---

### 8. 工具与 MCP 集成 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的工具调用机制
- [ ] 设计 Harness 的工具注册接口
- [ ] 实现 MCP 协议适配器
- [ ] 实现自定义工具注册
- [ ] 实现工具权限管理
- [ ] 实现工具调用日志
- [ ] 单元测试
- [ ] 集成测试：调用 Orca 定义的工具
- [ ] 文档：工具开发指南

**阻塞因素**：依赖任务调度完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/main/runtime/runtime.ts`
- 实现：`harness/extensions/tools/` (待创建)

---

## P3：高级功能

### 9. 移动端伴侣 App ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 搭建移动端项目架构（React Native / Flutter）
- [ ] 实现移动端 UI 组件库
- [ ] 实现语音输入集成
- [ ] 实现浏览器面板
- [ ] 实现终端面板
- [ ] 实现推送通知
- [ ] iOS 平台适配与测试
- [ ] Android 平台适配与测试
- [ ] 应用商店发布准备
- [ ] 文档：移动端用户指南

**阻塞因素**：依赖移动端协议完成

**相关文件**：
- 参考：`samples/.cache/upstream/mobile/` 目录所有文件
- 实现：`harness-mobile/` (待创建)

---

### 10. 编辑器与 Diff 查看器 ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的编辑器功能
- [ ] 选择编辑器组件（Monaco / CodeMirror）
- [ ] 实现代码编辑功能
- [ ] 实现 Diff 对比视图
- [ ] 实现语法高亮
- [ ] 实现代码折叠
- [ ] 集成 Git 变更显示
- [ ] 单元测试
- [ ] UI 测试
- [ ] 文档：编辑器快捷键

**阻塞因素**：依赖工作区管理完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/renderer/src/components/editor/EditorPanel.tsx`
- 参考：`samples/.cache/upstream/src/renderer/src/components/editor/DiffViewer.tsx`
- 实现：`harness/ui/editor/` (待创建)

---

### 11. 自动化与 Hooks ⏳
**状态**：待开始  
**负责人**：待分配  
**开始日期**：-  
**预计完成**：-  
**实际完成**：-

**子任务**：
- [ ] 分析 Orca 的自动化规则
- [ ] 设计 Harness 的自动化引擎
- [ ] 实现规则定义 DSL
- [ ] 实现 Git Hooks 集成
- [ ] 实现定时任务
- [ ] 实现条件触发器
- [ ] 实现自动化日志
- [ ] 单元测试
- [ ] 集成测试
- [ ] 文档：自动化规则编写指南

**阻塞因素**：依赖任务调度、工具集成完成

**相关文件**：
- 参考：`samples/.cache/upstream/src/renderer/src/components/automations/AutomationsPage.tsx`
- 实现：`harness/extensions/automation/` (待创建)

---

## 总体进度统计

| 阶段 | 已完成 | 进行中 | 待开始 | 总计 | 完成率 |
|------|--------|--------|--------|------|--------|
| P0   | 0      | 0      | 2      | 2    | 0%     |
| P1   | 0      | 0      | 3      | 3    | 0%     |
| P2   | 0      | 0      | 3      | 3    | 0%     |
| P3   | 0      | 0      | 3      | 3    | 0%     |
| **总计** | **0** | **0** | **11** | **11** | **0%** |

---

## 变更记录

### 2026-10-10
- 初始化进度跟踪文档
- 定义 11 个子系统及其子任务
- 设置初始状态为"待开始"

---

## 下一步行动

1. 分配 **P0.1 配置与设置系统** 的负责人
2. 创建第一个迁移案例 `examples/01-settings-system/`
3. 开始迁移对话，使用 `子系统级迁移提示词.md`
4. 完成第一个子任务后，回来更新此文档
