---
name: as-c2-evasion-methodology
description: C2框架免杀方法论：分析 C2 源码、搜索检测规则(YARA/Sigma/Snort)、逐规则分析、修改源码绕过检测。当遇到 YARA/Sigma/Snort
  规则触发告警、beacon/im
---

# C2 框架免杀方法论

## 深入参考

以下参考资料**按需加载**，到达对应 Phase 时读取：

| Phase | 参考文档 | 用途 |
|-------|----------|------|
| 2 | [references/detection-search.md](references/detection-search.md) | YARA/Sigma/网络规则搜索命令 |
| 3 | [references/rule-analysis.md](references/rule-analysis.md) | 逐规则分析与免杀策略制定 |
| 3.5 | [references/hex-analysis.md](references/hex-analysis.md) | Hex 模式深度分析 |
| 3.6 | [references/binary-analysis.md](references/binary-analysis.md) | 二进制资产（shellcode/资源/配置）分析 |
| 3.7 | [references/string-search.md](references/string-search.md) | 敏感字符串主动搜索 |
| 4 | [references/source-modify.md](references/source-modify.md) | 源码修改模式与编译器标志 |

---

## 6 步决策流程

```
Phase 1: 识别 C2 组件
├─ 找到 implant/beacon/agent 目录
└─ 识别语言（C/Go/Rust/Python）

Phase 2: 检测规则搜索 → ⛔必读 references/detection-search.md
├─ YARA 规则（VirusTotal/GitHub/Elastic/ESET）
├─ Sigma 规则（日志行为检测）
└─ 网络规则（Snort/Suricata/Zeek）

Phase 3: 逐规则分析 → ⛔必读 references/rule-analysis.md
├─ 解析每个 $s1/$a1/hex pattern
├─ 定位源码中产生该 pattern 的位置
├─ 制定免杀策略（优先级: 编译器标志 > 构建配置 > 源码修改 > 重构）
│
├─ Phase 3.5: Hex 分析 → references/hex-analysis.md
├─ Phase 3.6: 二进制资产 → references/binary-analysis.md
└─ Phase 3.7: 字符串搜索 → references/string-search.md

Phase 4: 靶向修改 → ⛔必读 references/source-modify.md
├─ ⛔ 编译器标志优先！（-O2, -fomit-frame-pointer, -fno-ident）
├─ 字符串混淆（XOR 加密）
├─ 函数重命名
└─ Makefile/构建链修改

Phase 5: 验证
└─ grep 确认所有检测 pattern 已消除

Phase 6: 文档
└─ 生成 modifications_summary.md
```

## 优先级框架

| 优先级 | 组件 | 动作 |
|--------|------|------|
| 1 (最高) | Implant/Beacon/Agent 二进制 | 必须修改 |
| 2 (高) | 网络特征暴露 | 必须修改 |
| 3 (跳过) | 内部字符串（不影响检测） | 可跳过 |

## 免杀策略决策矩阵

| Pattern 类型 | 编译器标志 | 源码修改 | 两者都需要 |
|-------------|-----------|---------|-----------|
| 函数序言（prologue） | ✅ 通常足够 | ✅ 备选 | 少见 |
| 字符串字节 | ❌ 无效 | ✅ 必须 | — |
| API 调用序列 | ⚠️ 可能有效 | ✅ 必须 | 有时 |
| 配置结构体 | ❌ 无效 | ✅ 必须 | — |

## 字符串混淆
- 混淆后必须验证：编译通过、功能正常、不影响运行
- 自动化处理：脚本批量替换，非手动逐个修改

## ⛔ Agent 行为规则

### ⛔ NEVER
- NEVER 跳过任何一条 YARA/Sigma 规则 — 每条规则都必须有分析和免杀方案
- NEVER 不分析检测规则就直接修改源码 — 必须先完成 Phase 2-3 再进入 Phase 4
- NEVER 直接修改二进制文件 — 只修改源码，通过重新编译产生新二进制
- NEVER 忽略 Hex pattern — 必须分析 references/hex-analysis.md
- NEVER 忽略二进制资产（shellcode/资源文件/配置文件）
- NEVER 运行或测试修改后的二进制文件 — 编译成功即可

### ✅ ALWAYS
- ALWAYS 编译器标志优先 — 最低成本最高收益（-O2, -fomit-frame-pointer, -fno-stack-protector）
- ALWAYS 检查 Makefile/CMakeLists/Cargo.toml 中的免杀机会
- ALWAYS 逐规则分析：解析 pattern → 定位源码 → 制定策略 → 实施 → 验证
- ALWAYS 验证修改后 pattern 已消除（grep 确认）
- ALWAYS 生成 modifications_summary.md 文档化所有修改
- ALWAYS 每个 Phase 开始前读取对应的 references 文档

### 🔧 工具偏好
1. `grep`/`find` — 搜索源码中的检测特征
2. `bash` — 编译验证
3. 读取 [references/...](references/) — 每个 Phase 的详细步骤
4. `http_request` — 搜索在线 YARA/Sigma 规则库
