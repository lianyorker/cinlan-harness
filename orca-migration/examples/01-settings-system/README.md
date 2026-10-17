# 案例 1：配置与设置系统迁移

本案例展示如何将 Orca 的配置系统迁移到 Harness。

---

## 案例概览

**迁移目标**：Orca 的配置与设置系统  
**迁移时间**：预计 2-3 周  
**完成状态**：🚧 待开始（作为第一个案例的模板）

---

## 目录结构

```
01-settings-system/
├── README.md                    # 本文件
├── conversation.md              # 完整的迁移对话记录
├── analysis.md                  # Orca 配置系统分析
├── mapping.md                   # Orca → Harness 映射关系
├── implementation/              # Harness 实现代码
│   ├── config_loader.py
│   ├── orca_adapter.py
│   └── settings_manager.py
└── tests/                       # 测试用例
    ├── test_config_loader.py
    ├── test_behavior_parity.py
    └── fixtures/
```

---

## 迁移步骤

### 第 1 步：分析 Orca 的配置系统

阅读 Orca 的相关代码：
- `src/shared/global-settings-types.ts` - 配置类型定义
- `src/shared/default-global-settings.ts` - 默认配置值
- `src/main/settings/settings-manager.ts` - 配置加载逻辑

输出 `analysis.md`，包含：
- Orca 的配置文件格式
- 配置项分类（全局/用户/项目）
- 配置合并逻辑
- 热重载机制
- 迁移工具（如果有）

### 第 2 步：设计 Harness 的映射方案

输出 `mapping.md`，包含：
- Orca 配置项 → Harness 配置项的映射表
- 配置文件路径的映射
- 不需要迁移的配置项（Orca 特有）
- 需要新增的配置项（Harness 特有）

### 第 3 步：实现 Harness 的配置系统

在 `implementation/` 目录下实现：
- `config_loader.py`：Harness 原生的配置加载器
- `orca_adapter.py`：读取 Orca 配置并转换为 Harness 格式
- `settings_manager.py`：配置管理器，支持三级合并和热重载

### 第 4 步：编写测试

在 `tests/` 目录下编写：
- 单元测试：每个函数的正确性
- 行为对比测试：与 Orca 的行为一致性
- 集成测试：与其他模块的联动
- 边界测试：错误处理

### 第 5 步：文档和验收

- 更新 `../../PROGRESS.md`
- 记录踩过的坑到 `../../PITFALLS.md`
- 更新术语表 `../../GLOSSARY.md`（如果有新发现）
- 通过验收检查清单

---

## 预期产出

完成本案例后，应该产出：

1. **分析文档** (`analysis.md`)
   - Orca 配置系统的完整分析
   - 关键设计决策的理解

2. **映射文档** (`mapping.md`)
   - 配置项映射表
   - 不兼容项的处理方案

3. **实现代码** (`implementation/`)
   - 可运行的 Harness 配置系统
   - 代码注释解释"为什么这样映射"

4. **测试套件** (`tests/`)
   - 单元测试通过（覆盖率 > 80%）
   - 行为对比测试通过
   - 边界测试通过

5. **对话记录** (`conversation.md`)
   - 完整的 AI 对话记录
   - 包括遇到的问题和解决方案

---

## 如何使用本案例

### 对于后续迁移者

如果你要迁移其他子系统，可以参考本案例：

1. **看 `analysis.md`**：学习如何分析 Orca 的代码
2. **看 `mapping.md`**：学习如何设计映射方案
3. **看 `implementation/`**：学习如何用 Harness 实现
4. **看 `tests/`**：学习如何编写完整的测试
5. **看 `conversation.md`**：学习迁移过程中的思考过程

### 对于案例贡献者

如果你要完成本案例，请按以下流程：

1. 打开新的 AI 对话
2. 粘贴 `../../全局系统架构提示词.md`
3. 粘贴 `../../子系统级迁移提示词.md`
4. 提供 Orca 的相关代码路径（在 `../../samples/` 中）
5. 按照"迁移步骤"逐步完成
6. 将对话记录保存到 `conversation.md`

---

## 验收清单

完成本案例前，必须通过以下检查：

- [ ] `analysis.md` 已完成，包含 Orca 配置系统的完整分析
- [ ] `mapping.md` 已完成，包含所有配置项的映射关系
- [ ] `implementation/` 目录下有可运行的代码
- [ ] 单元测试通过，覆盖率 > 80%
- [ ] 行为对比测试通过（与 Orca 输出一致）
- [ ] 集成测试通过（与会话管理联动）
- [ ] 边界测试通过（文件缺失、格式错误等）
- [ ] 性能测试通过（配置加载 < 50ms）
- [ ] 代码审查通过
- [ ] `conversation.md` 已保存，记录完整的迁移过程
- [ ] `../../PROGRESS.md` 已更新
- [ ] 如果踩到新坑，已记录到 `../../PITFALLS.md`

---

## 相关资源

- [Orca 配置文件示例](../../samples/.cache/upstream/src/shared/default-global-settings.ts)
- [配置类型定义](../../samples/.cache/upstream/src/shared/global-settings-types.ts)
- [Harness 扩展开发文档](https://harness.example.com/docs/extensions)（假设链接）
- [术语对照表](../../GLOSSARY.md)
- [测试策略](../../TESTING.md)

---

**最后更新**：2026-10-10  
**案例状态**：模板（等待实际迁移）
