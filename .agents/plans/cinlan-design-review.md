# cinlan-design 稳定性审查与修订状态

本文件记录 [技能主文](../skills/cinlan-design/SKILL.md) 与技能内参考材料的规则修订。技能修订涉及该技能目录和本审查文件；并行开展的设置产品接入与浏览器验证另见[实现方案](settings-native-implementation.md)。没有生成额外 HTML，也没有读取已排除的 warm、v2–v4 原型内容。

结论：已修正可直接定位的路由、token 和自检矛盾，补充可分发的任务模式与固定验证协议。这些修改降低了规范本身的歧义，但没有证明完整页面更美观，也没有证明任何模型能稳定复现另一模型的设计判断。后两项仍需要实际渲染与同条件实验。

## 已修复的规则问题

| 问题 | 修订后的规则 | 依据 |
|---|---|---|
| 延续产品、忠实参考与新设计混在同一流程 | 先选模式；延续产品复用 shell、主题、尺度与组件；参考任务先测量；只有方向未定的新设计才探索概念 | [入口](../skills/cinlan-design/SKILL.md)、[模式案例](../skills/cinlan-design/references/task-modes.md)、[整体构图](../skills/cinlan-design/references/art-direction.md) |
| 多份规范缺少裁决顺序 | 明确用户要求与批准参考 → 当前产品 tokens/组件 → 适用页面案例 → 通用默认值；按参考实际覆盖范围应用，缺失部分继续继承；可访问性偏差需具体说明 | [裁决顺序](../skills/cinlan-design/SKILL.md#decision-order) |
| 蓝色 token 与绿色组件默认值竞争 | 通用 UI 值集中在一份 CSS；组件引用语义角色；批准的主题在项目 token owner 中映射整个 accent family | [tokens.css](../skills/cinlan-design/references/tokens.css)、[token 说明](../skills/cinlan-design/references/design-tokens.md)、[组件](../skills/cinlan-design/references/component-patterns.md) |
| 6px 与 8/12/16px 圆角混用 | 控件、卡片、弹层、编辑性大画框分别有明确角色；页面案例引用角色，已继承或批准的取值优先 | [形状角色](../skills/cinlan-design/references/design-tokens.md#shape-and-elevation) |
| 控件视觉高度与可点范围混用 | 分开记录视觉高度、命中区域和布局预留；默认 40px 视觉高度、44px 命中区域；紧凑桌面例外明确最小目标与间距，粗指针仍为 44px；禁止跨行覆盖 | [目标规则](../skills/cinlan-design/references/design-tokens.md#control-size-and-hit-area) |
| 装饰边框与必要控件边界混用 | 必要边界采用达到 3:1 的 control token；装饰分隔与 disabled 例外明确区分；深色状态前景/背景也核算文本对比度 | [颜色角色](../skills/cinlan-design/references/design-tokens.md#color-roles)、[质量检查](../skills/cinlan-design/references/quality-checklist.md) |
| 小样本被提升为 ground truth 或行为蒸馏保证 | 主文保留有限来源说明，删除稳定复现、恒定 craft 和私人产物依赖；不再用样本描述替代任务证据 | [入口](../skills/cinlan-design/SKILL.md)、[证据范围](../skills/cinlan-design/references/task-modes.md#portable-evidence) |
| 页面案例及动效另设硬性规则 | dashboard、landing、chart 的颜色/圆角改为共享角色；营销流程与内容改为有条件案例；去除按钮位移、重复 easing/duration 声明和强制单文件交付对产品任务的干扰 | [dashboard](../skills/cinlan-design/references/surfaces-dashboard.md)、[landing/chart](../skills/cinlan-design/references/surfaces-landing-dataviz.md)、[动效](../skills/cinlan-design/references/motion-design.md) |
| 自检仅要求截图、缺少实际视觉比较 | 固定 viewport、DPR、字体、fixture、状态和捕获动作；记录几何/对比度，打开图片并排或叠加比较，列出具体偏差；DOM 通过和截图存在不能代替视觉判断 | [验证协议](../skills/cinlan-design/references/verification.md) |

## 已执行的验证

- 读取技能主文、十份原有 references 和原审查；未读取排除的历史原型。
- 扫描修订后技能的 14 个文件：44 个 Markdown 相对链接及其锚点全部解析到技能包内部，未发现外部工作区依赖。
- 检查 canonical CSS 的 138 个不同变量名（包含暗色覆写共 188 处声明），以及组件/动效/CSS 中的 75 处 `var(...)` 引用，未发现未声明变量。
- 按 sRGB 相对亮度公式检查浅色和深色各 69 对颜色，覆盖文本、必要边界/焦点、状态、选中项、反色文本、填充按钮和分类图表颜色。所检查的必要边界/焦点对最低值分别为 3.86:1、4.04:1；全部检查对满足对应的 3:1 或 4.5:1 门槛。该结果只覆盖列明的静态 token 配对，实际透明合成、图片背景和产品映射仍需渲染核验。
- 扩展检查发现按下输入框的暗色占位文字与背景仅为 4.04:1；组件将按下占位文字设为 `--text-secondary`。修订后该状态浅色为 8.40:1、暗色为 6.97:1，组件 CSS 与状态表一致，四个组件 CSS 代码块解析通过。
- 执行 `git diff --check -- .agents/skills/cinlan-design .agents/plans/cinlan-design-review.md`，未发现已跟踪修改的空白错误。
- 对组件和页面参考做定向字面搜索，检查独立绿色主题、旧边框值、裸 UI 色值、圆角与命中尺寸，以及 distillation/ground-truth/private-artifact 依赖。保留的色值例子属于 SVG 画面资产和色块名称文案，不构成第二套 UI 默认主题。

## 仍未验证与缺失的证据

| 项目 | 当前状态 | 下一步需要的证据 |
|---|---|---|
| 技能产生的完整页面视觉质量 | 尚未运行技能效果的渲染对照实验；设置产品的独立验证不构成技能效果证据 | 按固定 viewport/fixture 捕获实际产物，测量并打开截图与批准参考比较 |
| 可分发的批准整页样例 | 技能含文字模式案例和合成设置 fixture，没有批准图像、成功/失败对照或完整页面样例 | 用户或指定评审明确接受的页面、截图、来源、内容与捕获环境；不得虚构批准 |
| 跨模型效果 | 没有运行实验，不能声称改进已获验证 | 至少两种目标模型，每种有/无技能各三次同任务运行，完整保留失败与未选择结果，匿名评估 |
| 技能产生的产品运行、交互与可访问性 | 技能侧只有静态检查；token 算术不等于浏览器、键盘或辅助技术测试 | 在具体产品和导出环境测试实际状态、命中范围、重排、字体、焦点与失败恢复 |
| 任务覆盖 | 原证据来自登录卡片、两行输入的设置面板和单个 KPI 卡片，不能代表整页设计 | 设置、数据列表/详情、工具工作区、品牌页面等独立任务的完整记录 |

[同任务 benchmark 协议](../skills/cinlan-design/references/verification.md#compare-skill-and-model-conditions) 固定 brief、资产、运行权限、预算、fixture 与视口，并区分规则缺陷、上下文/工具缺失和执行偏差。它是一份待执行的协议，不是实验结果。

## 已批准页面的适用范围

已接受的设置页可作为“延续已有桌面产品”的项目级参考；它不是所有页面类型的统一风格。项目实现继续以 [既定实现方案](settings-native-implementation.md) 和 [批准 HTML](../../reports/settings-native-preview.html) 为准。本次技能修改不改变这些产物，也不宣称重新核验了它们。
