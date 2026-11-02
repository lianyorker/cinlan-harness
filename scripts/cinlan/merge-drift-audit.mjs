// Merge-drift audit (read-only): reconcile fork HEAD against the upstream side
// of one merge commit, and regenerate the markdown report.
//
// Signals:
//  A) Lost upstream delta / merge artifact — `git merge-tree --write-tree
//     --merge-base=<base> <merge>^2 HEAD` recomputes base+upstream-delta+
//     HEAD-delta; `git diff HEAD <resultTree>` non-empty ⇒ HEAD differs from
//     ort output. NOTE: verified 2026-11-01 — non-conflict rows here are mostly
//     ort re-merge *duplication artifacts* where HEAD already carries the
//     upstream content (paragraph/method duplicated once); they are NOT lost
//     changes. `conflict` rows are the ones needing human review.
//  B) Fork-side revert of upstream-stable lines — removed-lines(base→^1) ∩
//     removed-lines(^2→HEAD) non-empty: fork deleted a line upstream kept, and
//     HEAD still lacks it. Merge is mechanically correct; needs keep/revert call.
//
// Risk tiers (only packages/*/*/src, **/cordis.patch.yml, **/package.json):
//  同步误删嫌疑 — pickaxe on the removed line inside base..^1 hits only
//     merge/sync-pattern commits (no feature commit): the deletion likely came
//     from an upstream-sync merge resolution rather than fork intent.
//  漂移导致编译错误嫌疑 — A-conflict file also appears in the recorded `error TS`
//     file paths from the supplied tsc logs.
//
// Usage:
//   node scripts/cinlan/merge-drift-audit.mjs <merge-commit> [report-path] [tsc-log...]
//     <merge-commit>  required; e.g. 0554f2f396
//     [report-path]   default docs/dev/合并漂移审计-<today>.md
//     [tsc-log...]    `error TS` logs used for the compile-error tier;
//                     default tmp-tsc-errors.log tmp-tsc-errors-client.log
//
// Read-only with respect to the repository: every git call is a query; the only
// write is the report markdown itself (LF).

import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const [mergeArg, reportArg, ...tscLogArgs] = process.argv.slice(2)
if (mergeArg === undefined) {
  console.error('用法: node scripts/cinlan/merge-drift-audit.mjs <merge-commit> [report-path] [tsc-log...]')
  console.error('  <merge-commit> 必填；[report-path] 默认 docs/dev/合并漂移审计-<当天日期>.md；[tsc-log...] 默认 tmp-tsc-errors.log tmp-tsc-errors-client.log')
  process.exit(1)
}
const today = new Date()
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

const MERGE = mergeArg
const REPORT = reportArg ?? `docs/dev/合并漂移审计-${ymd}.md`
const TSC_LOGS = tscLogArgs.length > 0 ? tscLogArgs : ['tmp-tsc-errors.log', 'tmp-tsc-errors-client.log']
const MUST_FIND = [
  'snapshots/sdk/text-turn/cordis.yml',
  'snapshots/sdk/text-turn/cordis.snapshot.yml',
  'snapshots/session/text-turn/cordis.yml',
  'snapshots/session/text-turn/cordis.snapshot.yml',
  'packages/test-support/agent-loop-testkit/src/index.ts',
]
const SCOPE_RE = /^(packages\/[^/]+\/[^/]+\/src\/|.*\/cordis\.patch\.yml$|.*\/package\.json$)/
const SYNC_SUBJECT_RE = /sync|merge|freeze|同步|冻结|upstream|更新|squash|对齐|inconsistency/i

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const gitTry = (args) => {
  try { return { out: git(args), code: 0 } }
  catch (err) { return { out: err.stdout ?? '', err: err.stderr ?? '', code: err.status ?? 1 } }
}

const base = git(['merge-base', `${MERGE}^1`, `${MERGE}^2`]).trim()

function treeBlobs(rev) {
  const map = new Map()
  for (const line of git(['ls-tree', '-r', '-z', rev]).split('\0')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const meta = line.slice(0, tab).split(' ')
    if (meta[1] !== 'blob') continue
    map.set(line.slice(tab + 1), meta[2])
  }
  return map
}

const [baseTree, oursTree, theirsTree, headTree] = [
  base, `${MERGE}^1`, `${MERGE}^2`, 'HEAD',
].map(treeBlobs)

function removedLines(left, right, file) {
  const out = gitTry(['diff', '-U0', '--no-renames', left, right, '--', file]).out
  const removed = new Set()
  for (const line of out.split('\n')) {
    if (line.startsWith('-') && !line.startsWith('---')) removed.add(line.slice(1))
  }
  return removed
}

// ---------- signal A ----------
const mt = gitTry(['merge-tree', '--write-tree', '--merge-base', base, `${MERGE}^2`, 'HEAD'])
const mtLines = mt.out.split('\n')
const resultTree = mtLines[0]?.trim()
if (!resultTree || !/^[0-9a-f]{40}$/.test(resultTree)) {
  console.error(`merge-tree failed: ${mt.err || mt.out.slice(0, 500)}`)
  process.exit(1)
}
const conflicted = new Set()
for (const line of mtLines.slice(1)) {
  const tab = line.indexOf('\t')
  if (tab === -1) continue
  const meta = line.slice(0, tab).split(' ')
  if (meta.length === 3 && meta[0] === '100644') conflicted.add(line.slice(tab + 1))
}
const missingDelta = git(['diff', '--name-only', 'HEAD', resultTree])
  .split('\n').filter(line => line !== '')

const candidates = new Set(
  git(['diff', '--name-only', '--no-renames', `${MERGE}^2`, 'HEAD']).split('\n').filter(line => line !== ''),
)
const dirty = new Set()
for (const line of git(['status', '--porcelain', '-z']).split('\0')) {
  if (line === '') continue
  const path = line.slice(3)
  if (path !== '') dirty.add(path)
}

// ---------- signal B ----------
const forkModified = new Set(
  git(['diff', '--name-only', '--no-renames', base, `${MERGE}^1`]).split('\n').filter(line => line !== ''),
)
const bucketA = []
const bucketB = []
const missingSet = new Set(missingDelta)
for (const file of missingDelta) {
  const b = baseTree.get(file)
  const o = oursTree.get(file)
  const t = theirsTree.get(file)
  const h = headTree.get(file)
  bucketA.push({
    file,
    verbatim: b !== undefined && o === b && t !== b && h === o,
    conflict: conflicted.has(file),
    dirty: dirty.has(file),
  })
}
const bIntersections = new Map() // file -> intersecting removed lines (fork-side reverts still in HEAD)
for (const file of candidates) {
  if (missingSet.has(file) || !forkModified.has(file)) continue
  if (theirsTree.get(file) === undefined || headTree.get(file) === undefined) continue
  const forkRemoved = removedLines(base, `${MERGE}^1`, file)
  if (forkRemoved.size === 0) continue
  const headRemoved = removedLines(`${MERGE}^2`, 'HEAD', file)
  const inter = [...forkRemoved].filter(line => headRemoved.has(line))
  if (inter.length > 0) {
    bucketB.push({ file, dirty: dirty.has(file) })
    bIntersections.set(file, inter)
  }
}

// ---------- B∩snapshots：工作区仍缺的上游行 ----------
const snapshotsAnalysis = []
for (const row of bucketB) {
  if (!row.file.startsWith('snapshots/')) continue
  if (!existsSync(row.file)) continue
  const worktree = readFileSync(row.file, 'utf8')
  const inter = bIntersections.get(row.file) ?? []
  const stillMissing = inter.filter(line => line.trim() !== '' && !worktree.includes(line.trim()))
  const cordisLike = stillMissing.filter(line => /dsh-|- id:|name:|config:|inject:|disabled:|enabled:/u.test(line))
  snapshotsAnalysis.push({ file: row.file, stillMissing, cordisLike })
}

// ---------- risk tiers ----------
const inScope = file => SCOPE_RE.test(file)

// tsc error files (format: path(line,col): error TS…)
const tscFiles = new Set()
for (const log of TSC_LOGS) {
  if (!existsSync(log)) continue
  for (const line of readFileSync(log, 'utf8').split('\n')) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error TS/u)
    if (m !== null) tscFiles.add(m[1].replaceAll('\\', '/'))
  }
}

// pickaxe: which base..^1 commits removed the intersecting line
function pickaxeCommits(file, line) {
  if (line === undefined || line.trim().length < 4) return []
  const probe = line.trim()
  const out = gitTry(['log', `--format=%H`, '-S', probe, `${base}..${MERGE}^1`, '--', file]).out
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}
function commitInfo(sha) {
  const out = gitTry(['show', '-s', '--format=%P%x09%s', sha]).out.trim()
  const [parents = '', subject = ''] = out.split('\t')
  return { merge: parents.trim().split(/\s+/).filter(Boolean).length > 1, subject, sha }
}
const syncSuspects = []
const bScopedOther = []
for (const row of bucketB) {
  if (!inScope(row.file)) continue
  const inter = bIntersections.get(row.file) ?? []
  // use the longest intersecting line as the pickaxe probe (best precision)
  const probe = inter.filter(l => l.trim().length >= 4).sort((a, b) => b.length - a.length)[0]
  const hits = pickaxeCommits(row.file, probe).map(commitInfo)
  const sync = hits.filter(c => c.merge || SYNC_SUBJECT_RE.test(c.subject))
  const feature = hits.filter(c => !(c.merge || SYNC_SUBJECT_RE.test(c.subject)))
  if (hits.length > 0 && sync.length > 0 && feature.length === 0) {
    syncSuspects.push({ ...row, probe, hits })
  } else {
    bScopedOther.push({ ...row, probe, hits })
  }
}
const aConflictScoped = bucketA.filter(row => row.conflict && inScope(row.file))
const tscSuspects = aConflictScoped.filter(row => tscFiles.has(row.file))

function diffStat(file) {
  const out = gitTry(['diff', '--numstat', `${MERGE}^2`, 'HEAD', '--', file]).out.trim()
  const [add = '?', del = '?'] = out.split('\t')
  return `+${add}/-${del} vs ^2`
}

const ranked = [
  ...syncSuspects.map(r => ({ ...r, tier: '同步误删嫌疑', suggest: '恢复上游' })),
  ...tscSuspects.map(r => ({ ...r, tier: '漂移导致编译错误嫌疑', suggest: '恢复上游或手工合并' })),
  ...bScopedOther.map(r => ({ ...r, tier: 'B·fork 侧删改', suggest: '手工合并（逐 hunk 定夺）' })),
  ...aConflictScoped.filter(r => !tscFiles.has(r.file)).map(r => ({ ...r, tier: 'A·混合决议', suggest: '手工合并（复核决议）' })),
].slice(0, 30)

// ---------- report ----------
const groupBy = (rows) => {
  const groups = new Map()
  for (const row of rows) {
    const dir = dirname(row.file).replaceAll('\\', '/')
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push(row)
  }
  return groups
}
const dirtyAll = [...bucketA, ...bucketB].filter(row => row.dirty)
const mustFind = MUST_FIND.map(file => ({
  file,
  found: bucketA.some(row => row.file === file) || bucketB.some(row => row.file === file),
}))
const allFound = mustFind.every(row => row.found)

const lines = []
lines.push(`# 合并漂移审计（${ymd}）`)
lines.push('')
lines.push(`> 合并提交：\`${MERGE}\`；公共祖先：\`${base}\`；merge-tree 结果树：\`${resultTree}\``)
lines.push('> 双信号判定：')
lines.push('> - **A 上游 delta 未进 HEAD / 合并产物**：merge-tree 重算结果≠HEAD。⚠️ 复核发现：非冲突行多为 **ort 重算重复产物**（HEAD 已有上游内容，ort 在另一锚点又插一遍），不是缺失；`conflict` 才是真需复核的混合决议。')
lines.push('> - **B fork 侧过期 revert**：`diff(base,^1)` 删除行 ∩ `diff(^2,HEAD)` 删除行 非空 = fork 删改了上游稳定行且 HEAD 保留该 revert。合并无错，需人工定夺留 fork / 回上游。')
lines.push(`> 结果：**A ${bucketA.length} 个 + B ${bucketB.length} 个**；${dirtyAll.length} 个有工作区未提交改动（不恢复）。`)
lines.push('>')
lines.push('> **2026-11-01 已执行修复（本报告为修复后基线）**：B∩snapshots 的 cordis 缺行已按上游恢复——`session-log-deepseek`（6 文件）、`plugin-package-inventory-deepseek`（5 文件）、`literal-sdk`（5 文件）、`cordis-inspect-providers`（2 文件）、`summary-image-budget.mjs`（2 文件）、`deepseek-messages`/`deepseek-flash` 条目、ptc-* `disabled` 段、`fs-same-mode` 用例、`office-skills` `node`/`cli`、多个 `snapshot.yml` 头部标量与 `model`/`contextWindow`/`expectedTools` 标量值。仍缺：3 个 `session.v*.jsonl` 录制 fixture（不在本机重录）、`resolve-spill-command.mjs`（API 分叉待人工）、6 个文件仅存注释差异。见文末「B∩snapshots 专项」。')
lines.push('')
if (!allFound) {
  lines.push('> ⚠️ 已知例子未全部命中：')
  for (const row of mustFind.filter(row => !row.found)) lines.push(`> - ${row.file}`)
  lines.push('')
}
const emit = (title, rows, note) => {
  if (rows.length === 0) return
  lines.push(`## ${title}（${rows.length}）`)
  lines.push('')
  if (note !== undefined) lines.push(note, '')
  const groups = groupBy(rows)
  for (const dir of [...groups.keys()].sort()) {
    lines.push(`### ${dir}`)
    lines.push('')
    for (const row of groups.get(dir).sort((a, b) => a.file.localeCompare(b.file))) {
      const marks = [
        row.verbatim ? '`verbatim`' : undefined,
        row.conflict ? '`conflict`' : undefined,
        row.dirty ? '**（在途改动）**' : undefined,
      ].filter(Boolean)
      lines.push(`- \`${row.file}\`${marks.length > 0 ? ' ' + marks.join(' ') : ''}`)
    }
    lines.push('')
  }
}
emit('A. 上游 delta 未进 HEAD / 合并产物', bucketA,
  '> `conflict` = 同区域冲突被混合决议，需人工复核。非冲突行经抽验多为 ort 重复产物（HEAD 已含上游内容，如 publish.md 段落、warnIgnoredKeys 方法——恢复其"结果树版本"反而引入重复，已回退）。')
emit('B. fork 侧过期 revert（上游行被 fork 删改且 HEAD 保留）', bucketB,
  '> 合并无错，但 fork 的删改可能已过期。逐个人工决定：留 fork / 回上游。')

// ---------- B∩snapshots 专项 ----------
lines.push('## B∩snapshots 专项：工作区仍缺的上游行')
lines.push('')
lines.push('> 旧包名 `@deepseek-ai/dsh-llm-deepseek` 在工作区已全部改回 `-api-key`（仅剩 `dsh-llm-deepseek-account`，是另一个包不动）。')
lines.push('> 下表为 fork 删除、HEAD 缺、**工作区也仍缺** 的 cordis 行（`session.v3.jsonl` 等 fixture 行不在此列，fixture 属录制产物）。')
lines.push('')
let anyMissing = false
for (const row of snapshotsAnalysis) {
  if (row.cordisLike.length === 0 && row.stillMissing.length === 0) continue
  if (row.cordisLike.length === 0) continue // non-cordis missing lines only → skip listing
  anyMissing = true
  lines.push(`### ${row.file}`)
  for (const line of row.cordisLike.slice(0, 15)) lines.push(`- \`${line.trim()}\``)
  lines.push('')
}
if (!anyMissing) lines.push('（无：所有 cordis 配置行已在工作区恢复）', '')

// ---------- 风险分级 ----------
lines.push('## 风险分级（范围：packages/*/*/src、**/cordis.patch.yml、**/package.json）')
lines.push('')
lines.push(`> 同步误删嫌疑：pickaxe 溯源删改只命中合并/同步类提交，无功能提交 → ${syncSuspects.length} 个`)
lines.push(`> 漂移导致编译错误嫌疑：A-conflict ∩ tsc 错误文件（${tscFiles.size} 个错误文件，${TSC_LOGS.join(' ')}）→ ${tscSuspects.length} 个`)
lines.push(`> B 桶范围内其余：${bScopedOther.length} 个；A-conflict 范围内其余：${aConflictScoped.length - tscSuspects.length} 个`)
lines.push('')
lines.push(`### Top ${ranked.length} 风险文件`)
lines.push('')
lines.push('| 文件 | 风险 | diff | 建议 |')
lines.push('| --- | --- | --- | --- |')
for (const row of ranked) {
  lines.push(`| \`${row.file}\` | ${row.tier}${row.dirty ? '（在途）' : ''} | ${diffStat(row.file)} | ${row.suggest} |`)
}
lines.push('')
if (syncSuspects.length > 0) {
  lines.push('#### 同步误删嫌疑明细（pickaxe 命中的提交）')
  lines.push('')
  for (const row of syncSuspects) {
    lines.push(`- \`${row.file}\` — 探测行 \`${(row.probe ?? '').trim().slice(0, 80)}\``)
    for (const hit of row.hits) lines.push(`  - \`${hit.sha.slice(0, 10)}\` ${hit.merge ? '[merge]' : ''} ${hit.subject.slice(0, 80)}`)
  }
  lines.push('')
}
if (dirtyAll.length > 0) {
  lines.push(`## 有在途改动的文件（不恢复，仅列出，${dirtyAll.length}）`)
  lines.push('')
  for (const row of dirtyAll.sort((a, b) => a.file.localeCompare(b.file))) lines.push(`- \`${row.file}\``)
  lines.push('')
}
// ---------- Top 30 逐案复核（2026-11-01 会话结论，随报告固化） ----------
lines.push('## Top 30 逐案复核结果（2026-11-01）')
lines.push('')
lines.push('> 复核口径：逐文件看 `^2→HEAD` diff 与 B 桶交集行，判定上游行是真丢还是已被 fork 有意吸收。')
lines.push('> 「同步误删嫌疑」的 pickaxe 命中合并/同步提交，无法区分"合并不慎丢行"与"在同步合并内做 clh 边界/品牌/结构改写"——本次复核证实绝大多数属后者。')
lines.push('')
lines.push('### 真丢失清单')
lines.push('')
lines.push('- 本轮逐项比对后判定：**Top 30 中除在途 6 个外无真丢失**。早前曾将以下两文件恢复为上游写法，经 `^1` 对照确认为误判并已回退（2026-11-02）。')
lines.push('')
lines.push('### `^1` 既有 fork 差异（曾被误判为漂移，恢复已回退，2 个）')
lines.push('')
lines.push('- `packages/api/terminal-controller/src/terminal.ts`：`loadAddon(this.serializer as never)` 在 `^1` 已存在——解决同一文件同时被 host（`@xterm/headless`）与 client（`@xterm/xterm`）两套 Terminal 类型编译的双面兼容；恢复上游写法会让 host compiler 门失败，`dev:web` 起不来。')
lines.push('- `packages/api/gateway/src/client/stream-client.ts`：上游的 `oxlint-disable-next-line typescript/prefer-promise-reject-errors` pragma 在 `^1` 已被移除——我们 oxlint 对该 `reject(error)` 不报问题，恢复只会产生 unused directive 警告。')
lines.push('')
lines.push('### 保留 fork（上游行已被 fork 有意吸收，22 个；加 `^1` 差异 2 个 + 在途 6 个 = 30 对账）')
lines.push('')
lines.push('- **clh/dsh 边界（5 组）**：`ui-settings-account/{DesktopOnboardingEntry,onboarding-credentials}`（`clhOnboarding ?? dshOnboarding` 双查）、`shell/shell-env/src/index.ts`、`shell/shell/src/{index,types}.ts`、`subprocess/subprocess/src/{index,types}.ts`（`CLH_ENV_PREFIX` 并存 `DSH_ENV_PREFIX`）。')
lines.push('- **品牌/文案（4 个）**：`ui-brand-official/Brand.tsx`（Cinlan mark）、`ui-primitives/BrandWordmark.tsx`（fork 自绘 SVG）、`ui-sidebar-documentpreview/office/locales.ts`（DeepSeek→Cinlan）、`ui-settings-plugins/locales.ts`（页面改名 Runtime diagnostics）。')
lines.push('- **fork 结构性改写（8 个）**：`ui-settings-general/{shell-contract,DesktopUpdateIndicator}`（本地 contract/badge 解耦）、`ui-settings-shell/ShellCard.tsx`（settings.section 双 surface）、`ui-shortcuts/{Editor,Reference}.tsx`（KeyboardService + settings-section 重写）、`test-support/client-runtime/remote-proxies.ts`（default 导出兼容）、`experimental/client-ui-agent-team/mount.ts`（Remote mount 重写；其 `ctx.sessions` 报错属上游既有的 SessionStore/ISessions 合并冲突，非漂移）。')
lines.push('- **其余（5 个）**：`settings/settings/src/index.ts`（`.clh→.dsh` 旧路径回退）、`ui-skill/package.json`（上游依赖行仍在，fork 追加了 `dsh-client-ui-settings`）、`native/system/packages/darwin-{arm64,x64}/package.json`（仓库 URL 指向 fork org）、`experimental/client-ui-agent-team/mount.ts` 同上。')
lines.push('')
lines.push('### 在途改动未处理（6 个，等对应会话提交后重新审计）')
lines.push('')
lines.push('- `packages/client/ui-chat/src/client/conversation-nodes/process-groups.ts`')
lines.push('- `packages/client/ui-open-in-app/src/client/index.ts`')
lines.push('- `packages/client/ui-settings-general/src/client/{SettingsRoot,locales}.ts`')
lines.push('- `packages/client/ui-settings-shell/src/client/locales.ts`')
lines.push('- `packages/client/ui-shortcuts/src/client/locales.ts`')
lines.push('')
lines.push('## 生成方法')
lines.push('')
lines.push('```powershell')
lines.push(`node scripts/cinlan/merge-drift-audit.mjs ${MERGE} ${REPORT} ${TSC_LOGS.join(' ')}`)
lines.push('```')
lines.push('')
lines.push('- 合并提交为第一个命令行参数（必填，缺省报错并打印用法）。')
lines.push('- 报告路径默认 `docs/dev/合并漂移审计-<当天日期>.md`，本报告由第二个参数显式指定。')
lines.push('- tsc 错误日志从第三个参数起，供「漂移导致编译错误嫌疑」交集使用；默认 `tmp-tsc-errors.log tmp-tsc-errors-client.log`。')
lines.push('- 脚本只读：全部 git 调用均为查询，唯一写出是本报告（LF）。')
lines.push('')
lines.push('## 校验')
lines.push('')
for (const row of mustFind) lines.push(`- ${row.found ? '✅' : '❌'} \`${row.file}\``)
lines.push('')

writeFileSync(REPORT, lines.join('\n').replace(/[^\S\r\n]+(?=\r?\n)/g, ''), { encoding: 'utf8' })
console.log(`A=${bucketA.length} B=${bucketB.length} dirty=${dirtyAll.length} must-find=${mustFind.filter(r => r.found).length}/${mustFind.length}`)
console.log(`snapshots-missing=${snapshotsAnalysis.filter(r => r.cordisLike.length > 0).length} sync-suspects=${syncSuspects.length} tsc-suspects=${tscSuspects.length} ranked=${ranked.length} tsc-files=${tscFiles.size}`)
