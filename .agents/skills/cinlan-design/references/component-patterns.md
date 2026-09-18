# Component patterns — Cinlan Design

Use the product's existing components first. These patterns are generic fallbacks using the semantic roles in [design tokens](design-tokens.md); their only default value source is [tokens.css](tokens.css). They do not define a separate palette, font scale, or radius system. Keep required states explicit and implement only behaviors relevant to the task.

## Shared foundation

Load or map the token layer before these examples. Scope selectors to the artifact when integrating into a host application.

```css
* { box-sizing: border-box; }
:focus-visible {
  outline: var(--focus-width) solid var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.button, .text-input, .nav-item, .tab {
  min-height: max(var(--control-height), var(--target-min));
  font: var(--font-ui);
}
```

Visual height and hit area follow the [target policy](design-tokens.md#control-size-and-hit-area). The examples enlarge the element to fit the default hit area; a smaller visual face requires a separately measured inner element and reserved space. Fine-pointer compact variants must opt into the documented exception. Never let extended hit areas overlap.

Hover styles apply only inside `@media (hover: hover) and (pointer: fine)`. Pressed states override hover; disabled/loading suppress both. Keyboard focus remains visible during validation and loading. Controls do not shift or resize on press.

## Buttons

```css
.button {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--space-sm); min-width: var(--target-min); max-width: 100%;
  padding: var(--space-sm) var(--space-lg);
  border: var(--border-width) solid var(--border-control);
  border-radius: var(--radius-control);
  background: var(--surface); color: var(--text-primary);
  font: var(--font-label); cursor: pointer; overflow-wrap: anywhere;
}
.button .icon { width: var(--icon-size); height: var(--icon-size); flex-shrink: 0; }
.icon-button { padding: var(--space-sm); aspect-ratio: 1; }
.button-primary { background: var(--accent-base); border-color: var(--accent-base); color: var(--accent-on); }
.button-danger { background: var(--danger); border-color: var(--danger); color: var(--danger-on); }
.button:disabled {
  background: var(--surface-disabled); border-color: var(--border-disabled);
  color: var(--text-disabled); cursor: not-allowed;
}
```

| Variant | Hover background / border | Pressed background / border |
|---|---|---|
| Primary | `--accent-hover` for both | `--accent-active` for both |
| Secondary | `--surface-hover` / `--border-control-hover` | `--surface-active` / `--border-control-active` |
| Ghost | `--surface-hover` / transparent | `--surface-active` / transparent |
| Destructive | `--danger-hover` for both | `--danger-active` for both |

Ghost default: transparent background/border with `--text-secondary`; hover/pressed text uses `--text-primary`. Give each task region one most prominent action. Icon-only commands need an accessible name and a discoverable explanation. Native disabled controls expose their unavailable state; explain a disabled primary action nearby.

Loading preserves dimensions and the accessible name, sets `aria-busy="true"`, and prevents duplicate activation. A decorative spinner uses `currentColor` and `--duration-spinner`; reduced motion uses a static indicator plus status text. Do not announce success until the action succeeds.

## Cards and panels

```css
.card {
  display: grid; gap: var(--space-md); min-width: 0;
  padding: var(--card-padding); border: var(--border-width) solid var(--border-decorative);
  border-radius: var(--radius-card); background: var(--surface); box-shadow: var(--elevation-flat);
}
.panel {
  min-width: 0; padding-block: var(--space-xl);
  border-bottom: var(--border-width) solid var(--border-decorative);
}
```

Use unframed sections for ordinary page groups and cards for meaningful repeated items. Avoid redundant nested borders. Static cards get no hover behavior or `tabindex`. If a card is an action, provide native link/button semantics and `--border-control` when the boundary identifies the action. Selected cards use `--accent-soft`, `--accent-text`, and a visible selection marker; color alone is insufficient. Loading preserves the expected geometry.

## Forms and inputs

```css
.form { width: 100%; max-width: var(--form-max); display: grid; gap: var(--group-gap); }
.field { display: grid; gap: var(--field-gap); min-width: 0; }
.field label { font: var(--font-label); color: var(--text-primary); }
.helper { margin: 0; font: var(--font-ui); color: var(--text-secondary); }
.text-input {
  width: 100%; padding: var(--space-sm) var(--space-md);
  border: var(--border-width) solid var(--border-control); border-radius: var(--radius-control);
  background: var(--surface); color: var(--text-primary);
}
.text-input::placeholder { color: var(--text-muted); opacity: 1; }
.text-input:active::placeholder { color: var(--text-secondary); }
textarea.text-input { min-height: 6em; resize: vertical; }
```

| State | Treatment |
|---|---|
| Hover / pressed | `--border-control-hover` / `--border-control-active`; pressed fill `--surface-active` and placeholder `--text-secondary` |
| Focus | `--focus-ring` outline; preserve an error/success boundary when present |
| Disabled | Disabled token family and native `disabled` |
| Read-only | `--surface-inset`, `--text-secondary`, native `readonly`; retain selection/copy |
| Error | `--danger` border and message, error icon, `aria-invalid`, linked error description |
| Validated | `--success` border/message plus check icon and text when confirmation matters |
| Pending | Busy field group, reserved status slot, retained value |

Use associated labels, native requiredness, and linked helper/error text. Validate on blur and submit; after a failure, update feedback as the user corrects the field. Failed submission focuses an error summary linking to invalid fields, or the first invalid field for a short form without a summary. Never erase entered values after a request or validation failure.

Use the host select/menu primitive or a native select. A custom popup needs full keyboard behavior, collision handling, `--surface-raised`, `--radius-overlay`, and `--elevation-popup`. Options use the same target policy and selected tokens as other controls. Do not add a UI library solely to match this example.

Checkbox/radio visible size uses `--binary-size`; switch track/thumb use `--switch-width`, `--switch-height`, and `--switch-thumb`. Associated label rows provide the hit area. Unchecked boundaries use `--border-control`, checked fill/mark use `--accent-base`/`--accent-on`. Checkbox radius is `--radius-small`, radio/thumb `--radius-circle`, switch `--radius-pill`. Expose checked/indeterminate state and group related choices with fieldset/legend.

## Navigation and tables

Inherit shell geometry and navigation from the product. For a new shell, use the shared shell/layout tokens and choose breakpoints based on available content width. Current navigation uses selected tokens plus `aria-current="page"` and a visible marker. Tabs use tablist/tab/tabpanel semantics, `aria-selected`, and the expected roving keyboard behavior. Breadcrumbs use a labeled nav and a non-link current item.

Tables use `--font-ui`, decorative row dividers, and neutral hover/selected tokens. Numeric cells align to the end and use tabular numbers. Rows themselves need not be tab stops: links, selection controls, and action buttons do. Reserve enough row height for their hit areas. Compact rows are permitted only under the target policy. Keep full-value access for clipped data, a scoped horizontal scroll region when needed, and stable headers. Sort buttons expose sort direction; selection state includes text or a checkbox. Loading, empty, filtered-empty, and failure states keep the table context and provide the relevant next action.

## Dialogs, notifications, and tooltips

Reuse the host dialog primitive. Generic dialog styling uses `--surface-raised`, `--border-decorative`, `--radius-overlay`, `--elevation-overlay`, and `--scrim`. Size to content and viewport; let the body scroll while title/actions remain reachable. Focus enters the dialog, stays inside while modal, and returns to the trigger. Background is inert; Escape and a named close/cancel control dismiss. Destructive or unsaved-change confirmations do not dismiss on backdrop clicks; Cancel receives initial focus for destructive confirmation.

A command palette can reuse the same dialog and selection patterns, with search, keyboard result navigation, and cancellation of obsolete requests. Use the application's existing shortcut and search behavior.

Toasts use `--radius-card` and `--elevation-popup`. Status foreground/background pairs come from the token layer and include an icon and message. Routine updates use a polite status region; urgent errors use an alert. Never move focus into a toast automatically. The close control follows the target policy. Persistent or actionable notices remain until dismissed; transient notices need enough reading time and a route to recover the information.

Tooltips use `--inverse-surface`/`--inverse-text`, `--radius-control`, and `--z-tooltip`. Open on focus without delay and on hover after a short delay; Escape dismisses, and pointer movement into the tooltip keeps it open. Link the description to its trigger. Essential information remains available outside the tooltip; interactive content belongs in a popover.

## Validation

Check the requested states and viewport using [quality checks](quality-checklist.md) and [visual verification](verification.md). A component's token compliance does not establish that a complete page has the right proportions, hierarchy, or density.
