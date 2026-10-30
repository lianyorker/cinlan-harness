# 浜у嚭鐗?
[English](deliverables.md) | 涓枃

璁板綍涓€杞氦缁欑敤鎴风殑涓滆タ锛岀敱 [deliverables 鍖呯粍](../../packages/deliverables/README.zh.md)鎷ユ湁锛氭ā鍨嬮€氳繃 `present` 宸ュ叿澹版槑鐨勬枃浠讹紝璁板湪涓€涓彧鍐欐棩蹇楃殑 Session 浜嬩欢閲岋紱杩欎竴杞敼鍔ㄧ殑鏂囦欢锛岀敱杞紑濮嬪拰杞粨鏉熸椂鐨?git 宸ヤ綔鏍戝揩鐓у姣斿緱鍑猴紝git 瑕嗙洊涓嶅埌鐨勮矾寰勫垯鐢辨枃浠跺伐鍏锋瘡娆＄紪杈戝墠鍚庣殑鏁存枃浠舵崟鑾峰緱鍑猴紝鐢ㄤ竴涓彧鍐欐棩蹇楃殑浜嬩欢瀹ｅ憡锛屽苟鍦?Session 瀛樻椿鏈熼棿鐢?Host 鏈嶅姟杩炲悓姣忎釜鎵€鍒楁枃浠跺湪杞紑濮嬩笌杞粨鏉熸椂鐨勫姣斾竴璧锋彁渚涖€傚畠浠彧鐢卞鎴风璇诲彇锛學eb [浜у嚭鐗╂彃浠禲(../../packages/client/ui-deliverables/README.zh.md)鍦ㄨ疆鏈覆鏌撲袱鑰呫€傚伐鍏疯涓恒€佸揩鐓ф満鍒跺拰閰嶇疆瑙?[`tool-present`](../../packages/deliverables/tool-present/README.zh.md) 涓?[`workspace-changes`](../../packages/deliverables/workspace-changes/README.zh.md) 鐨勫寘 README銆?
婧愮爜锛歔`packages/deliverables/tool-present/src/types.ts`](../../packages/deliverables/tool-present/src/types.ts)銆乕`packages/deliverables/workspace-changes/src/types.ts`](../../packages/deliverables/workspace-changes/src/types.ts)

琛ヤ竵璋冪敤浣跨敤鐩稿悓鐨勬憳瑕佷笌瀵规瘮 API銆傚浜?Git 瑕嗙洊涔嬪鐨勮矾寰勶紝绉诲姩褰㈡垚婧愬垹闄や笌鐩爣鏂板锛涘仠姝㈢殑鎻愪氦鍙础鐚疄闄呮枃浠跺噣鍙樺寲銆俒閲囬泦瑙勫垯](../../packages/deliverables/workspace-changes/README.zh.md#use-this-package)瀹氫箟璺緞閫夋嫨涓庤瀵熻涓恒€?
## `PresentedFile`锛氫竴鏉″０鏄庣殑浜や粯

```ts type-equiv
/** A declared filesystem file whose current contents remain at its source path. */
interface PresentedFile {
  /** Original absolute path or path relative to the Session working directory. */
  path: string
  /** Optional description supplied by the model. */
  description?: string
}
```

## `WorkspaceChangedFile`锛氫竴涓敼鍔ㄧ殑鏂囦欢

```ts type-equiv
/** One file changed during a turn, with line counts from git or from the whole-file captures around its file-tool edits. */
interface WorkspaceChangedFile {
  /** Path relative to the Session working directory, or an absolute Host path outside it. */
  path: string
  /**
   * Sort key and label: the relative path inside the working directory, a
   * `../` path for repository files above it, a `~` path under the home
   * directory, otherwise the absolute path. Always slash-separated.
   */
  display: string
  /** Lines added; zero for a binary or oversized file. */
  added: number
  /** Lines deleted; zero for a binary or oversized file. */
  deleted: number
  /** Present when git reported the file as binary, or when a captured side holds a NUL byte. */
  binary?: true
  /** Present when a captured side exceeded the plugin's `maxFileBytes`; the file is listed without counts or comparison. */
  oversized?: true
}
```

## `WorkspaceChangesSummary`锛氫竴杞殑鏀瑰姩鎽樿

```ts type-equiv
/** Files changed during one top-level turn, kept on the Host until its Session is disposed. */
interface WorkspaceChangesSummary {
  /** The turn whose file changes this summary describes. */
  turn: number
  /** The Session working directory `path` values are relative to. */
  cwd: string
  /** Changed files in `display` order, capped at the plugin's `maxFiles`. */
  files: WorkspaceChangedFile[]
  /** Complete changed-file count, including files omitted by the cap. */
  total: number
  /** Lines added over every changed file, including files omitted by the cap. */
  added: number
  /** Lines deleted over every changed file, including files omitted by the cap. */
  deleted: number
  /** Git tree ids of the turn-start and turn-end snapshots; absent when no snapshot was taken. */
  snapshot?: { before: string; after: string }
}
```

## `WorkspaceDiffHunk`锛氫竴涓?unified diff hunk

```ts type-equiv
/** One unified-diff hunk with three context lines; every line keeps its `+`, `-`, or space prefix. */
interface WorkspaceDiffHunk {
  /** First line of the hunk in the turn-start content, 1-based; a side without lines starts at 1 with zero lines. */
  oldStart: number
  /** Lines of the hunk taken from the turn-start content. */
  oldLines: number
  /** First line of the hunk in the turn-end content, 1-based; a side without lines starts at 1 with zero lines. */
  newStart: number
  /** Lines of the hunk taken from the turn-end content. */
  newLines: number
  /** Hunk body in order, each line prefixed with `+`, `-`, or a space. */
  lines: string[]
}
```

## `WorkspaceFileDiff`锛氫竴涓枃浠剁殑瀵规瘮

```ts type-equiv
/** The comparison of one listed file's turn-start and turn-end contents, computed when asked for. */
type WorkspaceFileDiff =
  | {
    kind: 'text'
    /** The listed file's `path`. */
    path: string
    /** The listed file's `display`. */
    display: string
    /** Whether the file existed at turn start. */
    before: boolean
    /** Whether the file existed at turn end. */
    after: boolean
    /** Hunks in file order; empty when both sides hold the same lines. */
    hunks: WorkspaceDiffHunk[]
    /** True when the line comparison exceeded the plugin's `diffTimeoutMs` and every line is shown as replaced. */
    coarse: boolean
  }
  /** A side git reported as binary or that holds a NUL byte; no lines are served. */
  | { kind: 'binary'; path: string; display: string }
  /** A side larger than the plugin's `maxFileBytes`; no lines are served. */
  | { kind: 'oversized'; path: string; display: string }
```

## `WorkspaceChanges`锛氭彁渚涙憳瑕佷笌瀵规瘮鐨?Host 鏈嶅姟

```ts type-equiv
/** Serves the summaries and file comparisons the recorder keeps for live Sessions. */
interface WorkspaceChanges {
  /**
   * The summary announced by one `workspace/changes` event.
   * @param sessionId - the Session that appended the event.
   * @param seq - the event's sequence number.
   * @returns the summary, or undefined once its Session was disposed or when this Host never recorded it.
   */
  summary(sessionId: SessionId, seq: number): WorkspaceChangesSummary | undefined
  /**
   * Compare one listed file's contents at turn start and turn end.
   * @param sessionId - the Session that appended the event.
   * @param seq - the event's sequence number.
   * @param index - the file's index in the summary's `files`.
   * @param signal - cancels the reads.
   * @returns the comparison, or undefined once its Session was disposed, when this Host never recorded it, or when no file has that index.
   * @throws when a snapshot read fails for a live Session.
   */
  diff(sessionId: SessionId, seq: number, index: number, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
}
```

## 鎸佷箙浜嬩欢涓庢彁渚涚殑鎽樿

`tool-present` 閫氳繃澹版槑鍚堝苟鎶?`deliverables/presented: { turn; callId; files: PresentedFile[] }` 鍔犲叆 `SessionEventMap`锛屾瘡娆?`present` 鐨勬渶缁堢粨鏋滄垚鍔熸椂杩藉姞涓€鏉°€俙workspace-changes` 鍚堝苟 `workspace/changes: { turn }`锛屽湪椤跺眰杞仠姝㈡椂杩藉姞锛涜浜嬩欢瀹ｅ憡鐨勬憳瑕佷笉鍦ㄦ棩蹇楅噷锛岃€屾槸鐢?`workspaceChanges.summary(sessionId, seq)` 鎸変簨浠跺簭鍙疯繑鍥烇紝鐩村埌 Session 閲婃斁锛屽洜姝?Host 閲嶅惎鍚庨噸鏂版墦寮€鐨勫璇濓紝鍏堝墠杞娌℃湁鏀瑰姩鏂囦欢鍗＄墖銆俙workspaceChanges.diff(sessionId, seq, index, signal)` 鎸夊悓鏍风殑鏉′欢瀵规瘮涓€涓墍鍒楁枃浠躲€傚悓涓€杞悗鏉ョ殑浜嬩欢鏇夸唬鍏堝墠鐨勶紝瀹㈡埛绔彧淇濈暀鏈€鏂颁竴鏉°€傜敓鎴愮殑[鎸佷箙鍖栫洰褰昡(../persistence-catalog.zh.md#deliverablespresented--log-only)璁板綍浜嗕袱澶勫０鏄庝綅缃€備袱涓簨浠堕兘涓嶄細杩涘叆妯″瀷璇锋眰銆?
<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) 鈥?do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) 鈥?the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkspacechanges--workspacechanges"></a>

### `ctx.workspaceChanges` 鈥?`WorkspaceChanges`

Serves the summaries and file comparisons the recorder keeps for live Sessions.

```ts cordis-catalog
/**
 * The summary announced by one `workspace/changes` event.
 * @param sessionId - the Session that appended the event.
 * @param seq - the event's sequence number.
 * @returns the summary, or undefined once its Session was disposed or when this Host never recorded it.
 */
summary(sessionId: SessionId, seq: number): WorkspaceChangesSummary | undefined

/**
 * Compare one listed file's contents at turn start and turn end.
 * @param sessionId - the Session that appended the event.
 * @param seq - the event's sequence number.
 * @param index - the file's index in the summary's `files`.
 * @param signal - cancels the reads.
 * @returns the comparison, or undefined once its Session was disposed, when this Host never recorded it, or when no file has that index.
 * @throws when a snapshot read fails for a live Session.
 */
diff(sessionId: SessionId, seq: number, index: number, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
```

Types: [SessionId](core.zh.md)

Source: [`packages/deliverables/workspace-changes/src/types.ts`](../../packages/deliverables/workspace-changes/src/types.ts)
<!-- END GENERATED cordis-surface -->
