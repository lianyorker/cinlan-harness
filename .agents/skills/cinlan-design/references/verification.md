# Visual verification and same-task benchmark

This is a procedure, not a completed experiment. No approved images or cross-model quality results are bundled with this skill. Keep user-provided references and project evidence with the task; do not invent an approval or treat a self-generated screenshot as an accepted baseline.

## Verify one artifact

1. **Freeze inputs before capture.** Record the brief, reference path and approval/provenance, implementation revision, route, viewport in CSS pixels, device-pixel ratio, zoom, theme, locale, fonts, fixture, and UI state. Use the reference's known viewport; otherwise use 1280×800, DPR 1, 100% zoom as the desktop comparison condition. Responsive tasks also capture 390×844 under the same fixture. Record source uncertainty instead of stretching a screenshot to imply exact fidelity.
2. **Make rendering repeatable.** Freeze timestamps and random data, seed storage, use deterministic network responses, wait for fonts/assets, and settle animation at a declared frame. Preserve realistic text lengths, counts, and errors. A screenshot with different content is not a geometry comparison.
3. **Measure the rendered page.** Record bounding boxes for shell/sidebar, content edges, main groups, rows, and controls; computed font and line-height; overflow; visible item count; control hit bounds; and contrast against actual adjacent backgrounds. Set tolerances before evaluating. For exact UI matching with a known-scale source, start with ±2 CSS px for major alignments and sizes; adjust only for a documented rendering difference.
4. **Save and inspect images.** Capture the whole viewport and relevant dialog/error states. Open the baseline and result at equal scale and compare them side by side; an overlay or difference image can help find shifts. Inspect hierarchy, density, visual weight, wrapping, alignment, and whether the same content fits. Record specific differences and their locations. A file existing, nonblank pixels, or passing DOM assertions does not show visual equivalence.
5. **Check behavior and reflow.** Exercise the primary task, keyboard focus, errors, and recovery. Run applicable [quality checks](quality-checklist.md), including reduced motion, zoom, and coarse-pointer targets. Correct the largest layout or hierarchy mismatch first, then recapture affected states under the same inputs.
6. **Report the evidence.** List screenshots actually inspected, measurement results, remaining visual differences, behavior checks, and limitations. Without a baseline, compare against the declared layout goals and label the visual result provisional. Without image inspection capability, explicitly mark visual comparison unperformed.

## Fixed benchmark case

Use this synthetic settings case when no project-specific benchmark exists. It is a text fixture, not an approved visual example or a statement about product features. For an inheritance/reference benchmark, supply and freeze an actual host implementation and designated reference before running; without them, evaluate only the new-design mode.

| Input | Fixed value |
|---|---|
| Brief | Build a desktop settings view with a persistent left navigation and one main content column. Preserve the supplied host/reference when present. Group related settings, show their current values, and support editing and saving. |
| Navigation | 通用设置 (selected), 模型与连接, 工具与权限, 快捷键, 关于 |
| Group 1: 外观 | 主题: 跟随系统 (choices: 浅色, 深色, 跟随系统); 界面语言: 简体中文; 界面缩放: 100% |
| Group 2: 工作区 | 默认项目目录: D:/Projects/client-work; 自动恢复上次打开的工作区: on; description: 重新打开应用时，恢复上次关闭前的工作区和已打开的文件。 |
| Group 3: 通知 | 任务完成时显示桌面通知: on; 在后台任务需要确认或输入时提醒我: on; 播放提示音: off |
| Footer | 保存更改 (disabled when clean, enabled when edited); state label: 所有更改已保存 / 有未保存的更改 |
| Fixed interaction | Change theme to 深色, save successfully, then edit the project path and trigger the fixed error 无法保存设置，请重试。 Preserve the edited value. |
| Capture states | Initial light view; theme choices open with keyboard focus; edited view; save failure with the retained value |
| Capture environment | 1280×800 CSS px, DPR 1, 100% zoom, zh-CN, fixed browser/version, fixed font files or recorded system font; no live network data |

Freeze the exact prompt, fixture, host/reference assets and their checksums, accepted behaviors, capture actions, model settings, tool access, and generation budget in a run manifest. Use the same inputs in every condition; do not silently simplify the fixture for a weaker result. If a different task is needed, create a separate case and keep its inputs fixed.

## Compare skill and model conditions

- Use at least two target models and three fresh independent runs per model per condition. Compare the same task with no skill and with this exact skill revision; record model version, sampling settings, time/output budget, context, and available tools. A seed is useful when supported, but does not substitute for repeats.
- Keep supplied reference/product evidence equal across conditions. Randomize run order where possible. Retain every attempt, including tool failures, partial outputs, and abandoned results; do not select only the best sample.
- Capture every completed artifact using the same environment and fixture. Compare measurements and actual rendered images. Have reviewers assess anonymized outputs for task completion, reference consistency, density/readability, state completeness, and visual quality on a predeclared scale; separate objective failures from subjective ratings.
- Record reviewer identity or role and whether review was independent. Self-review is weaker evidence and must be labeled. Classify failures as rule conflict, missing evidence/tool/context, or execution deviation only when the run supports that attribution.
- Publish per-run results and distributions with image provenance, failures, and limitations. Report improvement only for the tested tasks and conditions. Writing this protocol, inspecting one page, or fixing token contradictions does not establish cross-model quality improvement.
