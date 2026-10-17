/** Build the scoped migration reference from reviewed inputs and pinned samples. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { features } from './features.mjs'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '..')
const docs = resolve(root, 'docs')
const samples = resolve(root, 'samples/.cache/upstream')
const commit = 'b4d5b7de7afef23f1868153f0e6918f3c56ed595'
const upstreamUrl = `https://github.com/stablyai/orca/blob/${commit}/`
const check = process.argv.includes('--check')
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const slash = path => path.replaceAll('\\', '/')
const outputs = new Map()
const originalPrompts = ['全局系统架构提示词.md', '子系统级迁移提示词.md', '单点功能迁移提示词.md']

for (const feature of features) {
  for (const path of feature.upstream) {
    if (!existsSync(resolve(samples, path))) throw new Error(`missing pinned reference: ${path}`)
  }
  for (const path of feature.harness) {
    if (!existsSync(resolve(repo, path))) throw new Error(`missing Harness reference: ${path}`)
  }
}

function sourceLinks(feature, directory) {
  return [
    ...feature.upstream.map(path => `- source / Orca: [${path}](${upstreamUrl}${path}#L1)`),
    ...feature.harness.map(path => `- source / Harness: [${path}](${slash(relative(directory, resolve(repo, path)))})`),
    `- profile: [web-app patch](${slash(relative(directory, resolve(repo, 'packages/bundle/web-app/cordis.patch.yml')))})。${feature.profile}`,
  ].join('\n')
}

for (const feature of features) {
  const directory = resolve(docs, feature.id)
  const points = feature.points.map(([name, orca, harness, status]) => `| ${name} | ${orca} | ${harness} | \`${status}\` |`).join('\n')
  outputs.set(resolve(directory, '差异分析.md'), `# ${feature.title}\n\n## 结论\n\n源码级结论：\`${feature.status}\`；建议优先级：\`${feature.priority}\`。结论限于 2026-10-10 固定基线，不是运行或视觉验收通过。\n\n## 功能与 UI 差异\n\n| 对比点 | Orca 已有设计 | 当前 Harness | 判断 |\n|---|---|---|---|\n${points}\n\n## 来源与装配\n\n${sourceLinks(feature, directory)}\n\n## 迁移范围\n\n${feature.task}\n\n## 验证边界\n\n本目录仅使用 source/profile 证据；本次未执行该功能的行为测试、真实登录、打包应用、设备操作或截图。旧测试记录不充当本次通过证据；缺失表示在列出的源码与装配中未找到等价完整链，而非证明整个仓库绝无相关代码。\n\n逐项 UI 验收见 [UI检查表.md](UI检查表.md)；实施输入见 [迁移提示词.md](迁移提示词.md)；共享规则见 [提示词使用规则.md](../提示词使用规则.md)。\n`)
  const uiPoints = feature.points.map(([name, orca, harness]) => `| ${name} | ${orca} | ${harness} | 未截图 |`).join('\n')
  outputs.set(resolve(directory, 'UI检查表.md'), `# ${feature.title} UI 检查\n\n## 源码可确认的差异\n\n| UI/交互点 | Orca | Harness | 视觉证据 |\n|---|---|---|---|\n${uiPoints}\n\n## 尚需运行的检查\n\n以下是验收要求，不表示当前产品已具备所有状态或已经通过。\n\n| 检查维度 | 验收要求 | 当前证据 |\n|---|---|---|\n| 入口与布局 | 用实际 Web/Desktop profile 检查入口可达性、分组、返回路径及 tab/panel 所有者 | source/profile，待运行 |\n| 控件与数据 | 控件值来自正确 Host/scope，写入后真实 readback，未知结果不报成功 | 待运行 |\n| 加载与空状态 | 区分 loading、真正为空、未安装、服务不可用和只读，不闪出错误的空列表 | 待运行 |\n| 错误与恢复 | 明确失败原因、重试/取消与危险操作确认；拒绝后保留草稿 | 待运行 |\n| 生命周期 | 切换 Session/Host、关闭页面、重连、重启后状态和资源释放正确 | 待运行 |\n| 二开隔离 | 按 [CLH 隔离规则](../提示词使用规则.md#clh-isolation) 检查本功能显示标识、数据 owner 与官方并存；不适用项说明原因 | 待运行，未证明隔离 |\n| 主题与本地化 | 明暗主题、zh/en、长标签和错误文案；使用 Harness locale/tokens | 待截图 |\n| 响应布局 | 1440x900、1024x768、390x844 和 200% zoom；内容不溢出或遮挡 | 待截图 |\n| 键盘与可访问性 | tab 顺序、焦点恢复、aria label、图标 tooltip 和 disabled 原因 | 待运行 |\n\n## 专项验收\n\n${feature.tests}\n\n截图与操作收据使用 \`orca-migration/exports/ui/${feature.id}/\`；记录 profile、版本、viewport、动作、结果和错误。Orca Electron 仅在明确授权启动后按上游隐藏窗口/CDP 规则验证，不抢用户焦点。\n\n源码来源见 [差异分析.md](差异分析.md)，不要用 mock 截图认定真实操作通过。\n`)
  outputs.set(resolve(directory, '迁移提示词.md'), `# ${feature.title}迁移提示词\n\n## 任务输入\n\n你需要在 Cinlan Harness 底座上补齐“${feature.title}”，参考 Orca \`1.4.214\` / \`${commit}\`。先阅读 [差异分析.md](差异分析.md)、[UI检查表.md](UI检查表.md)、[提示词使用规则.md](../提示词使用规则.md) 和当前项目最近的 AGENTS.md；分析模式只给结论，实施模式才编辑。\n\n## 必读源码\n\n${sourceLinks(feature, directory)}\n\n实施前重新读这些文件及所有调用者。固定样本只用于研究；当前 Harness 是 dirty tree，保留用户既有修改。\n\n## 本功能要求\n\n${feature.task}\n\n保持 Harness 的 Service Definition/Provider/Consumer、Cordis effect、settings slot、Remote 和 Session 日志规则。每个配置字段写明作用域、默认值来源、保存/重置/readback 及失败行为；前后端名字和语义必须一致。模型请求继续经过 Harness LLM API；PTY、SSH、relay、设备和下载分别由资源 owner 管理，不统一替换成 AgentLoop 取消。\n\n先输出映射表、所有同类入口、缺口、拟修改文件及需要的 profile 装配；多包/API/新依赖方案经 Yorker 批准后实施，明确“直接做/继续”时按授权范围执行。无 backend 的产品控件显示 disabled/unavailable，Mock 仅限测试。\n\n## CLH 二开隔离\n\n二开命令、环境与用户根目录使用 \`clh\`、\`CLH_*\`/\`CLH_HOME\`、\`~/.clh\`，按 [CLH 隔离规则](../提示词使用规则.md#clh-isolation) 列出本功能标识映射、所有同类读写/安装/清理入口和兼容策略；无关项注明不适用。官方源码路径、依赖名和协议字段按实际保留，不做全局字符串替换。\n\n交付本功能的官方 DSH 与 CLH 并存验收收据，禁止占用官方命令或隐式共用数据；历史导入须显式批准。区分规则目标、当前实现与未整改缺口，文档更新不能代替产品隔离实现。\n\n## 行为与 UI 验收\n\n重点测试：${feature.tests}\n\n选择拥有该行为的现有测试文件运行定向检查，记录实际命令/结果。字段或跨层 API 变更扫描所有消费者；新/重构业务模块按项目 MODULE-DELIVERY-GATE，Session/SDK/模型可见输入按仓库持久化与 snapshot 规则处理。UI 验收逐项执行本目录检查表，测试不能替代截图，截图不能替代真实 backend 收据。\n\n## 交付输出\n\n交付源码映射、配置/API 字段表、最小实现路径、实际装配证据、已运行测试结果、截图/操作收据、未验证项和剩余差异。保持 \`一致/部分实现/仅有底层能力/缺失/设计不同/待运行验收\` 分类，不把源码存在报成完成。\n`)
}

const languageRows = {
  en: ['# Orca Migration Reference', 'English | [中文](README.zh.md)', '## Summary', 'This reference compares the pinned latest upstream source with the current dirty Harness checkout. It contains 43 feature dossiers, each with a comparison, UI checklist, and execution prompt. It does not change either product or claim runtime or visual parity. The fork uses CLH product identity; follow the [CLH isolation rules](提示词使用规则.md#clh-isolation) without replacing real upstream source or dependency names.', '## Contents', '- [Baseline and progress](项目进度与差异总览.md)\n- [Prompt rules](提示词使用规则.md)\n- [Feature catalog](#feature-catalog)', '## Feature Catalog', '| Directory | Feature | Source Assessment | Priority |', '## Evidence', 'The baseline, source hashes, and original prompt hashes are in [baseline.json](../exports/baseline.json). The reproducible slice is in [upstream-paths.txt](../exports/upstream-paths.txt). Samples are ignored, not product code. A partial clone also exists; neither it nor the source slice was built or launched.', '## Validation', 'See the [progress report](项目进度与差异总览.md) for commands and limitations. Use the shared prompt rules before executing a feature prompt. No screenshots, hardware tests, or full product suite were run in this documentation task.'],
  zh: ['# Orca 迁移参考', '[English](README.md) | 中文', '## 摘要', '本参考对比已固定的最新上游源码与当前含未提交修改的 Harness，共 43 个功能档案；每个包含差异分析、UI 检查表和实施提示词。本次不修改双方产品代码，也不宣称运行或视觉等价。二开产品身份使用 CLH，遵循 [CLH 隔离规则](提示词使用规则.md#clh-isolation)，保留真实上游源码与依赖名称。', '## 目录', '- [基线与项目进度](项目进度与差异总览.md)\n- [提示词使用规则](提示词使用规则.md)\n- [功能目录](#功能目录)', '## 功能目录', '| 目录 | 功能 | 源码级判断 | 优先级 |', '## 证据', '固定基线、源码 hash 与原始提示词 hash 见 [baseline.json](../exports/baseline.json)，可复现样本列表见 [upstream-paths.txt](../exports/upstream-paths.txt)。样本被 Git 忽略，不是产品代码；本地还有 partial clone，但均未构建或启动。', '## 验证', '实际命令和限制见 [进度报告](项目进度与差异总览.md)。执行功能提示词前先读共用规则。本次文档任务未进行截图、硬件测试或产品全套测试。'],
}
for (const [language, parts] of Object.entries(languageRows)) {
  parts[3] = parts[3].replace('43', String(features.length))
  const rows = features.map(f => `| [${f.id}](${f.id}/差异分析.md) | ${f.title} | \`${f.status}\` | ${f.priority} |`).join('\n')
  outputs.set(resolve(docs, language === 'en' ? 'README.md' : 'README.zh.md'), `${parts[0]}\n\n${parts[1]}\n\n${parts[2]}\n\n${parts[3]}\n\n${parts[4]}\n\n${parts[5]}\n\n<a id="feature-catalog"></a>\n\n${parts[6]}\n\n${parts[7]}\n|---|---|---|---|\n${rows}\n\n${parts[8]}\n\n${parts[9]}\n\n${parts[10]}\n\n${parts[11]}\n`.replace('](#功能目录)', '](#feature-catalog)'))
}

function filesBelow(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name
    return entry.isDirectory() ? filesBelow(resolve(directory, entry.name), path + '/') : [path]
  })
}
const upstreamPaths = filesBelow(samples).sort()
outputs.set(resolve(root, 'exports/upstream-paths.txt'), upstreamPaths.join('\n') + '\n')
const harnessPaths = [...new Set([...features.flatMap(f => f.harness), 'packages/bundle/web-app/cordis.patch.yml', 'packages/settings/settings/src/index.ts'])].sort()
const baseline = {
  capturedDate: '2026-10-10',
  evidenceKind: 'source-and-profile-only',
  upstream: { repository: 'https://github.com/stablyai/orca', branch: 'main', commit, version: JSON.parse(readFileSync(resolve(samples, 'package.json'), 'utf8')).version, commitDate: '2026-10-09T19:53:58-07:00', refVerification: 'git ls-remote succeeded during initial collection; final retry failed through local proxy; no later upstream changes are claimed' },
  harness: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), version: JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')).version, worktree: 'dirty; source hashes, not HEAD alone, define this comparison', files: harnessPaths.map(path => ({ path, sha256: sha256(readFileSync(resolve(repo, path))) })) },
  featureCount: features.length,
  originalPrompts: originalPrompts.map(path => ({ path, sha256: sha256(readFileSync(resolve(root, path))) })),
  downloadedReferences: upstreamPaths.map(path => ({ path, sha256: sha256(readFileSync(resolve(samples, path))) })),
  notRun: ['Orca build/start', 'Harness build/start', 'feature behavior tests', 'screenshots', 'hardware tests'],
}
outputs.set(resolve(root, 'exports/baseline.json'), JSON.stringify(baseline, null, 2) + '\n')

let different = 0
for (const [path, content] of outputs) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) continue
  if (check) { console.error(`stale: ${slash(relative(repo, path))}`); different++; continue }
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
console.log(`migration docs: ${features.length} features, ${outputs.size} outputs${check ? `, ${different} stale` : ''}`)
if (different) process.exitCode = 1
