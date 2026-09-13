# Design Tokens — Cinlan Design (distilled from gpt-6-astra, reasoning=max)

Semantic tokens are the only allowed references inside components. Raw values live here only.

## Observed signature (from sampled artifacts)

The model's self-described tokens are its generic ideal. Its **actual output** — three fresh samples in `.artifacts/distill-astra/sample-login-card.md`, `sample-settings-panel.md`, `sample-dashboard-card.md` — reveals a consistent craft fingerprint. Treat this as ground truth:

- **Palette is context-dependent, craft is constant**: the login card uses a warm coral brand mark (`#f18469`) with a near-black primary button (`#252b28`) and a green focus ring (`#39755e`); the settings panel uses a full green accent (`#286347`) for its switch and button; the dashboard card uses a cool blue (`#486bd6`) sparkline and neutral ink. The accent shifts with the artifact's mood; the discipline does not.
- **Intermediate font weights**: `550`/`650` appear constantly — labels and status text at `550`/`600`, headings and brand marks at `650`.
- **Tighter radius than the generic default**: `5–6px` on inputs/buttons/switches, `8px` on the enclosing card.
- **Focus ring is a border-color change plus a soft outline/glow**: `border-color` shifts to the accent and an `outline: 3px solid <accent>1a–33` (or a `box-shadow` glow) appears with `1–4px` offset — never a bare default outline.
- **One shadow maximum**: a single soft, low-opacity shadow on the outer framed surface (`0 12px 36px -20px #253d3033`, `0 20px 48px #182d210a`); nothing else in the artifact carries a shadow.
- **A11y unprompted**: `aria-labelledby`, `role="switch"`, `role="status"`, `autocomplete`, `spellcheck="false"`, `autocapitalize="none"`, `color-scheme`, `prefers-reduced-motion` queries, and semantic landmarks appear without being asked.
- **Working JS included unprompted**: the settings panel shipped functional `localStorage` persistence, dirty-state tracking (`Unsaved changes` / `All changes saved`), and save/error handling — none of it requested by the prompt.

When the brief says "Cinlan style" without a reference, match the craft constants and pick a context-appropriate palette. When a contract/reference supplies tokens, the contract wins.

## Color tokens (light / dark)

Soft/status backgrounds pair with their base color as foreground. Transparency uses `#RRGGBBAA`.

| Token | Purpose | Light | Dark |
|---|---|---:|---:|
| `canvas` | Application-level page background | `#F8FAFC` | `#0B1020` |
| `surface` | Default card, panel, content background | `#FFFFFF` | `#111827` |
| `surface-raised` | Elevated card, popover, menu, dialog background | `#FFFFFF` | `#172033` |
| `surface-inset` | Input wells, code blocks, recessed/grouped regions | `#F1F5F9` | `#0F172A` |
| `border-decorative` | Passive dividers, card outlines, table rules; never the only state indicator | `#E2E8F0` | `#263247` |
| `border-control` | Input/select/textarea/checkbox/segmented-control/button boundary | `#CBD5E1` | `#3B4A63` |
| `text-primary` | Headings, primary content, high-priority values | `#0F172A` | `#F8FAFC` |
| `text-secondary` | Supporting descriptions, metadata, secondary nav | `#334155` | `#CBD5E1` |
| `text-muted` | Hints, timestamps, tertiary metadata | `#64748B` | `#94A3B8` |
| `text-disabled` | Disabled labels; always paired with a disabled control state | `#94A3B8` | `#64748B` |
| `accent-base` | Primary action, selected nav, active control, key emphasis | `#2563EB` | `#60A5FA` |
| `accent-hover` | Hover state for accent controls | `#1D4ED8` | `#93C5FD` |
| `accent-active` | Pressed/keyboard-activated accent controls | `#1E40AF` | `#BFDBFE` |
| `accent-on` | Text/icon directly on an accent-filled control | `#FFFFFF` | `#0B1020` |
| `accent-soft` | Selected rows, badges, callouts, tinted backgrounds | `#DBEAFE` | `#1E3A8A` |
| `link` | Inline links, non-button navigational text | `#1D4ED8` | `#93C5FD` |
| `link-hover` | Hover/pointer-over for links | `#1E3A8A` | `#BFDBFE` |
| `focus-ring` | Visible keyboard focus; render as a 2px ring, 2px offset | `#2563EB` | `#60A5FA` |
| `success` / `success-soft` | Positive/completion/valid state; its background | `#15803D` / `#DCFCE7` | `#4ADE80` / `#14532D` |
| `warning` / `warning-soft` | Caution / potentially unsafe action; its background | `#B45309` / `#FEF3C7` | `#FBBF24` / `#78350F` |
| `danger` / `danger-soft` | Error, destructive, invalid, irreversible; its background | `#B91C1C` / `#FEE2E2` | `#F87171` / `#7F1D1D` |
| `info` / `info-soft` | Neutral explanation, progress context; its background | `#0369A1` / `#E0F2FE` | `#38BDF8` / `#164E63` |
| `scrim` | Modal/drawer backdrop over the canvas | `#0F172A66` | `#00000099` |
| `shadow` | Base shadow color for cards, popovers, menus, dialogs | `#0F172A1A` | `#00000066` |

Rules: `border-decorative` only for passive separation; `border-control` when the boundary identifies a control. Filled primary actions use `accent-on`. Status foregrounds always pair with their soft background. Status is never color-only. Release gates (WCAG 2.2 AA): normal text ≥ 4.5:1, large text ≥ 3:1, essential control boundaries/focus indicators ≥ 3:1.

## Typography

```css
--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system,
  BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas,
  "Liberation Mono", monospace;
```

Self-host both as variable WOFF2 (`Inter-Variable.woff2` weights 100–900, `JetBrainsMono-Variable.woff2` weights 100–800), `font-display: swap`, served from `/fonts/<family>/`; preload only the initial route's latin subset; load the mono family only when a code-bearing route is present. Root `16px`; `letter-spacing: 0` throughout except where noted.

| Token | Size | Weight | Line-height | Letter-spacing | Use |
|---|---:|---:|---:|---:|---|
| `display` | `3.5rem` | 800 | `3.675rem` | `-0.04em` | One dominant hero statement per screen, used at most once |
| `heading-1` | `2.5rem` | 750 | `2.75rem` | `-0.03em` | Page title — the answer to "where am I?"; one per page |
| `heading-2` | `2rem` | 700 | `2.3rem` | `-0.025em` | Independently scannable section, dialog title |
| `heading-3` | `1.5rem` | 700 | `1.8rem` | `-0.02em` | Nested region, panel/card-group title |
| `body-lg` | `1.125rem` | 400 | `1.8rem` | `0` | Introductory/decision-critical prose only |
| `body` | `1rem` | 400 | `1.5rem` | `0` | Default reading experience |
| `body-sm` | `0.875rem` | 400 | `1.269rem` | `0` | Dense supporting copy, secondary table columns |
| `label` | `0.875rem` | 650 | `1.094rem` | `0.01em` | Form labels, buttons, tabs, nav items — never paragraphs |
| `caption` | `0.75rem` | 500 | `1.013rem` | `0.02em` | Timestamps, metadata the user may safely ignore |
| `overline` | `0.688rem` | 700 | `0.859rem` | `0.08em` | Category cue above a heading; uppercase only if ≤3 words |
| `code` | `0.875rem` | 450 | `1.313rem` | `0` | Inline code, identifiers, commands (mono stack) |

Rules: keep heading order intact even when a smaller size is wanted; use `body-lg` only for introductory/decision-critical prose; never communicate an error or required instruction only in `caption`; use `overline` as a cue, not a heading substitute; use `code` only for literal copyable/executable strings, never for emphasis. Body measure `35–42rem`; paragraph bottom margin `1.5rem`; never fully justify. Do not introduce a size between tokens — fix hierarchy with spacing, weight, or grouping first.

## Spacing

25-token scale, multiples of `1px`/`2px`/`4px` only:

`space-0:0 · space-1:1 · space-2:2 · space-3:4 · space-4:6 · space-5:8 · space-6:10 · space-7:12 · space-8:14 · space-9:16 · space-10:20 · space-11:24 · space-12:28 · space-13:32 · space-14:36 · space-15:40 · space-16:48 · space-17:56 · space-18:64 · space-19:72 · space-20:80 · space-21:96 · space-22:112 · space-23:128 · space-24:160`

`space-1`/`space-2` are optical corrections only (border/focus-ring offsets), never layout spacing. `space-21`–`space-24` are hero/editorial whitespace only, never between controls or inside forms.

Assignments: icon→label `8px` (`space-5`), compact `4px`, spacious `12px`; label→input `16px`; input→validation message `4px`; field group→field group `24px` standard / `16px` dense / `32px` spacious; card padding `16/24/32px` (compact/standard/large); menu-item padding `12px` vertical; button-to-button in a group `8px`; section heading→content `28px`.

Responsive section separation:

| Viewport | Standard separation | Hero→section | Edge inset |
|---|---:|---:|---:|
| `<480px` | `48px` | `64px` | `16px` |
| `480–767px` | `56px` | `72px` | `24px` |
| `768–1023px` | `64px` | `80px` | `32px` |
| `1024–1279px` | `72px` | `96px` | `32px` |
| `1280–1439px` | `80px` | `112px` | `40px` |
| `≥1440px` | `80px` | `128px` | `48px` |

## Layout

| Breakpoint | Min width | Columns | Outer gutter | Column gap |
|---|---:|---:|---:|---:|
| `xs` | `0` | 4 | `16px` | `16px` |
| `sm` | `480px` | 4 | `24px` | `16px` |
| `md` | `768px` | 8 | `32px` | `24px` |
| `lg` | `1024px` | 12 | `32px` | `24px` |
| `xl` | `1280px` | 12 | `40px` | `24px` |
| `xxl` | `1440px` | 12 | `48px` | `32px` |

Active breakpoint = the largest whose min-width ≤ viewport width. Content width = `min(100% - 2×gutter, container-max)`. Grid uses `repeat(columns, minmax(0,1fr))`; a component must span whole columns; children get `min-width:0`; text measure never exceeds `640px` even in a wider grid area.

Containers: `reading:640px` (prose) · `form:720px` · `narrow:800px` (confirmation flows) · `content:960px` · `wide:1200px` (dashboards/tables) · `shell:1440px` (global shell) · `display:1600px` (editorial/media) · `full:none`.

Responsive shell:

| Viewport | Header | Sidebar | Content offset |
|---|---:|---|---:|
| `<480px` | `56px` | hidden, drawer `288px` | `16px` inset |
| `480–767px` | `56px` | hidden, drawer `320px` | `24px` inset |
| `768–1023px` | `64px` | collapsed rail `72px`, expands as overlay | — |
| `1024–1279px` | `64px` | persistent `256px` | `256px` |
| `1280–1439px` | `72px` | persistent `256px` | `256px` |
| `≥1440px` | `72px` | persistent `280px` | `280px` |

Sticky header: `position:sticky; top:0; z-index:40`. Persistent sidebar: `position:fixed; top:0; bottom:0; z-index:50`. Mobile drawer: `100dvh`, `z-index:60`, scrim `rgba(15,23,42,.48)` at `z-index:55`; closes on close-button, scrim click, `Escape`, or a ≥80px leading-edge swipe; body scroll locked while open; focus starts on the close button and returns to the invoking control.

## Shape

Radius: `none:0 · xs:2 · sm:4 · md:6 · lg:8 · pill:9999 · circle:50%` — plus intermediate steps `10px` (select/segmented/compact card) and `16px` (large card/drawer) when a component needs them.

Assignments: checkbox `4px`; radio `50%`; standard input/button `8px`; compact input/button `6px`; textarea `12px`; menu/tooltip `6–8px`; standard card `12px`; large card/drawer `16px`; switch track `9999px`; avatar/icon-button `50%`. Page sections `0px`, never enclosed in a card; never nest cards.

Borders — colors per theme:

| Theme | Decorative | Control | Strong | Focus ring |
|---|---|---|---|---|
| Light | `#E2E8F0` | `#CBD5E1` | `#94A3B8` | `#2563EB` |
| Dark | `#334155` | `#475569` | `#64748B` | `#60A5FA` |

`1px solid`; decorative separates surfaces/rows/cards; control defines an input's hit boundary; strong is reserved for disabled emphasis, selected rows, active nav. Borders never substitute for spacing. Focus-visible keeps the `1px` control boundary and adds a `2px` ring at `2px` offset, not counted in layout size. Disabled: `#CBD5E1`/`#F1F5F9` border/surface (light), `#475569`/`#1E293B` (dark). Error border `#DC2626`/`#F87171`; success border `#16A34A`/`#4ADE80`. No gradient borders; no border thicker than `1px` except a `2px` focus/selected indicator. `box-sizing: border-box` everywhere; a `1px` border never grows the component's external size.

Elevation — 5 levels, deliberately capped (more levels are indistinguishable at normal display size and create inconsistent stacking):

| Token | Shadow | Usage |
|---|---|---|
| `elevation-0` | none | Page background, flat cards, table rows, inputs, buttons |
| `elevation-1` | `0 1px 2px 0 rgba(15,23,42,.08)` | Cards, sticky headers, inactive raised controls |
| `elevation-2` | `0 4px 8px -2px rgba(15,23,42,.12), 0 2px 4px -2px rgba(15,23,42,.08)` | Hovered cards, dropdowns, popovers, autocomplete |
| `elevation-3` | `0 12px 24px -4px rgba(15,23,42,.16), 0 4px 8px -4px rgba(15,23,42,.10)` | Menus, dialogs, date pickers, expanded nav |
| `elevation-4` | `0 24px 48px -8px rgba(15,23,42,.24), 0 8px 16px -8px rgba(15,23,42,.12)` | Drawers, command palettes, topmost transient surfaces |

Same shadow values in both themes; dark surfaces also add a `1px #334155` border to preserve the edge. A child never exceeds its containing modal/drawer's elevation. Never stack more than one elevation shadow on a surface.

## Motion

Durations: `instant:0 · press:80 · micro:120 · fast:160 · control:180 · standard:240 · entrance:280 · large-entrance:320 · emphasized:400`.
Easings: `linear · standard cubic-bezier(0.2,0.8,0.2,1) · emphasized cubic-bezier(0.05,0.7,0.1,1) · entrance cubic-bezier(0,0,0.2,1) · exit cubic-bezier(0.4,0,1,1) · pressed cubic-bezier(0.4,0,0.2,1)`.

- Hover: `120ms standard`, color/background/border only, gated behind `(hover:hover) and (pointer:fine)`; no hover translate/scale.
- Press: `80ms pressed`, `scale(0.98)`; release `120ms standard` back to `scale(1)`.
- Focus ring: `100ms`, never delayed.
- Entry: menu/popover/dropdown `200ms entrance`, `translateY(-4px→0)` + opacity; dialog `320ms emphasized`, `scale(0.98→1)` + opacity; drawer `320ms emphasized`, edge-relative translate.
- Exit: menu/dropdown `140ms exit`; dialog `240ms exit`; drawer `240ms exit`; exits run `40–80ms` shorter than their matching entrance and start at `0ms` delay.
- No control exceeds `320ms`. No infinite animation except progress/loading/status. Animate only `transform`/`opacity`/`color`/`background`/`border`; never `transition: all`; never animate page content on initial load.
- `prefers-reduced-motion: reduce` → all durations/delays `0ms` (or `≤100ms` for essential state cues), remove motion-only transforms and loops, `scroll-behavior:auto`, loading keeps a static visual + status label. State updates, focus restoration, and cleanup must work without `animationend`/`transitionend`.

## Iconography and imagery

Icon set: Lucide, `2px` stroke, `stroke-linecap/linejoin: round`, outline by default (filled only for brand marks/media controls/status with a documented filled variant), inherits `currentColor` except semantic status icons, decorative icons `aria-hidden="true"`, icon-only controls need an accessible name and a `≥44×44px` hit area.

Sizing grid: `12px`(dense metadata) · `16px`(compact controls/badges) · `20px`(standard buttons/inputs/menus/nav) · `24px`(primary nav/toolbar/standalone) · `32px`(empty states) · `40px`(large empty states) · `48px`(hero symbolic graphics only). Pair `12/14/16/20/24px` text with `12/16/20/24/32px` icons respectively.

Choosing the asset: icon for action/navigation/status (paired with text, never color-only); illustration (`160×160px`) for branded/educational empty states, max 1 per onboarding step at `≤320px` width; photography when the real subject/environment matters; one dominant media treatment per section — never mix illustration and photography in one card; diagrams cap at 6 visual primitives before splitting.

Image treatment: explicit aspect ratio always reserved before load (`1:1` avatar, `4:3` thumbnail, `16:9` card media, `3:2` feature media, hero `21:9`/`16:9`/`4:3` by breakpoint); `object-fit: cover` for thumbnails/media, `contain` for logos/diagrams/screenshots over a neutral background; radius on the wrapper with `overflow:hidden`; text-over-image needs a scrim (`linear-gradient` or `rgba(15,23,42,.48)` full scrim) meeting `4.5:1`/`3:1`; decorative images `alt=""`, informative images ≤120 characters of alt text; `loading="lazy"` below the fold, `decoding="async"` for content images.
