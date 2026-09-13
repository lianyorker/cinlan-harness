# Component Patterns — Cinlan Design

Concrete CSS rules distilled from gpt-6-astra (reasoning=max). Values reference `design-tokens.md`. Every state below is explicit — do not infer a state that isn't listed.

## Shared foundation

```css
* { box-sizing: border-box; letter-spacing: 0; }
:focus-visible { outline: 2px solid #2563EB; outline-offset: 2px; }
```

Hover only applies inside `@media (hover:hover) and (pointer:fine)`. Active overrides hover. Disabled and loading suppress hover/active changes. Focus is independent of validation — an invalid field keeps its focus outline. Pressing never changes a control's dimensions or applies translation.

## Buttons

```css
.button { display:inline-flex; align-items:center; justify-content:center; position:relative;
  gap:8px; min-height:40px; max-width:100%; padding:9px 16px; border:1px solid transparent;
  border-radius:6px; font:600 14px/20px "Inter",sans-serif; cursor:pointer; overflow-wrap:anywhere; }
.button .icon { width:16px; height:16px; flex-shrink:0; }
.icon-button { width:40px; height:40px; padding:0; flex-shrink:0; }
```

| Variant | Default | Hover | Active |
|---|---|---|---|
| Primary | `color:#FFF;background:#0F766E;border-color:#0F766E` | `#115E59` | `#134E4A` |
| Secondary | `color:#18181B;background:#FFF;border-color:#71717A` | `bg:#F4F4F5;border:#52525B` | `bg:#E4E4E7;border:#3F3F46` |
| Ghost | `color:#3F3F46;background:transparent;border:transparent` | `color:#18181B;bg:#F4F4F5` | `color:#18181B;bg:#E4E4E7` |
| Destructive | `color:#FFF;background:#B91C1C;border-color:#B91C1C` | `#991B1B` | `#7F1D1D` |

Disabled (all variants): `color:#71717A;background:#F4F4F5;border-color:#D4D4D8;cursor:not-allowed;box-shadow:none`, native `disabled`. Focus: `outline:2px solid #2563EB;outline-offset:2px`, keeps the variant's background/border. Loading: `aria-busy="true" aria-disabled="true"`, label+icon `opacity:0` but keep layout and accessible name, centered `16px` spinner (`border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 800ms linear infinite`, `aria-hidden="true"`).

Rules: one primary per region; labels start with a verb; icon-only ≥40px target + accessible name + tooltip.

## Cards and panels

```css
.card  { background:#FFF; border:1px solid #E4E4E7; border-radius:6px; padding:16px;
         display:grid; gap:12px; box-shadow:none; min-width:0; }
.panel { width:100%; min-width:0; padding:24px 0; border:0; border-bottom:1px solid #E4E4E7;
         border-radius:0; background:transparent; }
```

Interactive card hover `border-color:#A1A1AA`; active `bg:#FAFAFA;border:#71717A`; selected `bg:#F0FDFA;border:#0F766E`; disabled `bg:#F4F4F5;border:#D4D4D8;color:#71717A`. Static cards get no hover/`tabindex`. Loading retains card dimensions, replaces content with matching skeleton blocks. Panel heading `18px/24px` weight 600, margin `0 0 16px`; below `640px` panel padding-block `16px`. Never nest cards; page sections stay unframed (top-border panels), cards only for repeated items.

## Forms and inputs

```css
.form { width:100%; max-width:640px; display:grid; gap:16px; }
.field { display:grid; grid-template-columns:minmax(0,1fr); row-gap:6px; min-width:0; }
label { font-size:14px; line-height:20px; font-weight:500; color:#18181B; }
.helper { min-height:16px; margin-top:4px; font-size:12px; line-height:16px; color:#52525B; }
.text-input { width:100%; height:40px; padding:9px 40px 9px 12px; border:1px solid #71717A;
  border-radius:6px; background:#FFF; color:#18181B; font:400 14px/20px "Inter",sans-serif; }
textarea.text-input { height:96px; min-height:96px; max-height:320px; resize:vertical; padding:9px 12px; }
```

| State | Treatment |
|---|---|
| Hover | `border-color:#52525B` |
| Active | `bg:#FAFAFA;border:#3F3F46` |
| Focus | `bg:#FFF;border:#0F766E;outline:2px solid #2563EB;outline-offset:2px` |
| Disabled | `bg:#F4F4F5;border:#D4D4D8;color:#71717A;cursor:not-allowed` |
| Read-only | `bg:#FAFAFA;border:#D4D4D8;color:#52525B;cursor:text`, native `readonly` |
| Error | `border-color:#B91C1C`, helper `color:#B91C1C`, `CircleAlert` 16px, `aria-invalid="true"`, error id in `aria-describedby` |
| Validated | `border-color:#15803D`, helper `color:#166534`, `CircleCheck` 16px, `aria-invalid="false"` |
| Pending | `aria-busy="true"` on the field group, 16px spinner in the reserved status slot, retains value |

Reserved trailing status-icon slot: `16px` square, `12px` from the inline end. Required uses native `required` (or `aria-required="true"` for custom controls); optional labels append `(optional)`. Validate on blur + submit; after invalid, revalidate on input with `150ms` debounce; on failed submit, focus an error summary linking to invalid fields.

### Select

Radix Select. Trigger follows text-input styling, `min-height:40px;height:auto;padding-inline-end:68px`, chevron `16px` at end, status icon `16px` at `40px` from end. Open: `border-color:#0F766E`. Popup: `width:var(--radix-select-trigger-width);max-width:calc(100vw - 32px);max-height:256px;overflow-y:auto;padding:4px;background:#FFF;border:1px solid #D4D4D8;border-radius:6px;box-shadow:0 8px 24px #18181B1F`. Options `min-height:36px;padding:8px 12px;border-radius:4px`; hover/keyboard-highlight `bg:#F4F4F5`; selected `bg:#F0FDFA;color:#115E59` + `16px` check; active `bg:#CCFBF1`; disabled `color:#71717A`.

### Checkbox, radio, switch

```css
input[type="checkbox"], input[type="radio"] { appearance:none; width:20px; height:20px;
  flex:0 0 20px; margin:0; border:1px solid #71717A; background:#FFF; }
input[type="checkbox"] { border-radius:4px; }
input[type="radio"] { border-radius:50%; }
```

Checked: `background:#0F766E;border-color:#0F766E` + white Lucide `Check` (checkbox, `14px`) or centered `8px` dot (radio). Indeterminate checkbox: same colors + Lucide `Minus`; set native `.indeterminate`. Switch track `36×20px`, `border-radius:9999px`, `background:#71717A`; thumb `16px` circle, `translateX(0)→translateX(16px)` on check over `120ms cubic-bezier(0.2,0,0,1)`, checked track `#0F766E`. Unchecked hover `bg:#F4F4F5;border:#52525B`, active `bg:#E4E4E7;border:#3F3F46`; checked hover `#115E59`, active `#134E4A`; switch off hover `track #52525B` active `#3F3F46`, on hover `#115E59` active `#134E4A`. Disabled: `bg:#F4F4F5;border:#D4D4D8`, mark `#71717A`; disabled switch track `#D4D4D8` thumb `#71717A`. Label target `min-height:40px;gap:8px`; group spacing `8px`; shared `name` + `<fieldset>`/`<legend>`. Read-only groups render via `<output>`.

## Navigation

```css
.topnav { position:sticky; top:0; z-index:20; height:56px; display:flex; align-items:center;
  gap:24px; padding:0 24px; background:#FFF; border-bottom:1px solid #E4E4E7; }
.sidebar { position:sticky; top:56px; height:calc(100dvh - 56px); overflow-y:auto;
  padding:16px 12px; background:#FAFAFA; border-inline-end:1px solid #E4E4E7; }
.nav-item { display:flex; align-items:center; gap:10px; min-height:40px; padding:8px 12px;
  border-inline-start:2px solid transparent; border-radius:4px; color:#52525B; }
```

Desktop shell: `grid-template-columns: 232px minmax(0,1fr)`. Below `1024px`: modal drawer `position:fixed;inset:0 auto 0 0;width:min(280px,calc(100vw - 32px));z-index:90`. Nav item hover `color:#18181B;bg:#F4F4F5`; active `bg:#E4E4E7`; current `color:#115E59;bg:#F0FDFA` + `aria-current="page"` + `border-inline-start-color:#0F766E`; current hover `bg:#CCFBF1`; disabled `color:#71717A;aria-disabled="true"`, no `href`, removed from tab order.

### Tabs

`display:flex;overflow-x:auto;border-bottom:1px solid #E4E4E7`. Tab `min-width:48px;height:40px;padding:0 12px;border-bottom:2px solid transparent;color:#52525B;font:500 14px/20px`. Hover `bg:#F4F4F5;color:#18181B`; selected `color:#0F766E;border-bottom-color:#0F766E`; focus outline `outline-offset:-2px`. Use `tablist`/`tab`/`tabpanel`, `aria-selected`, `aria-controls`, roving `tabindex`.

### Breadcrumbs

`<nav aria-label="Breadcrumb"><ol>`, `font-size:12px;line-height:16px`, links `color:#52525B`, hover `color:#0F766E` underline offset `3px`, current item non-link `color:#18181B` + `aria-current="page"`, separator Lucide `ChevronRight` `12px` `#71717A` `aria-hidden="true"`.

## Tables

```css
table { width:100%; min-width:720px; border-collapse:collapse; font-size:13px; line-height:20px; }
th { position:sticky; top:0; height:36px; padding:8px 12px; background:#FAFAFA;
     color:#52525B; font-weight:600; text-align:start; border-bottom:1px solid #D4D4D8; }
td { height:40px; padding:8px 12px; border-bottom:1px solid #E4E4E7; vertical-align:middle; }
```

Selection col `44px`; actions `48px`; numeric `128px`; compact rows `height:32px;padding:4px 8px`. Row hover `bg:#FAFAFA`; selected `bg:#F0FDFA`; selected hover `bg:#CCFBF1`. Rows aren't keyboard targets; links/checkboxes/buttons are. Sortable headers = native buttons with `16px` icon, `aria-sort` cycling `none/ascending/descending`. Numeric cells `text-align:end;font-variant-numeric:tabular-nums lining-nums`. Status badge always includes text, never color alone. Missing value renders `Not available`, `color:#71717A`.

Loading: 8 skeleton rows, bars `height:12px;width:120px;border-radius:4px;background:#E4E4E7`; refresh keeps rows + a reserved toolbar spinner. Empty/error span all columns, `height:160px;text-align:center`: `No records.` / filtered `No results.` / error `Data could not be loaded.` + `Retry`. Toolbar `min-height:48px`; pagination `min-height:48px`, default page size `25`.

## Modals and dialogs

Use Radix Dialog. Backdrop `position:fixed;inset:0;background:#18181B66;z-index:80`. Dialog `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 32px));max-height:min(720px,calc(100dvh - 32px));grid-template-rows:auto minmax(0,1fr) auto;background:#FFF;border:1px solid #E4E4E7;border-radius:8px;box-shadow:0 16px 48px #18181B33;z-index:90`. Header `padding:20px 24px`, title `20px/28px` weight 600. Body `padding:0 24px 24px;overflow:auto`. Footer `padding:16px 24px;border-top:1px solid #E4E4E7;justify-content:flex-end;gap:8px`. Close button Lucide `X` `20px`, target `40px`. Confirmation dialogs `min(400px,calc(100vw - 32px))`.

`aria-modal="true"` + `aria-labelledby`; trap focus, inert background, lock scroll, return focus to trigger. Initial focus: first field, or Cancel for destructive confirmation. `Escape` dismisses; backdrop dismisses informational dialogs only — never destructive/unsaved-change confirmations.

Enter: backdrop + dialog opacity `0→1`, dialog `translateY(8px→0)`, `160ms cubic-bezier(0.2,0,0,1)`. Exit: opacity `1→0`, `120ms`. Submitting uses the button loading state; request errors show inline above the footer, retain all entered values.

## Toasts, alerts, banners

```css
.toast-stack { position:fixed; right:24px; bottom:24px; width:360px; display:grid; gap:8px; z-index:100; }
.toast { display:grid; grid-template-columns:20px minmax(0,1fr) 32px; gap:12px; min-height:64px;
  padding:12px 16px; border:1px solid; border-radius:6px; box-shadow:0 4px 16px #18181B1F; }
.alert { display:grid; grid-template-columns:20px minmax(0,1fr); gap:12px; padding:12px 16px;
  border:1px solid; border-inline-start-width:3px; border-radius:4px; font-size:14px; }
```

Below `640px` toasts go full-width, `left/right:16px`. Max 3 visible, additional queue FIFO. **No automatic dismissal for any severity.** Close target `32px` (`44px` coarse pointer). Never move focus into a toast automatically.

| Status | Colors | Icon |
|---|---|---|
| Success | `bg:#F0FDF4;color:#166534;border:#15803D` | `CircleCheck` |
| Info | `bg:#EFF6FF;color:#1D4ED8;border:#2563EB` | `Info` |
| Warning | `bg:#FEFCE8;color:#854D0E;border:#A16207` | `TriangleAlert` |
| Error | `bg:#FEF2F2;color:#B91C1C;border:#B91C1C` | `CircleAlert` |

Success/info: `role="status"`. Errors: `role="alert"`. Warnings: `role="status"`. Static notices get no live-region role. Icon `20px` stroke `2px`.

## Signature components

### Command palette

`cmdk` inside Radix Dialog. Container `position:fixed;top:96px;left:50%;transform:translateX(-50%);width:min(640px,calc(100vw - 32px));height:min(480px,calc(100dvh - 112px));background:#FFF;border:1px solid #D4D4D8;border-radius:8px;box-shadow:0 16px 48px #18181B33;z-index:90`. Search row `height:56px;padding:0 16px;border-bottom:1px solid #E4E4E7`, icon `20px`, input `16px/24px`. Result row `min-height:40px;grid-template-columns:20px minmax(0,1fr);padding:8px 12px;border-radius:4px`; default `color:#18181B`; hover `bg:#F4F4F5`; keyboard-selected `bg:#F0FDFA;color:#115E59`; active `bg:#CCFBF1`. `Ctrl/Cmd+K` opens; remote search debounce `150ms`, aborts superseded requests; no visible shortcut legend.

### Tooltips

Radix Tooltip, `max-width:240px;padding:6px 8px;background:#18181B;color:#FFF;border-radius:4px;font-size:12px;z-index:110`. Placement above, collision padding `8px`, offset `8px`. Pointer open delay `400ms`; keyboard-focus delay `0ms`; close delay `100ms`. `role="tooltip"` + `aria-describedby`; `Escape` dismisses; hovering the tooltip keeps it open. Interactive content belongs in a popover, not a tooltip.

## Control behavior rules

- Lucide icons throughout; icon buttons always get an accessible name.
- Modes → segmented controls; views → tabs; binary settings → checkbox/switch; option sets → menus.
- Loading indicators always preserve the control's dimensions.
- Density: desktop controls `40px`, icon buttons `40×40`, table rows `40px` (compact `32px`). `(pointer:coarse)` → `44px` minimum on every actionable target, table rows `≥48px`.

## Default signature choices (when no brief specifies otherwise)

| Decision | Default |
|---|---|
| Theme | Light, `color-scheme:light`. Canvas `#FAFAFA`, surface `#FFF`, text `#18181B`/`#52525B`/`#71717A`, separators `#E4E4E7`. No automatic dark switching unless requested. |
| Accent | `#0F766E` / hover `#115E59` / active `#134E4A` / selected surface `#F0FDFA` (white text on it ≈ 5.47:1). Focus independently blue `#2563EB`; destructive `#B91C1C`; warning `#854D0E`. |
| Typography | Self-hosted Inter, weights 400/500/600/700, `font-display:swap`, fallback `Arial`. Body `14px/20px`; page title `24px/32px` w600; section `18px/24px` w600; label `14px/20px` w500; metadata `12px/16px`. `letter-spacing:0` globally, no viewport-scaled sizing. |
| Spacing | `2/4/6/8/12/16/24/32/48/64px`. Content `max-width:1440px;padding:24px` (`16px` below 640px). Related controls `8px`; field groups `16px`; sections `24px`; page groups `32px`. |
| Density | Default `40px`; compact `32px`; large `48px`. Coarse pointer → `44px` minimum across buttons/inputs/tabs/pagination/breadcrumbs/binary controls; table rows `≥48px`. |
| Corners | Buttons/inputs/menus/cards/toasts `6px`; dialogs/command palette `8px`; tooltips/badges/checkbox/nav items `4px`; sections/banners/tables/tabs `0`; radio/spinner `50%`; switch `9999px`. |
| Borders/elevation | Default surface `1px solid #E4E4E7`; field border `1px solid #71717A`. Static cards `box-shadow:none`. Menus `0 8px 24px #18181B1F`; toasts `0 4px 16px #18181B1F`; dialogs `0 16px 48px #18181B33`. |
| Motion | Controls transition only `color/background-color/border-color`, `120ms cubic-bezier(0.2,0,0,1)`. Overlay entry `160ms`, exit `120ms`. Spinner `800ms linear infinite`. `prefers-reduced-motion` → `animation:none;transition:none;scroll-behavior:auto`. |
| Layering | Base `0`, sticky nav `20`, dropdown `40`, modal backdrop `80`, dialog/drawer `90`, toasts `100`, tooltips `110`. |
| Semantic markup | Always `<header>`, labeled `<nav>`, one `<main id="main">`, correct heading order, `<button type="button">`, `<a href>`, `<form>`, associated `<label>`, `<fieldset>`/`<legend>`, native `<table>` with scoped headers. Zero clickable `<div>`/`<span>`. |
| Accessible names | Every icon-only command names its action (`Save`, `Close dialog`). Expanders expose `aria-expanded`/`aria-controls`; toggles `aria-pressed`; async regions `aria-busy`; current nav `aria-current`; invalid fields `aria-invalid` + linked error text. Zero positive `tabindex`. |
| Loading defaults | Set busy state immediately; spinner appears after `150ms`, then stays visible ≥`300ms`. Initial loads use geometry-matched skeletons; refreshes retain existing data. Indeterminate work never shows an invented percentage. |
| Empty/failure defaults | Always implement initial empty, filtered empty, request failure, validation failure, permission denial, offline. Never erase entered values after a failure. |
| Validation policy | Untouched fields show no error. Validate on blur + submit, then on input with `150ms` debounce. Failed submission focuses an error summary linking to invalid fields. |
| Destructive actions | Explicit verb (`Delete record`), confirmation names the record + irreversible consequence, Cancel gets initial focus, never preselected/auto-executed/auto-retried. Reversible actions expose `Undo` instead. |
| Acceptance checks | `320×568`, `390×844`, `768×1024`, `1280×800`, `1920×1080`; `200%`/`400%` zoom; keyboard-only; reduced motion; forced colors; coarse pointers; every state (loading/empty/error/disabled/focus/validated). Zero automated a11y violations before release. |
