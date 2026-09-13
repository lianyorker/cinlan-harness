# Agent Note: Typert 导入值查询

Status: implemented

[English](2026-09-13-typert-import-value-queries.md) | 中文

## 问题

带限定名称的 typeof import 表达式可引用变量或函数。将其符号当成 class/interface 声明，会把没有 members 的声明传入类型成员收集器，导致目录分析崩溃。

## 决策

导入值查询保留模块、限定名称、属性和类型参数，不创建命名类型声明目标。普通 import 类型引用仍进入声明分析。renderer 重现所保留的查询表达式。

## 考虑过的替代方案

**替换为空成员数组。** 这会为值伪造 class/interface 并隐藏分类错误。保留原始值查询既维持其语义，又不虚构类型声明。

## 影响

回归测试同时覆盖导入常量和泛型函数。现有 type-model、renderer 和 schema-emitter 测试保持不变。这不豁免缺失的文档分类，也不代表整个 doc-sync 语料通过验证。

[编译器无关模型决策](../architecture/2026-07-27-compiler-independent-typert-model.zh.md) 继续有效；本修复保留它对类型表达式与命名声明的区分。
