# Surfaces: Landing Page & Data Visualization — Cinlan Design

Distilled from gpt-6-astra (reasoning=max). Tokens reference `design-tokens.md`.

## Shared foundations

Breakpoints: mobile S `0–359px` (`16px` padding), mobile L `360–767px` (`20px`), tablet `768–1199px` (`32px`), desktop `1200–1439px` (`48px`, `1104px` max), wide `1440px+` (`64px`, `1280px` max). Base spacing unit `4px`. Radius: controls `8px`, cards `12px`, feature panels `16px`, hero media `24px`, pills `9999px`. Standard shadow `0 8px 24px rgba(17,24,39,.08)`; elevated `0 16px 40px rgba(17,24,39,.12)`. Minimum target `44×44px`; focus ring `2px solid #F59E0B`, offset `3px`; default transition `160ms cubic-bezier(0.2,0.8,0.2,1)`. Animate opacity/transform only — never layout dimensions, font size, or chart axes; disable nonessential motion under `prefers-reduced-motion`.

## A. Marketing landing page

### Scroll narrative and section spacing

Fixed narrative: Orientation (header) → Promise (hero) → Recognition (logo strip) → Understanding (3 feature cards) → Demonstration (product visual) → Differentiation (3 alternating panels) → Validation (testimonial+metric) → Conversion (final CTA) → Completion (footer).

| Section | Top spacing | Bottom spacing |
|---|---:|---:|
| Hero | `96px` | `112px` |
| Logo strip | `0` | `128px` |
| Workflow (3-step) | `0` | `144px` |
| Product demo | `0` | `144px` |
| Advantage panels | `0` | `144px` |
| Testimonial | `0` | `144px` |
| Final CTA | `0` | `128px` |

Tablet spacing = `80%` of desktop. Mobile: `64px` between major sections, `40px` between subsection elements.

### Header

`72px` desktop/tablet, `64px` mobile; sticky (`top:0; z-index:100`), shadow `0 2px 12px rgba(17,24,39,.08)` after `8px` scroll; `1px solid #E5E7EB` bottom border. Logo `128×32px`; desktop nav gap `28px`, item `15px/24px` w500; right-action gap `12px`. Primary CTA `Start free` `128×44px` `14px/20px` w600, `#2563EB`/`#FFFFFF`, radius `8px`; secondary link `Sign in` `88×44px`. Mobile: only logo + `44×44px` nav trigger visible closed; menu panel below header, `48px` item height, `4px` item gap.

### Hero

Grid `1fr 1fr` desktop/wide (`80px` gap, centered), `1fr` tablet (text-first, `48px` gap), one column mobile (`32px` gap). Min height `560px` desktop, `auto` below `1200px`. Text max-width `560px`; media max-width `560px`, aspect `16/11`, radius `24px`.

Content stack (exact order): eyebrow → H1 → paragraph → CTA group → microcopy.

| Element | Desktop | Mobile | Color |
|---|---:|---:|---|
| Eyebrow | `14px/20px` w700, `0.08em` | `13px/18px` w700 | `#2563EB` |
| H1 | `64px/68px` w700, `-0.04em`, ≤3 lines | `40px/44px` w700, `-0.03em`, ≤4 lines | `#111827` |
| Paragraph | `20px/30px`, max `520px` | `18px/28px` | `#4B5563` |
| Microcopy | `13px/20px` | `12px/18px` | `#6B7280` |

Gaps: eyebrow→H1 `16px`, H1→paragraph `24px`, paragraph→CTA `32px`/`24px` (desktop/mobile), CTA→microcopy `12px`. Primary/secondary CTA `152×52px`, gap `12px`, horizontal ≥768px / vertical + full-width below. Microcopy must state exactly one of `No credit card required` or `Free for 14 days`.

Media frame `#EFF6FF` background, `24px`/`16px` padding; screenshot radius `12px` + elevated shadow; one optional annotation badge only (`36px` high pill, `24px` from top/right, standard shadow). Never place text over the screenshot unless it's inside the actual product UI.

### Social proof

Label centered `14px/20px` w600 `#6B7280`, `32px` gap to logos. Desktop: 5 logos, `48px` gap, max `144×32px`, monochrome `#9CA3AF` (no brand colors). Tablet: `24px` gap, max `112px`. Mobile: 2-column grid, `20px 24px` gap, 5th logo spans both columns centered.

Quantified proof (3 metric cells, `24px` gap, `1px solid #E5E7EB` divider desktop only): number `40px/44px` w700 `#111827`, label `14px/20px` `#6B7280` max `180px`, `4px` gap between them. Value formats limited to `3.2×`, `42%`, `10k+` style — max one decimal.

### Feature sections

Shared section header: heading max `640px`, centered for full-width / left for split panels; eyebrow→heading `12px`, heading→description `16px`; H2 `48px/56px` w700 desktop, `32px/38px` mobile; description `18px/28px` desktop max `600px`, `16px/24px` mobile.

**Workflow grid**: 3 equal columns desktop/tablet (`24px`/`16px` gap), 1 column mobile (`16px` gap); card min-height `280px`/`240px`, padding `32px`/`24px`, background `#F9FAFB`, border `#E5E7EB`, radius `16px`; step indicator `40×40px` `#DBEAFE`/`#1D4ED8` pill; title `22px/28px` w700 (≤22 chars), body `16px/24px` `#4B5563` (≤90 chars).

**Product demonstration**: inverted section, background `#111827`; desktop text column `400px` + media `1fr`, gap `80px`, padding `80px`; mobile padding `48px 20px`. Include exactly one demo video/preview, duration `12s`, playback control, poster image, visible `Play demo` button, `44×44px` control target. Autoplay prohibited under reduced-motion or when outside the viewport.

**Alternating advantage panels** (exactly 3, in order): 1 `Capture` (visual right, `#FFFFFF`), 2 `Understand` (visual left, `#F9FAFB`), 3 `Act` (visual right, `#FFFFFF`). Grid `1fr 1fr` desktop (`80px` gap, min height `440px`); mobile stacks text-above-visual (`32px` gap). H3 `32px/40px`/`28px/34px` w700; body max `460px` `18px/28px`/`16px/24px`; CTA is a text link with a `16px` arrow, `44×44px` hit area; visual frame `4/3` aspect, `#F3F4F6`, border, radius `16px`.

### CTA placement and styling

Required locations: header (1 primary), hero (1 primary + 1 secondary), workflow section (1 centered, `40px` margin-top), each advantage panel (1 text-link), final CTA (1 primary + 1 secondary), footer (1 text-link signup). No CTA inside the testimonial.

| Variant | Height | Font | Background | Border |
|---|---:|---|---|---|
| Primary | `52px` | `16px/24px` w600 | `#2563EB` | none |
| Secondary | `52px` | `16px/24px` w600 | `#FFFFFF` | `1px solid #D1D5DB` |
| Small primary | `44px` | `14px/20px` w600 | `#2563EB` | none |
| Text link | `44px` min target | `16px/24px` w600 | transparent | none |

Primary hover `#1D4ED8`, pressed `#1E40AF` + `translateY(1px)`; secondary hover `bg:#F9FAFB;border:#9CA3AF`; disabled `opacity:.48`. All conversion CTAs share destination and preserve UTM parameters.

### Testimonial, final CTA, footer

Testimonial: quote column `2fr` + proof `1fr` desktop (`80px` gap), one column mobile (`40px`). Quote mark `56px/56px` `#2563EB`; quote `32px/42px` w500, max 280 chars; avatar `48×48px` circle; proof card `#EFF6FF`, radius `16px`, metric `48px/52px` w700 `#1D4ED8`. Exactly one testimonial + one metric card.

Final CTA: background `#DBEAFE`, radius `24px`/`16px`, padding `80px`/`48px 24px`, centered; H2 `48px/56px`/`32px/38px` ≤2 lines; same CTA sizes as hero; no form fields — the primary CTA must be the lowest-friction action.

Footer: background `#111827`, text `#FFFFFF`/`#9CA3AF`; desktop grid brand `2fr` + 4 nav columns (`48px` gap), mobile one column (`32px`); exactly 4 nav groups (`Product`/`Resources`/`Company`/`Legal`); nav links `44px` min vertical target; divider `1px solid #374151` `64px`/`48px` margin-top; legal row copyright left / links right desktop, stacked mobile with `16px` gap.

### Typography scale and spacing rhythm

| Token | Size/LH | Weight | Usage |
|---|---|---:|---|
| Display | `64px/68px` | 700 | Desktop H1 |
| H2 | `48px/56px` | 700 | Major section headings |
| H3 | `32px/40px` | 700 | Advantage panel headings |
| Title | `22px/28px` | 700 | Feature card titles |
| Body large | `20px/30px` | 400 | Hero support text |
| Body | `18px/28px` | 400 | Section support text |
| Label | `16px/24px` | 600 | Buttons and labels |
| Small | `14px/20px` | 400 | Metadata, footer links |
| Caption | `13px/20px` | 400 | Microcopy |

Body text `#374151`; headings `#111827`; never below `400` or above `700` weight; minimum rendered text `13px`. Spacing rhythm uses only: `4/8/12/16/20/24/32/40/48/56/64/80/96/112/128/144px` — never an arbitrary value.

### Landing-page accessibility

One H1; exactly one H2 per major section; H3 inside cards/panels. `2px` focus ring, `3px` offset. Text contrast ≥4.5:1 normal / ≥3:1 at ≥24px. Every image needs alt text (`alt=""` if decorative); every icon-only control needs a name. Reading order fixed: header → hero text → hero media → sections → footer at every breakpoint. Never color-only state. Skip link `44px` high, visible on focus, `top:0; left:16px`.

## B. Data visualization

### Frame

Card `#FFFFFF`, border `#E5E7EB`, radius `12px`, padding `24px`/`16px`. Min chart height `320/280/240px` desktop/tablet/mobile, max `520px`. Header: title+description left, controls right, `24px` gap to chart. Title `20px/28px` w700; description `14px/20px` max `640px`. Chart plot resizes: `0–479px`→`240px`, `480–767px`→`280px`, `768–1199px`→`360px`, `1200px+`→`420px`.

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

Categorical (max 8 simultaneous, `1px #FFFFFF` stroke between adjacent marks): `#2563EB #DB2777 #059669 #D97706 #7C3AED #0891B2 #DC2626 #4B5563`. Beyond 8: direct labels, filtering, small multiples, or a table — never more colors. Selected `100%` opacity; unselected/unrelated `20%`. Missing category: `#9CA3AF` + `45°` diagonal hatch, `6px` spacing.

Sequential: `#EFF6FF→#BFDBFE→#60A5FA→#2563EB→#1E3A8A` (5 legend bins default, 7 only at 100+ records and ≥640px width). Diverging (midpoint must be `0` or a declared reference): `#B91C1C→#EF4444→#FCA5A5→#F9FAFB→#93C5FD→#3B82F6→#1D4ED8`; label the midpoint explicitly; never red/green as the only distinction.

Status: positive `#15803D`/`#DCFCE7` + up/check icon; warning `#A16207`/`#FEF9C3` + triangle; negative `#B91C1C`/`#FEE2E2` + down/error icon; neutral `#374151`/`#F3F4F6` + dash/info icon.

### Axes, ticks, legends

Plot padding: left `56px` (with Y label) / `40px`, right `24px`, top `16px`, bottom `48px` (with X label) / `32px`. Axis stroke `1px #9CA3AF`; gridlines `1px #E5E7EB` dashed `2px 4px`, horizontal only by default; zero line `2px #6B7280`; no border around the full plot region.

Tick counts scale with width (numeric X `3/4/5`, numeric Y `4/5/6`, categorical Y `6/8/12` at mobile/tablet/desktop); reduce along `6→5→4→3` if labels would overlap; never >8 X labels mobile or >12 desktop. Bar/column/area/bullet axes start at `0`; line/scatter may use a nonzero minimum only when zero is outside the domain and not analytically meaningful. Numeric formatting: `0.0%`/`0%` for percentages by magnitude, `1.2k`/`1.2M`/`1.2B` abbreviation above 1000, currency symbol + abbreviation, duration `42s`/`m:ss`/`h:mm:ss`, dates `MMM D`/`MMM`/`YYYY` by span. Max 2 decimals in tooltips, 1 on axes; thousands separator in tooltips/tables even when axes are abbreviated.

Legend: `13px/20px` `#374151`, `12×12px` marker, `16px`/`8px` gaps. Desktop top-right for 1–4 series, top-left below description for 5–8; mobile below title, wraps max 2/row, max 3 rows total. Beyond 8 series: filter or small multiples, never a 4th row. 1–3 line series: direct labels, hide the legend. Legend items are keyboard-operable with `aria-pressed`; toggling visibility never rescales unless the user explicitly opts in.

### Marks, interaction, tooltips

Bar thickness `24–48px`, gap `8px`; line stroke `2px` (`3px` focused); point `6px` (`10px` focused); heatmap cell ≥`24×24px`, `2px` gap; donut thickness `24px`, min segment angle `3°`; map point `8–48px`. Minimum pointer target for any mark `24×24px` (invisible hit area if the visible mark is smaller). Hover response `120ms`, focus `0ms`; hovered mark gets a `2px #111827` outline at full opacity, unrelated marks stay ≥20% opacity (never `0%`). Crosshair `1px dashed #6B7280`, snaps to the nearest data point.

Tooltip: hover (`150ms` delay, `100ms` hide) or keyboard focus; touch tap-to-open/tap-outside-close; max width `280px`, padding `12px 16px`, `#111827`/`#FFFFFF`, radius `8px`, `12px` offset, ≥8px from any viewport edge. Content order: category/date → series name + swatch + exact value → comparison (if any) as absolute + percentage delta. Always include units; for stacked charts show segment + stack total; never put essential information only in a tooltip.

### States

Loading: preserve final frame dimensions and header position; 5 skeleton rows (bar) or 6 skeleton gridlines (other); `#E5E7EB`/`#F3F4F6` shimmer `1200ms linear infinite` (disabled under reduced motion); `Loading data` centered; `aria-busy="true"`; never a spinner and skeleton together.

Empty (valid, zero records): preserve card height, `40×40px` icon `#6B7280`, `No data yet` + `Data will appear here when records are available.`; no axes/legend/gridlines/zero-marks; `aria-live="polite"`.

No-result (filters exclude everything): `No results match your filters` + `Change or clear a filter to see data.` + `Clear filters` (`44px`, `16px` margin-top); preserve frame; never substitute the generic empty state.

Error: `40×40px` icon `#B91C1C`, `Unable to load data` + `Try again. If the problem continues, contact support.` + `Try again` (`44px`); technical details behind a `Show details` disclosure; retry preserves the original query and refocuses itself on repeat failure; `role="alert"`.

### Responsive rules

Below `480px`: controls move to a second row (`8px` gap, full-width buttons); hide redundant axis titles; abbreviate category labels to 18 chars (full label in tooltip + table); use horizontal bars when labels exceed 12 chars. Below `640px`: legends move below the plot; the data table scrolls horizontally rather than shrinking text below `12px`. Below `768px`: replace hover-only affordances with tap/focus. At every width: `44px` target for filters/legend/zoom/reset controls.

### Accessibility

Wrap every chart in `role="region"` named by its title, with a description containing metric/dimensions/date range/unit. Always include a visually-hidden or disclosed data table containing every currently-filtered point, not just visible ticks. Chart region `tabindex="0"`; arrow keys navigate marks (`ArrowRight/Left` across X, `Up/Down` across series), `Home`/`End` jump to extremes, `Enter` opens detail, `Escape` closes it; legend toggles via `Space`/`Enter`; zoom via `+`/`-`/`0`. Focused marks get a `#F59E0B` `2px`/`3px` outline — never color-only focus.

Screen-reader announcement per focused mark: series/category name → X value → Y value → unit → `item N of M` → comparison if available. Use `aria-live="polite"` only for newly-selected data, filter changes, load completion, and errors; `assertive` only for destructive/blocking errors — never announce every point automatically. Provide non-color redundancy: line patterns (solid/dashed/dotted/dash-dot), point shapes, hatch for missing/estimated data, icons+labels for status.

### Data integrity

Display the selected date range and last-updated timestamp (with timezone) below the chart; link the source when one exists. Never interpolate missing values without labeling the method — break lines across gaps by default, connect only on explicit user opt-in. Label estimated values with an asterisk and explain it. Preserve the original unit/currency/precision in the data table even when display values are rounded or abbreviated. Use the same domain and color mapping across comparable charts on one page.
