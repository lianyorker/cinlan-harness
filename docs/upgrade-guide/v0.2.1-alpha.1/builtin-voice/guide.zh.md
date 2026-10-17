---
kind: upgrade-guide
description: GUI profile 内置语音听写，替代可选实验性语音 bundle，并迁移原有模型选择。
---

# 内置语音听写

[English](guide.md) | 中文

## 变更

Web 和 Desktop profile 通过“设置 > 语音”提供听写。官方插件目录不再提供 `@deepseek-ai/dsh-experimental-voice-input-bundle`；加载 profile 时会从选中的 bundle 中移除它。实验性的 `speechToText` 设置与模型缓存不会导入内置听写。

内置目录使用 Orca 的十个本地模型。四个旧模型选择改为 Orca ID，Whisper Tiny 使用自动语言检测。浏览器模型偏好自动迁移；已有缓存目录不会移动或删除。

## 迁移

1. 打开常用的 `web` 或 `desktop` profile。删除自定义 `cordis.patch.yml` 中的实验性语音条目；它们不属于内置听写。
2. 打开“设置 > 语音”，在语音模型菜单下载所需模型。改名模型需要重新安装。SenseVoice 保留原 ID 和已校验安装；已安装的 Whisper Tiny 会显示自动语言配置的更新。
3. 选择就绪模型，测试麦克风转写，确认结果后再在输入框中使用听写。快捷键仍为 `Ctrl+Shift+E`，不会自动发送草稿。

缓存与校验语义见[语音提供者](../../../../packages/voice/voice-sherpa-onnx/README.zh.md)。实验性旧缓存保留，替代能力验证完成后可手动清理。
