/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'row.title': '加载技能',
  'row.running': '正在加载 skill',
  'row.preparing': '准备加载技能',
  'row.failed': 'skill 加载失败',
  'row.stopped': 'skill 加载已中止',
  'row.instructions': '说明',
  'row.inspect': '查看',
  'menu.userOnly': '仅用户',
  'sharing.tab': '技能分享与审核',
  'sharing.title': '技能分享与审核',
  'sharing.subtitle': '查看技能审核规则、离线归档分享方案与发布权限状态。',
  'sharing.cloudUnavailableTitle': '云端链接发布服务未配置',
  'sharing.cloudUnavailableDescription': '当前运行于私有/自托管环境，未配置中心化发布服务或官方云端账号。云端未公开链接（Unlisted Link）发布功能已标记为不可用；如需跨设备分享，请采用离线本地包归档方案。',
  'sharing.agentPublishTitle': '允许 Agent 自动发布技能链接',
  'sharing.agentPublishDescription': '默认禁用。技能目录可能包含脚本、配置或环境凭据，在没有受信发布后端和脱敏审查前禁止 Agent 自动发布。',
  'sharing.agentPublishDisabledReason': '当前无可用发布后端',
  'sharing.offlineTitle': '离线本地归档与分享方案',
  'sharing.offlineDescription': '由于无中心化云端依赖，推荐将技能目录打包为本地离线归档（.tar.gz）或置于团队共享仓库分发。',
  'sharing.step1Title': '1. 选择并审核技能',
  'sharing.step1Desc': '检查技能目录中的 SKILL.md、scripts/ 脚本及依赖文件，确保无敏感凭据泄露。',
  'sharing.step2Title': '2. 导出或压缩打包',
  'sharing.step2Desc': '使用标准归档工具将技能文件夹完整打包为 .tar.gz 归档。',
  'sharing.step3Title': '3. 离线安装与分发',
  'sharing.step3Desc': '在目标机器解压至技能目录，Harness 启动后将自动发现并完成完整性校验。',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.title': 'Skill',
  'row.running': 'Loading skill',
  'row.preparing': 'Preparing to load a skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'row.inspect': 'Inspect',
  'menu.userOnly': 'user-only',
  'sharing.tab': 'Skill Sharing & Review',
  'sharing.title': 'Skill Sharing & Review',
  'sharing.subtitle': 'Review skill audit rules, offline archive sharing options, and publishing permission status.',
  'sharing.cloudUnavailableTitle': 'Cloud Link Publishing Service Not Configured',
  'sharing.cloudUnavailableDescription': 'Running in a private/self-hosted environment without a configured central publishing service or cloud account. Unlisted skill link cloud publishing is disabled; for cross-device sharing, please use offline local archive bundles.',
  'sharing.agentPublishTitle': 'Allow agents to publish skill links',
  'sharing.agentPublishDescription': 'Disabled by default. Skill folders may contain scripts, configuration, or credentials. Automated agent publishing is prohibited without a trusted backend and desensitization review.',
  'sharing.agentPublishDisabledReason': 'No publishing backend available',
  'sharing.offlineTitle': 'Offline Local Archive & Sharing Workflow',
  'sharing.offlineDescription': 'Without centralized cloud dependencies, packaging skill directories into local archives (.tar.gz) or distributing via team Git repositories is recommended.',
  'sharing.step1Title': '1. Select and review skills',
  'sharing.step1Desc': 'Inspect SKILL.md, scripts/, and assets in the skill directory to ensure no sensitive credentials or keys are leaked.',
  'sharing.step2Title': '2. Export or bundle archive',
  'sharing.step2Desc': 'Use standard archive tools to package the skill directory into a standalone .tar.gz archive.',
  'sharing.step3Title': '3. Offline distribution & install',
  'sharing.step3Desc': 'Extract into the target host skill directory. Harness will automatically discover and validate the skill.',
} satisfies Record<SkillKey, string>
