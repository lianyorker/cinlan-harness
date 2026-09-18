# Copy & Editorial Voice — Cinlan Design

Copy guidance for web artifacts. Copy first clarifies what the interface is *for*, then establishes how it should *feel*. Don't use one voice system for every surface — and never invent product behavior (features, limits, prices, recovery actions) to support a better-sounding sentence.

Before writing, define: **artifact type** (illustration/tool/dashboard/editorial/onboarding/utility state), **primary user action** (look/understand/make/decide/monitor/recover), **emotional temperature**, **information density**, **language priority** (EN-first/ZH-first/bilingual).

> The more consequential the user's action, the less decorative the copy. An illustration can be mysterious; its payment error cannot.

## 1. Voice by artifact type

| Artifact | Voice rules | Exact examples |
|---|---|---|
| Playful illustration / interactive artwork | Concrete, sensory, lightly surprising; one metaphor allowed in a headline/caption; familiar verbs for controls; no jokes in validation/permissions/payment/destructive actions; no CTA if there's no action | Title `Color Study No. 01`; caption `Ink, paper, and a little rain.`; action `New study`; error `The image couldn't be generated. Try again.` |
| Tool / editor / operational app | Quiet, direct, task-specific; name the object and action; sentence case, present tense, ordinary contractions; omit greetings/promotional intros/obvious-element explanations | Page `Project settings`; field `Project name`; action `Save changes`; status `Saved`; conflict `A newer version of this project exists.` |
| Dashboard / analytics / monitoring | Neutral, evidence-led; state measure+unit+period+comparison basis; distinguish unavailable/stale/zero | Heading `Revenue`; value `USD 24,680`; comparison `12% higher than May 2026`; timestamp `Updated Jun 7, 2026, 14:05 UTC`; missing `Not available` |
| Marketing / product / venue / portfolio | Specific, confident, verifiable; H1 = the actual product/brand/person/place/literal offer; explicit commercial actions; never insert a marketing hero into a working application | H1 `Gridline`; supporting `Project planning for small teams.`; CTA `View plans` — never replace either with `Make work extraordinary` |

## 2. Copy hierarchy

One H1 per view, H2 for sections, H3 for subordinate panels. Length ranges are drafting targets, not license for filler or truncation — count EN by words, ZH by visible characters (punctuation included, spaces excluded). Preserve official names, qualifications, and complete translations even past the target.

| Role | Length | Examples |
|---|---|---|
| Eyebrow | EN 1–3 words, ZH 2–8 chars; genuinely new context (category/series/date); omit if it repeats the heading | `FIELD NOTES` above `Materials that last`; `产品更新` above `Gridline 2.0` — never pair `PROJECT SETTINGS` with `Project settings` |
| Genuine hero H1 | EN 1–6 words, ZH 2–12 chars (except official names); name the subject/offer, no terminal period unless the name has one | `Gridline`; `Custom notebooks`; `定制笔记本`; `Maya Chen` |
| Operational page H1 | EN 1–5 words, ZH 2–10 chars; identify the destination/task, no slogan | `Project settings` / `项目设置`; `Create project` / `创建项目` |
| Section / panel heading | Section EN 1–6/ZH 2–12; panel EN 1–4/ZH 2–8; stable noun phrases, action phrase only if the section itself is a task | Section `Recent activity` / `最近动态`; task `Choose a payment method` / `选择付款方式` |
| Supporting copy / body | One sentence EN 8–24 words / ZH 12–40 chars; body 1–3 sentences, ≤24 EN words or 40 ZH chars/sentence; prose in tools only for a necessary condition/consequence | `Changing the workspace currency affects new invoices only.` / `更改工作区币种仅影响新建发票。` |
| Caption / alt text | Caption EN 3–12 words / ZH 6–24 chars; alt text has no cap — convey purpose, don't repeat nearby text; decorative → `alt=""` | `A5 notebook, dot-grid interior.`; complex charts also need a data-table equivalent |

## 3. Interface copy (exact strings by case)

| Case | Exact strings | Rule |
|---|---|---|
| Primary/secondary/bulk commands | `New project` (open) / `Create project` (commit) / `Save changes` / `Cancel` / `Select all` / `Delete 3 projects` | EN 1–4 words, ZH 2–8 chars (exceptions for necessary objects/prices/counts); distinguish opening a workflow from committing it; use real selection counts |
| Navigation / icon controls | `Undo`, `Redo`, `Download report`, `Previous page`, `Next page`, `Show password`/`Hide password` | Navigation names destinations; commands name actions; tooltips appear on keyboard focus too |
| Modes/options/values | Tabs `Overview`/`Activity`; toggle `Email notifications`; menu `Sort by` → `Name (A to Z)`, `Recently updated`; swatch `Blue, #2563EB` | Tabs for views, segmented controls for modes, toggles for binary settings, menus for option sets |
| Fields/placeholders | Label `Work email`; placeholder `name@example.com`; `Project name (required)`; `Company (optional)`; `Up to 80 characters.` | Labels stay visible after typing; placeholders show examples, not requirements; never put a critical condition only in a tooltip |
| Validation | `Enter a project name.`; `Enter an email address in the format name@example.com.`; `Use 80 characters or fewer.`; `The file exceeds the 20 MB limit.`; `Choose a PDF or PNG file.` | Identify field + correction; preserve entered values; link via `aria-describedby`/`aria-invalid` |
| Loading/progress | `Loading projects`; `Saving`; `Export queued`; `3 of 8 files uploaded`; `Cancel export` | Name the operation; show counts only when known; never fabricate a percentage; a changing label mustn't resize the button |
| Success/partial success | `Saved`; `Export ready` + `Download CSV`; `6 files uploaded. 2 failed.` + `Retry 2 files` | One acknowledgment, not duplicated inline+toast; partial success retains successes and identifies the failed subset |
| Empty states | First use `No projects yet` + `New project`; completed `All reviews complete`; search `No results for "budget"` + `Clear search`; filters `No projects match these filters` + `Clear filters` | Preserve query/filters until changed; clearing search must not silently clear unrelated filters |
| Dashboard zero/missing | `No revenue data for June 2026`; verified zero `USD 0.00`; unavailable `Not available`; `Revenue source not connected` + `Connect source` | Four distinct conditions — never substitute zero for missing, or a connect-CTA during an outage |
| Offline/failure | `You're offline.` + `Retry connection`; `Projects couldn't be loaded.` + `Retry`; `Changes weren't saved. Try again.` + `Retry` | Claim failure only when known; preserve content/edits |
| Unknown outcomes | `We couldn't confirm whether your changes were saved.` + `Check save status` | A timeout ≠ proof of failure; never invite a second charge while the first is unresolved |
| Auth/permissions | `Sign in to continue.`; `Your session expired. Sign in again.`; `You don't have access to this project.` + `Request access`; `You have view-only access.` | Show a request-access action only when that workflow exists; respect disclosure policy for forbidden vs. nonexistent |
| Deletion | `Delete "Q3 plan"?` + `This permanently deletes the project and its 12 files. This can't be undone.`; reversible `Project moved to trash.` + `Undo` | Name the object + verified scope; never offer undo after permanent deletion |
| Unsaved changes | `Discard changes?` + `Your changes haven't been saved.` + `Keep editing`/`Discard changes` | Avoid `Yes`/`No` — meaning depends on remembering the question |
| Charges | `Pay USD 24.00`; `Subscribe for USD 12/month`; decline `Your payment was declined. Try another payment method.`; limit `You've reached the 10-project limit.` + `Manage projects` | Match amount/interval/taxes/renewal to the real transaction; never imply a free trial when charging immediately |

## 4. Bilingual (EN/ZH) rules

- Choose a primary locale (`lang="zh-Hans"` or `lang="en"`); make navigation, forms, validation, and transactional messages match it by default. Language switcher options are `English`/`简体中文`, not flags. `zh-Hant` is a separate locale, not an interchangeable style.
- Assign each language a role: a Chinese-first heading can show primary `项目设置` with secondary `Project settings` beneath; an action stays `保存更改`, never `Save 保存`. Where both are genuinely required, separate spans with their own `lang` attributes and equal prominence.
- Use each language's own grammar/punctuation: `Changes weren't saved. Try again.` / `更改未保存。请重试。`. One ordinary space at CJK–Latin/CJK–number boundaries (`导出 CSV 文件`, `还剩 3 个项目`); no space adjacent to punctuation.
- Maintain a glossary and preserve identifiers: `Project`→`项目`, `Workspace`→`工作区`, `Sign in`→`登录`. Keep official names/extensions/format names intact (`Gridline`, `.pdf`, `CSV`); don't alternate synonyms for the same object.
- Localize formats without changing facts: `Jun 7, 2026, 14:05 UTC` / `2026年6月7日 14:05 UTC`; `USD 1,234.50` regardless of language. Never infer currency from language or silently convert money; use locale-aware date/number APIs, not string replacement.
- Translate complete messages and plural logic — EN `{count, plural, =0 {No projects} one {# project} other {# projects}}`, ZH `{count, plural, =0 {暂无项目} other {# 个项目}}`. Never concatenate a translated verb with an independently translated object name.

## 5. Editorial techniques (the "crafted" feel)

- Base: `font-family: Inter, "Noto Sans SC", system-ui, sans-serif; font-size:16px; line-height:24px; font-weight:400; letter-spacing:0`. Keep `letter-spacing:0` for body, uppercase labels, numbers, and Chinese — build distinction through hierarchy and rhythm, not tracking.
- Role scale: hero `48px/52px` w600 (mobile `32px/36px`); operational H1 `24px/32px` w600; H2 `20px/28px` w600; panel H3 `18px/24px` w600. Never scale with `vw`, never make a compact panel look like a hero.
- Case: default sentence case (`Project settings`, `Save changes`); an editorial eyebrow may be an authored uppercase string (`FIELD NOTES`, `12px/16px` w600, `letter-spacing:0`, `text-transform:none` in CSS — the string itself is authored uppercase, not CSS-transformed). Never uppercase navigation or CSS-transform proper names.
- Italics: one emphasized EN phrase (1–3 words) per headline max, real italic font; Chinese emphasis uses `font-weight:600` semantic emphasis instead of `font-style:italic`. Controls, errors, prices, and long paragraphs stay upright; italics must not carry meaning unavailable to assistive tech.
- Numbering: `VOL.01` only for a real sequence, stored as `1`, displayed zero-padded to at least 2 digits; ZH equivalent `第 1 卷`. Actual workflow progress is `Step 1 of 6` / `第 1 步，共 6 步`, not decorative volume notation.
- Fit: `overflow-wrap:anywhere; min-width:0`; `line-break:strict` for `:lang(zh)`; buttons `min-height:44px`; reserve width for the longest state label. Verify 320/768/1440px, 200% text zoom, 400% browser zoom — wrap or restructure before shrinking type, never clip essential copy.

## 6. Anti-patterns

- **Generic/inflated/exclusionary voice**: `Unlock your potential`, `Next-level productivity`, `Everything you need`, `You're on fire!`, `Hey guys` on a work surface, idioms requiring cultural familiarity where a literal phrase works.
- **Redundant hierarchy / interface narration**: `DASHBOARD` above `Dashboard`; `Welcome to your dashboard`; `Use the sidebar to navigate between pages`; `Here you can view and manage all your projects` instead of the actual list; repeating a caption verbatim as alt text.
- **Ambiguous/inconsistent controls**: `Click here`, `Submit`, destructive `OK` instead of `Delete project`; confirmation `Yes`/`No` instead of `Discard changes`/`Keep editing`; alternating `Log in`/`Sign in` or `Workspace`/`Organization` for the same concept; `Continue` for an immediate commit, `Save` for navigation.
- **Unhelpful errors / dishonest states**: `Invalid input`, `Error 500`, `Oops! Something went wrong!`; reporting `Saved` before acknowledgment, `100%` before completion, or `Almost done` without evidence; a happy empty state masking a permission error or outage.
- **Manipulation / concealed consequences**: `No, I don't care about saving money` instead of `Not now`; fabricated `Only 2 left`; resetting countdowns; hidden recurring fees; preselected marketing consent; `Free` when a mandatory charge applies.
- **Unqualified numbers**: bare `+12%` instead of `12% higher than May 2026`; confusing percentages with percentage points; missing chart units/denominators/time zones; stale values presented as live; `100% secure` instead of a scoped verified fact.
- **Accessibility failures**: color-only status; unnamed icon buttons; repeated generic `Read more` links; essential conditions only in placeholders/hover tooltips; announcing every progress tick; depending on a disappearing toast as the only recovery path.
- **Localization/typographic theater**: `Save 保存`; mixed Simplified/Traditional; word-by-word translation; concatenated grammar; ambiguous `06/07/26`; `SAVE CHANGES!!!`; fake `VOL.01` labels; italic Chinese paragraphs; expanded tracking; viewport-scaled typography.
- **Privacy leaks / invented reassurance**: account-enumerating `No account exists for this email` instead of `If an account exists for this email, we'll send a reset link.`; exposing tokens/stack traces in user-facing errors; `Your work is safe`/`This can't be undone` unless the implementation actually makes it true.
