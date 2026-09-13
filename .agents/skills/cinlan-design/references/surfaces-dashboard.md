# Surface: Data-Dense Dashboard — Cinlan Design

Distilled from gpt-6-astra (reasoning=max). Tokens reference `design-tokens.md`. Reference surface: an operational dashboard with four KPIs, two charts, one event table.

## Foundations

Colors: page `#F5F6F7`; nav/controls/charts/table surface `#FFFFFF`; primary text `#202428`; secondary `#646B73`; separators `#DDE1E4`; interactive borders `#737B84`; primary action + focus `#175CD3`; positive `#137333`; negative `#B42318`; warning `#8A5A00`. Every semantic color pairs with a label/icon/line pattern — never color alone.

Typography: `Inter, Arial, sans-serif`. Page title `24px/32px` w600; section titles `16px/24px` w600; KPI values `24px/32px` w600; body/controls/cells `13px/20px` w400; headers/control labels `13px/20px` w600; metadata `12px/16px`. `letter-spacing:0`; numeric content `font-variant-numeric: tabular-nums`. Sizes never change with viewport width or density.

Surface: `4px` base spacing scale, `1px` separators and `2px` focus rings as explicit exceptions. KPI cards `6px` corners, `1px` inset border consuming no layout space. Menus/dialogs `8px` corners. Charts and the table are unframed, full-width regions — never inside floating cards, never nested.

Controls: compact `32px`, comfortable `40px` high; text buttons `12px` horizontal padding; icon buttons square with `16px` Lucide icons; `(pointer:coarse)` → all targets `≥44×44px` regardless of density. Segmented controls for density, checkboxes for selection, a switch for Live, menus for option sets.

Interaction tokens: hover `#F0F2F4`; pressed `#E5E8EB`; selected-row `#EAF2FF`; disabled `#646B73` on `#F0F2F4`; focus `2px #175CD3` + `2px` white offset; color transitions `100ms`. Layer order: table headers `10` → sticky filters `20` → nav `30` → app header `40` → menus `50` → drawers/dialogs `60` → tooltips `70`.

## Responsive layout

Breakpoints: mobile `320–767px`, tablet `768–1279px`, desktop `≥1280px`. Minimum supported viewport `320px`; retain that minimum width and allow document scroll rather than clipping controls.

| Viewport | Shell | Nav |
|---|---|---|
| Desktop | `64px` header | `224px` left nav |
| Tablet | `64px` header | `64px` icon rail |
| Mobile | `56px` header | overlay drawer `min(280px, viewport - 32px)` |

Content width `C = min(1600px, V - N - 2P)` with `P = 24/16/12px` desktop/tablet/mobile. Reading order at every breakpoint: heading+freshness → global filters → KPI grid → charts → event table. Heading row `40px` (fine pointer) / `48px` (coarse); title left, Live switch + refresh + view-settings right (mobile: freshness text drops to its own `20px` row).

Grid: desktop 12 columns/`16px` gaps, tablet 8/`12px`, mobile 4/`8px`. KPIs span `3/4/2` columns → 4-across desktop, 2-across tablet/mobile. Desktop charts `8+4` columns; both full-width on tablet/mobile. Table always full grid width. Density changes controls/table geometry only, never column count.

Scrolling: the document owns section-to-section scroll; the filter bar sticks below the header with an opaque background + `1px` bottom separator; charts never scroll horizontally; only the table's data viewport scrolls in both axes; menus/tooltips render outside scroll-clipping ancestors.

## KPI cards

Exactly 4 primary metrics; extras go in the table. Compact `112px` high/`12px` padding; comfortable `128px`/`16px`; row heights `20/32/20px` with `8px`/`12px` gaps respectively. Content slots: label (`13px/20px`, truncates with full text on hover/focus) → value (left-aligned, never truncates — abbreviate `K/M/B/T` at ≥1000, ≤3 significant digits, scientific notation above `10^15`) → comparison (`12px/20px`).

Comparisons: against the immediately preceding interval of identical duration and filters. Relative change to 1 decimal; success-rate uses percentage-point change + `pp` suffix. Zero→positive shows `New`; zero→zero shows `0.0%`; missing baseline shows `No baseline`. Higher success / lower latency-errors is positive; volume changes are neutral. `12px` directional icon + `4px` text gap.

States: confirmed zero is `0`, never a placeholder. Undefined rate/latency is `N/A`. Missing source data shows `N/A` value + `Unavailable` comparison. Loading replaces value+comparison with skeletons at unchanged geometry. A failed refresh after valid data retains the value, marks the comparison `Stale`, and exposes the last successful timestamp. Cards are read-only, keyboard-focusable only to expose full-precision values in a tooltip — no sparklines, illustrations, menus, or secondary metrics on the card itself.

## Filters

Desktop row (`8px` gaps, `40px`/`48px` row height): time range `160px` → service `160px` → region `128px` → status `128px` → Apply `72px` → reset icon `32/40px`. Coarse pointer: all `44px`, row `56px`. Tablet/mobile: `160px` time-range button + `88px` Filters button showing a `0–3` active-group count; both open the same drawer focused on the relevant field (`360px` tablet / full-width mobile, `16px` padding, `56px` header, `72px` fixed footer).

Ranges: `Last 1h/24h/7d/30d/Custom`; custom range includes its start, excludes its end, min duration `1 minute`, max `30 days`, no future end. Service/region are searchable multiselects (`250ms` debounce, `No options` on zero matches); status is a checkbox group (`Success`/`Failed`/`Pending`).

Commit: edits stay draft until Apply; Reset restores draft defaults and still needs Apply; Apply disabled while unchanged/invalid; invalid feedback appears `12px/16px` below its field with reserved `32px` space. Apply commits all fields atomically, cancels obsolete requests, resets table pagination/scroll/selection. Cancel/Escape/backdrop discards drawer changes. Persist applied filters+search+sort+page-size in the URL; persist density+column visibility locally; never persist selection, pause state, or draft filters.

## Charts

`Event volume` (line) first, `Status distribution` (bar) second. Section height `280px` desktop/tablet compact (`320px` comfortable), `248/280px` mobile. Header `40/48px`; plot fills the remainder; no rounded container or shadow on chart sections.

Plot margins: volume `16/16/32/48px` (T/R/B/L); distribution `16/16/32/80px`. `2px` line strokes, no persistent point markers, `20px` bars with `12px` minimum gaps. Time buckets: `1min` up to 1h, `15min` through 24h, `1hr` through 7d, `3hr` through 30d — max 240 buckets, anchored to the range start, partial final bucket allowed.

Colors: volume `#175CD3`; status bars `#00796B`/`#B42318`/`#8A5A00` (Success/Failed/Pending) with matching labels; gridlines `#E5E7EB` `1px`. A confirmed-empty bucket is zero; an unknown bucket is a gap — never interpolated. Axes start at `0` (domain `0–1` if all-zero); otherwise max `= max(1, ceil(1.1×highest value))`. `5` Y ticks; `6` X ticks if plot ≥480px wide else `3`. Tooltip `8px` from the point, exact UTC interval + unrounded counts.

Each chart header has a title + one overflow button (`View data` / `Download CSV`). Arrow keys move a focused chart cursor by one bucket; Home/End jump to first/last; Escape closes the tooltip. Plot changes animate `0ms`; controls may use the shared `100ms` color transition.

## Data table

Vertical geometry (toolbar/header/rows/footer): compact `40/32/32/40px`, comfortable `48/40/40/48px`, coarse-pointer override `56/48/48/56px`. Desktop/tablet viewport height = exactly `12 × row height`; mobile = `6 × row height` with a separate two-row toolbar.

Columns (compact): Selection `40px`, Event ID `184px`, Timestamp `176px`, Service `160px`, Region `112px`, Status `104px`, Latency `104px`, Actions `40px` — total `920px` (comfortable/coarse widen Selection+Actions to `48/56px`). Extra available width goes entirely to Service. Pin Selection+Event ID left, Actions right, header sticky (desktop/tablet); mobile disables pinning, keeps only the sticky header. Users may hide Service/Region/Latency.

Cells: `8px`/`12px` horizontal padding (compact/comfortable), `1px` inset row separators (don't alter row height), text left-aligned, numerics right-aligned, timestamp `YYYY-MM-DD HH:mm:ss` with `UTC` in the header. Status = `8px` dot + `6px` gap + text. No wrapping; clipped values available via detail/hover/focus.

Toolbar: `240px` search + row count left, column-visibility + export icons right (`8px` gaps); a reserved `120px` slot for pending-new-row actions so its appearance never shifts other controls. Default sort timestamp-descending with Event ID ascending tie-break; page size `50` (options `25/50/100`). Selection checkboxes `16px`/`20px` coarse; header selection affects current page only with an indeterminate state; selection survives refresh by Event ID but clears on filter/search/sort/page change. With selection present, toolbar count becomes `N selected` and export is selection-scoped.

## Density

| Property | Compact (default) | Comfortable |
|---|---:|---:|
| Table row | `32px` | `40px` |
| Cell h-padding | `8px` | `12px` |
| Control height | `32px` | `40px` |
| Body text | `13px/20px` | `14px/20px` |
| Icon size | `16px` | `18px` |

Density affects controls/table only, never chart/KPI dimensions. Touch targets always `≥44×44`, mobile rows `44px` regardless of density. Never shrink typography with viewport or resize on hover.

## Real-time states

Heartbeat every `5s`; batch valid changes into one visual commit every `5s`. Freshness measured from the last valid message, not the last new event; recompute the relative-time label once per second without polling once per second.

Health precedence (highest first): `Offline` (browser event) → `Reconnecting` (age ≥30s or transport failure) → `Stale` (age 15–30s, retain data + warning icon) → `Paused` (Live switch off) → `Updating` → `Live` (age <15s). Reconnect backoff `1/2/4/8/16/30s`, then every `30s`; stop attempts while offline, retry immediately on `online`. Snapshot timeout `15s`; dedupe by Event ID+version.

Pausing Live freezes rendered values and the committed timestamp while the connection may keep receiving (coalesce up to 1000 buffered updates; exceeding that invalidates the buffer, requiring a fresh snapshot on resume). Hidden documents stop visual commits — apply the buffer on return within 60s, otherwise fetch a fresh snapshot.

Table stability: auto-prepend new records only on page 1, timestamp-descending, `scrollTop=0`, no selection, no focus in the table — otherwise buffer and show `N new` (`999+ new` above 999) in the reserved toolbar slot; activating it clears selection, returns to page 1, scrolls to top. Preserve the first visible Event ID + pixel offset during in-place updates. Updated numeric cells get a `#EAF7EF` background for `800ms` (static tint under reduced motion); connection-state transitions and user-triggered refresh completions are announced via one polite live region — never per streamed event.

## Loading and empty

Initial load: reserve the complete final layout immediately; blank for the first `150ms`, then skeletons; export/selection disabled until data exists but filters/nav stay usable; `Loading data` in the freshness slot at `5s`; an unresolved request at `15s` becomes a scoped timeout error + Retry.

Skeleton geometry: KPI label `80×12px`, value `88×28px`, comparison `72×12px`; chart skeletons keep the header + one flat plot rectangle (no fake data); table skeletons fill every visible row at `60%` of each cell's content width. Color `#E5E7EB`, opacity pulse `0.55↔1` over `1200ms` (static under reduced motion).

Background refresh retains existing data/selection/scroll/cursor and shows a `2px` progress line on the affected section (`aria-busy="true"`) without consuming layout; a changed query immediately masks old values so stale data is never shown under new filters, and discards responses whose query id no longer matches.

No source: KPIs `N/A`, chart/table regions show `No source connected` + `Connect source` heading action. Valid zero data (configured source, successful empty response, no filters): Events `0`, Errors `0`, Success rate `N/A`, latency `N/A`, volume chart zero baseline, distribution shows three labeled zeros, table shows `No events in this period` + Refresh — never a warning color. Filtered empty: `No matching events` + `Clear filters`/`Clear search` depending on scope.

Errors: a first-load section failure replaces only that section with `Data unavailable` + Retry, siblings stay usable; a post-success failure retains cached values with a `Stale` label; total failure adds a full-width `48px` error band above the KPIs. `401` → `Session expired` + Sign in. `403` → clears protected cache, `Access restricted`, no Retry. `429` → disables Retry for the server's `Retry-After` (default `30s`) with a countdown. Offline with cache retains last data; offline with no cache shows `Offline`.
