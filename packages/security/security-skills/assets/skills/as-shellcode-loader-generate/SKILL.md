---
name: as-shellcode-loader-generate
description: Shellcode Loader 组合生成：从知识库选择 storage/allocator/copier/executor 四类组件组合生成
  C/C++/Rust Loader。当已获 sh
---

# Shellcode Loader 组合生成

## ⛔ 深入参考

- 组件库完整列表（85 组件） → [references/loader-components-db.json](references/loader-components-db.json)
- 已有场景（避免重复） → [references/loader-scenarios.json](references/loader-scenarios.json)
- 架构说明与模板 → [references/loader-architecture.md](references/loader-architecture.md)

---

## 4 组件选择矩阵

```
Loader = Storage × Allocator × Copier × Executor
```

### Storage（存储方式）— 15 种
内部嵌入 | 资源段 | 远程URL | 注册表 | ADS | ...

### Allocator（内存分配）— 14 种
| 方法 | 复杂度 | 代码模式 |
|------|--------|---------|
| VirtualAlloc | simple | `VirtualAlloc(NULL, size, MEM_COMMIT\|MEM_RESERVE, PAGE_RWX)` |
| HeapCreate | medium | `HeapCreate(HEAP_CREATE_ENABLE_EXECUTE, 0, 0)` |
| NtAllocateVirtualMemory | complex | 直接 NT syscall |

### Copier（数据复制）— 9 种
memcpy | RtlMoveMemory | 循环字节复制 | WriteProcessMemory | ...

### Executor（执行方式）— 47 种
| 方法 | 复杂度 |
|------|--------|
| 函数指针 | simple |
| CreateThread | simple |
| EnumWindows 回调 | medium |
| APC 注入 | medium |
| Fiber | complex |
| NtCreateThreadEx | complex |

## 生成流程

```
1. 查组件库 → references/loader-components-db.json
2. 查已有场景 → references/loader-scenarios.json（避免重复）
3. 选择 4 组件组合
4. 选择语言（C/C++/Rust）
5. 生成代码（使用 references/loader-architecture.md 中的模板）
6. 交叉编译验证（mingw-gcc / cargo）
7. 记录场景到知识库
```

## 编译命令速查

```bash
# C
x86_64-w64-mingw32-gcc -o loader.exe loader.c

# C++
x86_64-w64-mingw32-g++ -o loader.exe loader.cpp

# Rust
cargo build --release --target x86_64-pc-windows-gnu
```

## Rust Loader 注意事项
- Rust 错误处理：使用 Result / Option 类型，避免 unwrap panic

## ⛔ Agent 行为规则

### ⛔ NEVER
- NEVER 生成前不查 references/loader-scenarios.json — 避免重复已有场景
- NEVER 使用 PAGE_EXECUTE_READWRITE 以外的权限分配可执行内存时不注释说明
- NEVER 硬编码 shellcode 在源码中 — 必须使用 storage 组件加载
- NEVER 生成代码后不交叉编译验证 — 编译通过才算完成
- NEVER 在 Loader 代码中包含明文字符串（如 "shellcode", "payload"）

### ✅ ALWAYS
- 先读取组件库 [references/loader-components-db.json](references/loader-components-db.json) 再选组件
- ALWAYS 4 组件都必须明确选择（storage + allocator + copier + executor）
- ALWAYS 使用 mingw 或对应交叉编译工具链验证编译
- ALWAYS 新场景记录到 loader-scenarios.json
- ALWAYS 代码中添加错误检查（分配失败、句柄无效）

### 🔧 工具偏好
1. 读取 [references/...](references/) — 查组件库和场景
2. `bash` — 交叉编译验证
3. 直接创建文件 — 生成 Loader 源码
