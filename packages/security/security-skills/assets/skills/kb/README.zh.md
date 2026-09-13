# 知识库

[English](README.md) | 中文

AI 使用说明：[AI-USAGE.md](AI-USAGE.md)

Reusable knowledge lives here. Unlike `notes/`, this is not per-case evidence; it is a tactical reference library.

| Area        | Path                                 | Content                                        |
| ----------- | ------------------------------------ | ---------------------------------------------- |
| Web CTF     | [ctf-website](ctf-website/README.zh.md) | 25 类 112 篇 — Web 攻击全表面 + CVE 实战 + DoS |
| APK Reverse | [apk-reverse](apk-reverse/README.zh.md) | 8 类 17 篇 — APK/DEX 逆向                      |
| PE Reverse  | [pe-reverse](pe-reverse/README.zh.md)   | Windows 本地代码执行 + PE 分析                 |
| General     | [general](general/README.zh.md)         | 6 类 24 篇 — 密码学/协议/Agentic AI/内核/方法论 |

## 文档审计

仓库内置标准库-only 审计脚本，检查 `kb-index.json`、索引目标、重复 ID、本地链接
和正文质量基线：

```powershell
# 在仓库根目录审计默认 KB
python scripts/misc/kb_doc_audit.py

# 显式指定当前仓库根目录或 KB 根目录
python scripts/misc/kb_doc_audit.py --root .

# CI 模式：warning 也返回非零
python scripts/misc/kb_doc_audit.py --strict
```

默认模式只在 error 时返回非零；`--strict` 在 error 或 warning 时返回非零。
