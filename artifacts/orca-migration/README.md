# Orca → Harness 迁移指南

> **归档说明（2026-10-28）**：本树已归档至 `artifacts/orca-migration/`，作为 Orca `1.4.214` 固定基线的对比快照保留。有效进度跟踪在 `docs/`（49 个功能档案与[项目进度与差异总览](docs/项目进度与差异总览.md)）；根目录 `PROGRESS.md`/`ROADMAP.md`/`SUMMARY.md` 为 2026-10-10 的一代框架文档，其中"0% 进度、11 子系统"等描述已过时，不再代表真实迁移状态。文档内的源码判断为 source/profile 级，非运行验收。

## 项目目标

将 Orca 的完整系统生态（桌面端、中继、移动端）以 **deepseek-harness 为绝对底座**进行重构。这不是简单的代码迁移，而是将 Orca 的优秀设计理念与 Harness 的 LLM 原生调度能力深度融合。

## 核心差异

| 维度 | Orca | Harness |
|------|------|---------|
| 底层模型 | 本地 CLI 进程（stdin/stdout） | LLM API 调度（HTTP/Stream） |
| 生命周期控制 | `process.kill()` | `AbortController` |
| 状态管理 | 文件系统 + 内存 | 原生配置系统 + 事件总线 |
| 扩展方式 | 修改核心代码 | `extensions/` 旁路插件 |

## 使用流程

### 第一步：明确系统架构（首次对话必做）

打开新的 AI 对话，粘贴以下提示词：

```
请阅读 artifacts/orca-migration/全局系统架构提示词.md
```

这会让 AI 理解整个迁移的边界和原则。

### 第二步：选择子系统（查看 ROADMAP.md）

从 [ROADMAP.md](./ROADMAP.md) 中选择下一个要迁移的子系统，然后对 AI 说：

```
我要迁移【配置与设置系统】子系统。
请阅读 artifacts/orca-migration/子系统级迁移提示词.md，
并参考 samples/.cache/upstream/src/shared/global-settings-types.ts
```

### 第三步：落地具体功能

在子系统框架搭好后，逐个迁移功能点：

```
我要迁移【API Key 模型发现】功能。
请阅读 artifacts/orca-migration/单点功能迁移提示词.md，
参考 samples/.cache/upstream/src/shared/default-global-settings.ts 中的 api_key_model_discovery 配置项
```

### 第四步：参考已完成案例

在 `examples/` 目录下查看已完成的迁移案例，了解：
- 如何分析 Orca 代码
- 如何提取契约
- 如何用 Harness 原生机制实现
- 如何编写验证测试

### 第五步：更新进度

完成后更新 [PROGRESS.md](./PROGRESS.md)：
- 标记子系统/功能为"已完成"
- 记录遇到的问题到 [PITFALLS.md](./PITFALLS.md)
- 如果发现新的术语对照，更新 [GLOSSARY.md](./GLOSSARY.md)

## 目录结构

```
artifacts/orca-migration/
├── README.md                           # 本文件
├── ROADMAP.md                          # 子系统优先级和依赖关系
├── PROGRESS.md                         # 迁移进度跟踪
├── GLOSSARY.md                         # Orca ↔ Harness 术语对照
├── PITFALLS.md                         # 已知问题和解决方案
├── TESTING.md                          # 测试策略
├── architecture-comparison.md          # 深度架构对比
├── 全局系统架构提示词.md              # 提示词：系统级
├── 子系统级迁移提示词.md              # 提示词：子系统级
├── 单点功能迁移提示词.md              # 提示词：功能级
├── samples/                            # 参考材料
│   ├── orca-upstream.tar.gz           # Orca 上游代码打包
│   ├── upstream-tree.txt              # Orca 文件树
│   ├── reference-paths.txt            # 关键文件路径清单
│   ├── key-modules/                   # 结构化的关键代码片段
│   │   ├── settings/
│   │   ├── relay/
│   │   └── mobile-protocol/
│   └── architecture-diagrams/         # 架构图（SVG/PNG）
└── examples/                           # 已完成的迁移案例
    ├── 01-settings-system/            # 案例1：配置系统
    │   ├── conversation.md            # 实际对话记录
    │   ├── analysis.md                # 差异分析
    │   ├── implementation/            # 实现代码
    │   └── tests/                     # 测试用例
    └── 02-relay-protocol/             # 案例2：中继协议
```

## 原则和边界

### ✅ 必须遵守

1. **底座优先**：绝不修改 Harness 的 `engine/` 或 `core/` 目录
2. **概念翻译**：进程管理 → 异步任务/流式响应管理
3. **契约复用**：提取 Orca 的接口和协议，用 Harness 重写实现
4. **渐进隔离**：每个子系统独立可测，不依赖未完成的模块

### ❌ 禁止操作

1. 直接复制 Orca 的 TypeScript 代码到 Harness（语言和机制不同）
2. 为了"兼容 Orca"而破坏 Harness 的原生设计
3. 在没有测试的情况下宣称"迁移完成"
4. 跳过架构分析直接写代码

## 验收标准

每个子系统迁移完成后，必须满足：

- [ ] 功能完整性：Orca 该子系统的所有核心功能都有对应实现
- [ ] 行为一致性：相同配置下，Harness 的行为与 Orca 一致
- [ ] 测试覆盖：单元测试 + 集成测试通过
- [ ] 文档完整：接口文档 + 使用示例
- [ ] 独立运行：该子系统可以在 Mock 环境下独立测试
- [ ] 进度更新：PROGRESS.md 已更新

## 常见问题

### Q1: Orca 的某个功能依赖本地文件系统，Harness 怎么办？
A: 提取"文件系统"的抽象接口，Harness 用原生的存储机制（内存/数据库/云存储）实现。

### Q2: Orca 的 UI 组件能直接用吗？
A: 不能。Orca 是 Electron + React，Harness 可能是其他技术栈。提取 UI 的**交互逻辑**和**状态模型**，用 Harness 的 UI 框架重写。

### Q3: 迁移顺序是固定的吗？
A: 不是。但建议先迁移"配置系统"和"会话管理"这两个基础子系统，因为其他模块都依赖它们。

### Q4: 如何判断一个子系统"迁移完成"？
A: 参考 examples/ 中的案例，完成"分析 → 实现 → 测试 → 文档"四个步骤，并通过验收标准检查。

## 下一步

1. 阅读 [ROADMAP.md](./ROADMAP.md) 了解迁移计划
2. 查看 [GLOSSARY.md](./GLOSSARY.md) 熟悉术语对照
3. 参考 [examples/01-settings-system/](./examples/01-settings-system/) 第一个案例
4. 开始你的第一次迁移对话！
