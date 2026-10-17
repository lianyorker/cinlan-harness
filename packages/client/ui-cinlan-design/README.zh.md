---
description: "Cinlan AI 设计工作室：具备 TasteSkill 反模板扫描器、20 套大师风格预设与响应式沙箱的协同设计工作区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-cinlan-design

[English](README.md) | 中文

## 概述

Cinlan AI 设计工作室提供三端响应式预览沙箱（1440px 桌面端、768px 平板端、390px 移动端）、源自 TasteSkill v2 的自动化 Anti-Slop 设计体检仪、20 套精选大师设计方向预设，以及将视觉图钉批注直接注入 Agent 循环的协同能力。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

从右侧边栏引导中打开 **Cinlan 设计** 或按下快捷键 `Ctrl+Alt+D`（macOS 上为 `Cmd+Alt+D`）。输入 HTTP/HTTPS 地址或本地开发预览 URL（例如 `http://localhost:3000`）。

### 适用场景

适用于 AI 协同界面设计、多端响应式审查、根据 Anti-Slop 规则体检界面，或一键应用精选大师设计风格方向。

### 最小配置

当包含在 profile 的 cordis patch 中时，该包自动注册：

```yaml
- id: ui-cinlan-design
  name: '@deepseek-ai/dsh-client-ui-cinlan-design'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

### Anti-Slop 设计体检仪

内置 TasteSkill 引擎扫描 HTML 与 CSS 代码中 22 项被禁用的生成式反模式（正文等宽字体、紫蓝生成式渐变、渐变文字、无序阴影、01/02 装饰数字、微小大写标签以及默认回退字体），输出 0 至 100 分的设计健康评分。

### 视觉图钉批注

用户点击沙箱画布任意元素即可留下带编号的图钉，并附带结构化维度（排版、空间、配色、组件、文案）。提交图钉后自动将结构化 Markdown 反馈注入当前会话草稿中。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

使用 **20 大师风格库** 抽屉引导 Agent 应用瑞士国际网格、温润文学排版或高对比度黑白极简布局。

-----

<a id="model-experience"></a>
## 模型体验

结构化的图钉反馈与审计报告提供精确的代码行与选择器目标，大幅减少模型盲目修改与反复对齐循环。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

CDP 远程计算样式审查需要活跃的 Electron 桌面桥接；Web profile 使用客户端源代码扫描。

-----

<a id="dev-note"></a>
## 开发者注记

完全遵循严格的强类型国际化字典与 `--dsw-*` 设计令牌体系。
