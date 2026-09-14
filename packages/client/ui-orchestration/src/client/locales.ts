/** Orchestration settings section locale dictionaries. */

export interface OrchestrationDictionary {
  nav: string
  title: string
  description: string
  engineOverviewTitle: string
  engineOverviewDescription: string
  engineConcurrencyLabel: string
  engineConcurrencyDescription: string
  engineTotalAgentsLabel: string
  engineTotalAgentsDescription: string
  coverageTitle: string
  coverageDescription: string
  coverageReady: string
  coverageMissing: string
  coverageBroken: string
  coverageRefresh: string
  coverageLoading: string
  coverageError: string
  coverageSummaryReady: string
  coverageSummaryTotal: string
  examplesTitle: string
  examplesDescription: string
  exampleWorkflowTitle: string
  exampleWorkflowDescription: string
  exampleParallelTitle: string
  exampleParallelDescription: string
  examplePipelineTitle: string
  examplePipelineDescription: string
  docsLink: string
  noPresets: string
}

export const en: OrchestrationDictionary = {
  nav: 'Orchestration',
  title: 'Orchestration',
  description: 'Multi-agent coordination and workflow automation. The workflow engine runs model-authored scripts that fan out subagents at scale.',
  engineOverviewTitle: 'Workflow Engine',
  engineOverviewDescription: 'The DSH workflow engine executes JavaScript orchestration scripts in a sandboxed worker thread. Scripts use agent(), parallel(), and pipeline() hooks to coordinate subagents.',
  engineConcurrencyLabel: 'Concurrency',
  engineConcurrencyDescription: 'Up to 16 concurrent subagents per workflow run (auto-tuned from available parallelism).',
  engineTotalAgentsLabel: 'Total Agent Cap',
  engineTotalAgentsDescription: 'Each workflow run supports up to 1000 subagents (configurable).',
  coverageTitle: 'Agent Preset Coverage',
  coverageDescription: 'Each preset that includes the workflow tool can orchestrate subagents. Presets without it cannot run workflows.',
  coverageReady: 'Ready',
  coverageMissing: 'Missing',
  coverageBroken: 'Broken',
  coverageRefresh: 'Check again',
  coverageLoading: 'Checking preset coverage…',
  coverageError: 'Failed to load preset coverage.',
  coverageSummaryReady: '{count} of {total} presets support orchestration',
  coverageSummaryTotal: '{total} presets total',
  examplesTitle: 'Usage Examples',
  examplesDescription: 'The model writes workflow scripts when you ask for large multi-agent orchestration. Here are common patterns:',
  exampleWorkflowTitle: 'Basic workflow',
  exampleWorkflowDescription: 'Ask the model to audit many files or research multiple topics — it writes a script that fans out subagents and returns structured results.',
  exampleParallelTitle: 'Parallel execution',
  exampleParallelDescription: 'Use parallel() to run independent subagents concurrently with a barrier — all must complete before the next step.',
  examplePipelineTitle: 'Pipeline stages',
  examplePipelineDescription: 'Use pipeline() to run each item through stages independently with no barrier between stages — ideal for multi-stage processing.',
  docsLink: 'Read the workflow tool documentation',
  noPresets: 'No agent presets found. Create a preset that includes the workflow tool to enable orchestration.',
}

export const zh: OrchestrationDictionary = {
  nav: '编排',
  title: '编排',
  description: '多 Agent 协调和工作流自动化。工作流引擎在沙箱中执行模型编写的脚本，批量调度子 Agent。',
  engineOverviewTitle: '工作流引擎',
  engineOverviewDescription: 'DSH 工作流引擎在隔离的 Worker 线程中执行 JavaScript 编排脚本。脚本通过 agent()、parallel() 和 pipeline() 钩子协调子 Agent。',
  engineConcurrencyLabel: '并发数',
  engineConcurrencyDescription: '每个工作流运行最多 16 个并发子 Agent（根据可用并行度自动调整）。',
  engineTotalAgentsLabel: '总 Agent 上限',
  engineTotalAgentsDescription: '每个工作流运行支持最多 1000 个子 Agent（可配置）。',
  coverageTitle: 'Agent 预设编排覆盖',
  coverageDescription: '包含 workflow 工具的预设可以编排子 Agent。不包含的预设无法运行工作流。',
  coverageReady: '就绪',
  coverageMissing: '缺失',
  coverageBroken: '损坏',
  coverageRefresh: '重新检查',
  coverageLoading: '正在检查预设编排覆盖…',
  coverageError: '加载预设编排覆盖失败。',
  coverageSummaryReady: '{count} / {total} 个预设支持编排',
  coverageSummaryTotal: '共 {total} 个预设',
  examplesTitle: '使用示例',
  examplesDescription: '当你需要大规模多 Agent 编排时，模型会编写工作流脚本。以下是常见模式：',
  exampleWorkflowTitle: '基本工作流',
  exampleWorkflowDescription: '让模型审计多个文件或研究多个主题——它会编写脚本批量调度子 Agent 并返回结构化结果。',
  exampleParallelTitle: '并行执行',
  exampleParallelDescription: '使用 parallel() 并发运行独立的子 Agent 并等待全部完成——适合需要所有结果汇总后再继续的场景。',
  examplePipelineTitle: '流水线阶段',
  examplePipelineDescription: '使用 pipeline() 让每个项目独立通过多个阶段，阶段间无屏障——适合多阶段处理。',
  docsLink: '阅读工作流工具文档',
  noPresets: '未找到 Agent 预设。创建一个包含 workflow 工具的预设以启用编排。',
}

export type OrchestrationSettingsKey = keyof OrchestrationDictionary
