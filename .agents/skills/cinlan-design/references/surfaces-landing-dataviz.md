# Surfaces: landing page and data visualization — Cinlan Design

Page-type examples for new work. Use only the sections and geometry needed by the brief; a supplied reference or current product decides established layouts. Shared UI colors, radii, type roles, focus, and targets come from [design tokens](design-tokens.md). Record chosen page-specific dimensions once in the project token owner.

## A. Marketing landing page

### Structure and content

One possible sequence is header → promise → product demonstration → useful features → verified proof → primary action → footer. The task and available evidence determine which sections exist and their order. A utility or settings screen does not need this marketing sequence.

Use real product names, supplied screenshots, verified claims, and available assets. Omit unsupported testimonials, customer logos, metrics, trial terms, or pricing. Copy such as “No credit card required” belongs only when it is true. Do not invent a benefit to fill a section.

### Example composition

| Region | Starting geometry for an open brief |
|---|---|
| Content | Centered 1200px maximum width, 32px desktop and 16px mobile insets |
| Header | 72px desktop / 64px mobile minimum height; logo, essential navigation, one main action |
| Hero | Two equal columns above 1024px with a 64px gap; text-first single column below, 32px gap |
| Hero copy | Up to 560px text width; headline, explanation, action, factual supporting detail |
| Product media | Stable aspect ratio matching the source, contain rather than crop screenshots; use `--radius-feature` |
| Features | Three columns only if there are three useful, comparable points; stack as text needs space |
| Proof | One real quotation or quantified result can carry a section; more requires relevant evidence |
| Footer | Navigation groups follow actual destinations; avoid empty template columns |

These are composition examples, not universal dimensions. Inherit measured geometry for a reference task. Let long copy grow vertically; do not truncate titles to force a fixed line count. A responsive change should preserve reading order and task priority.

### Styling and emphasis

- Use `--canvas`/`--surface` and primary/secondary text roles for ordinary sections. An inverted demonstration or footer uses the inverse surface/text/border roles together.
- Primary actions use the accent family and `--accent-on`. Secondary controls use `--border-control`; decorative card borders are insufficient when the boundary identifies the action. Hover and pressed feedback follow [component patterns](component-patterns.md), without translating the control.
- Controls use `--radius-control`, repeated cards `--radius-card`, overlays `--radius-overlay`, large editorial frames `--radius-feature`. The page does not redefine a second corner system.
- Start from the title, display, body, label, and caption roles. For an editorial scale beyond these defaults, define named page roles in the project owner and check actual wrapping. Large type does not justify faint supporting copy.
- Place actions where they support a decision; do not require a CTA in every section. Related conversion actions share the intended destination and retain required campaign parameters.
- Video needs a poster, accessible playback controls, and a stable media area. Duration follows its content; it is not fixed by this example. Do not autoplay under reduced motion or outside the viewport.

### Accessibility and verification

Use one page H1 and logical section headings, accessible names, visible focus, image alternatives, and a skip link. Targets use the shared target policy; every normal-text pair reaches 4.5:1 and large text 3:1. Compare the rendered result at the [fixed viewport and fixture](verification.md), including an open mobile menu when applicable. A layout with compliant individual cards can still fail the intended hierarchy or density.

## B. Data visualization

### Frame

A standalone chart frame uses `--surface`, `--border-decorative`, `--radius-card`, and `--card-padding`; charts embedded in a dashboard can remain unframed. Min chart height `320/280/240px` desktop/tablet/mobile, max `520px`. Header: title+description left, controls right, `24px` gap to chart. Title uses `--font-section-title`; description uses `--font-ui` with a readable measure. Chart plot resizes: `0–479px`→`240px`, `480–767px`→`280px`, `768–1199px`→`360px`, `1200px+`→`420px`.

### Chart-type selection (apply in order, first match wins unless the user explicitly requests otherwise)

| Question | Chart | Rule |
|---|---|---|
| Compare `2–12` categories | Horizontal or vertical bar | Horizontal if any label >12 chars; sort descending |
| Compare `13–30` categories | Horizontal bar | Show top 12 + `Show all`; never render >30 bars |
| One metric, `3+` ordered points | Line | Point markers only below 12 points |
| `2–5` metrics over time | Multi-line | Direct labels at final point if ≤3 series |
| `6+` metrics over time | Small multiples | Max 4 charts/row — never a six-line chart |
| Cumulative composition | Stacked area | Max 5 components, fixed descending order |
| Part-to-whole, `2–5` categories | Donut | Bar chart instead above 5 categories |
| Distribution, `20+` observations | Histogram | 10 bins default, 20 at `500+` samples |
| Compare distributions, `2–6` groups | Box plot | Median/Q1/Q3/min/max non-outlier + outlier points |
| Two numeric vars, `10+` obs | Scatter | Trend line only for explicit correlation tasks |
| Third numeric var in scatter | Bubble | Area-encoded, radius `4–18px` |
| Two discrete dimensions | Heatmap | Cells ≥`24×24px`; table below that |
| Geographic rate/index | Choropleth | Normalized values only — never raw counts |
| Geographic points | Symbol map | Circle-area for quantity, cap 500 points, cluster at low zoom |
| Ordered process stages | Funnel | One measure, max 8 stages |
| Target vs. single measure | Bullet chart | Never a gauge |
| Values with a meaningful baseline | Diverging bar | Center zero, one color per side |
| No meaningful pattern | Table | Don't force a chart |

Never: pie >5 categories; 3D/perspective/bevel/gradient/exploded slices; dual Y-axes (normalize or split); line charts for unordered categories; a choropleth for raw totals; a trend chart for <3 observations.

### Color encoding

Position is the primary encoding; color is secondary and never the sole distinguisher. Hue = categorical identity; lightness = ordered magnitude; diverging scale only with a real midpoint. Series colors stay stable across views/filters/time.

Categorical: use `--chart-1` through `--chart-8` with direct labels and stable series identity. Beyond eight simultaneous series, use filtering, small multiples, or a table. Adjacent marks may need a surface-colored separating stroke. Selection uses an outline or shape as well as color; do not fade essential marks below their required contrast. Missing categories use `--text-muted` with a hatch and label.

Sequential: use the ordered `--chart-sequential-1` through `--chart-sequential-5` scale with a labeled legend. Diverging: interpolate `--chart-negative` through `--chart-midpoint` to `--chart-positive` only with a real, labeled midpoint. Light bins may need a contrasting outline or redundant labels; verify meaningful marks and text in each theme. Color alone must not carry an exact value or state.

Status: use the shared success/warning/danger/info foreground and soft-background pairs with text and the corresponding check/triangle/error/info cue. Do not reuse series colors as undocumented status colors.

### Axes, ticks, legends

Plot padding: left `56px` (with Y label) / `40px`, right `24px`, top `16px`, bottom `48px` (with X label) / `32px`. Essential axes use `--border-control`; decorative gridlines use `--border-decorative`, dashed `2px 4px`, horizontal by default; the zero line uses `--text-muted`; no border around the full plot region.

Tick counts scale with width (numeric X `3/4/5`, numeric Y `4/5/6`, categorical Y `6/8/12` at mobile/tablet/desktop); reduce along `6→5→4→3` if labels would overlap; never >8 X labels mobile or >12 desktop. Bar/column/area/bullet axes start at `0`; line/scatter may use a nonzero minimum only when zero is outside the domain and not analytically meaningful. Numeric formatting: `0.0%`/`0%` for percentages by magnitude, `1.2k`/`1.2M`/`1.2B` abbreviation above 1000, currency symbol + abbreviation, duration `42s`/`m:ss`/`h:mm:ss`, dates `MMM D`/`MMM`/`YYYY` by span. Max 2 decimals in tooltips, 1 on axes; thousands separator in tooltips/tables even when axes are abbreviated.

Legend: `--font-ui` and `--text-secondary`, `12×12px` marker, `16px`/`8px` gaps. Desktop top-right for 1–4 series, top-left below description for 5–8; mobile below title, wraps max 2/row, max 3 rows total. Beyond 8 series: filter or small multiples, never a 4th row. 1–3 line series: direct labels, hide the legend. Legend items are keyboard-operable with `aria-pressed`; toggling visibility never rescales unless the user explicitly opts in.

### Marks, interaction, tooltips

Bar thickness `24–48px`, gap `8px`; line stroke `2px` (`3px` focused); point `6px` (`10px` focused); heatmap cell ≥`24×24px`, `2px` gap; donut thickness `24px`, min segment angle `3°`; map point `8–48px`. A directly actionable mark follows the shared target policy; do not overlap expanded hit areas in a dense plot. When marks cannot fit separate targets, offer a keyboard cursor, nearest-point interaction, and an equivalent data table. Hover uses `--duration-micro`, focus is immediate; highlighted marks get a visible `--focus-ring` or contrasting outline. Crosshair uses `--text-muted` and snaps to the nearest data point. Essential marks retain contrast.

Tooltip: hover (`150ms` delay, `100ms` hide) or keyboard focus; touch tap-to-open/tap-outside-close; max width `280px`, padding `12px 16px`, `--inverse-surface`/`--inverse-text`, `--radius-control`, `12px` offset, ≥8px from any viewport edge. Content order: category/date → series name + swatch + exact value → comparison (if any) as absolute + percentage delta. Always include units; for stacked charts show segment + stack total; never put essential information only in a tooltip.

### States

Loading: preserve final frame dimensions and header position; 5 skeleton rows (bar) or 6 skeleton gridlines (other); `--border-decorative`/`--surface-inset` shimmer using `--duration-skeleton` and linear easing (disabled under reduced motion); `Loading data` centered; `aria-busy="true"`; never a spinner and skeleton together.

Empty (valid, zero records): preserve card height, `40×40px` icon `--text-muted`, `No data yet` + `Data will appear here when records are available.`; no axes/legend/gridlines/zero-marks; `aria-live="polite"`.

No-result (filters exclude everything): `No results match your filters` + `Change or clear a filter to see data.` + `Clear filters` (`44px`, `16px` margin-top); preserve frame; never substitute the generic empty state.

Error: `40×40px` icon `--danger`, `Unable to load data` + `Try again. If the problem continues, contact support.` + `Try again` (`44px`); technical details behind a `Show details` disclosure; retry preserves the original query and refocuses itself on repeat failure; `role="alert"`.

### Responsive rules

Below `480px`: controls move to a second row (`8px` gap, full-width buttons); hide redundant axis titles; abbreviate category labels to 18 chars (full label in tooltip + table); use horizontal bars when labels exceed 12 chars. Below `640px`: legends move below the plot; the data table scrolls horizontally rather than shrinking text below `12px`. Below `768px`: replace hover-only affordances with tap/focus. Filters, legend toggles, zoom, and reset controls follow the shared target policy; this example uses the default 44px targets.

### Accessibility

Wrap every chart in `role="region"` named by its title, with a description containing metric/dimensions/date range/unit. Always include a visually-hidden or disclosed data table containing every currently-filtered point, not just visible ticks. Chart region `tabindex="0"`; arrow keys navigate marks (`ArrowRight/Left` across X, `Up/Down` across series), `Home`/`End` jump to extremes, `Enter` opens detail, `Escape` closes it; legend toggles via `Space`/`Enter`; zoom via `+`/`-`/`0`. Focused marks use the shared focus width/offset and a ring verified against adjacent plot colors; add a contrasting backing ring if one color cannot remain visible across every series.

Screen-reader announcement per focused mark: series/category name → X value → Y value → unit → `item N of M` → comparison if available. Use `aria-live="polite"` only for newly-selected data, filter changes, load completion, and errors; `assertive` only for destructive/blocking errors — never announce every point automatically. Provide non-color redundancy: line patterns (solid/dashed/dotted/dash-dot), point shapes, hatch for missing/estimated data, icons+labels for status.

### Data integrity

Display the selected date range and last-updated timestamp (with timezone) below the chart; link the source when one exists. Never interpolate missing values without labeling the method — break lines across gaps by default, connect only on explicit user opt-in. Label estimated values with an asterisk and explain it. Preserve the original unit/currency/precision in the data table even when display values are rounded or abbreviated. Use the same domain and color mapping across comparable charts on one page.
