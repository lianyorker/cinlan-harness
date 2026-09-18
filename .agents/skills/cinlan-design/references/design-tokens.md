# Design tokens — Cinlan Design

[Tokens CSS](tokens.css) is the single source of generic UI values in this skill. [Component patterns](component-patterns.md) consume its variables; page examples describe composition and density without defining a competing color or radius system. These defaults are a starting point, not measured brand evidence or a universal aesthetic.

## Adopting tokens

Follow the [decision order](../SKILL.md#decision-order). In an existing product, reuse its token owner and map the roles below to existing names; do not load this stylesheet over an established theme. For a new artifact, copy or import the defaults into one project token owner. Inline that layer only when a self-contained export is requested. Keep the project design document as a map of decisions and provenance, not a second table of raw values.

The generic accent is blue. An approved green theme maps the whole accent family, including foreground, hover, pressed, soft fill, link, and focus roles, in the project token owner. Do not leave a component-specific green button or an unrelated blue focus rule behind. Brand colors may differ from status colors; status always carries an additional label, icon, or shape.

## Color roles

| Role | Use |
|---|---|
| `--canvas` / `--surface` / `--surface-raised` / `--surface-inset` | Page, panels, overlays, recessed groups |
| `--surface-hover` / `--surface-active` | Neutral control feedback |
| `--text-primary` / `--text-secondary` / `--text-muted` | Required content, supporting text, metadata; all remain readable |
| `--border-decorative` | Passive dividers and static cards; never the sole control boundary |
| `--border-control` / `--border-control-hover` / `--border-control-active` | Essential input and control boundaries |
| `--accent-base` / `--accent-hover` / `--accent-active` / `--accent-on` | Filled actions and their text/icon foreground |
| `--accent-soft` / `--accent-soft-hover` / `--accent-text` | Selected rows and controls with readable foreground |
| `--success` / `--warning` / `--danger` / `--info` and their `-soft` roles | Status foreground and background pairs |
| `--danger-on` / `--danger-hover` / `--danger-active` | Destructive filled controls |
| `--focus-ring` | Keyboard focus, paired with focus width and offset |
| `--inverse-surface` / `--inverse-text` / `--inverse-muted` / `--inverse-border` | Tooltips or deliberately inverted regions |
| `--surface-disabled` / `--border-disabled` / `--text-disabled` | Inactive controls, with native disabled behavior and an explanation when needed |

Use these names as CSS custom properties, for example `var(--surface)`. The default stylesheet has explicit light and dark themes; inherit the product's theme-switching behavior. Do not force dark mode or a new font into a reference task.

Normal text must reach 4.5:1; large text (at least 24px regular or 18.66px bold) must reach 3:1. Essential boundaries, meaningful graphical marks, and focus indicators must reach 3:1 against adjacent colors. Measure actual composites and states, including dark mode and raised/inset backgrounds. A decorative divider need not reach 3:1 when it conveys no essential control information. Disabled controls are exempt from the WCAG contrast minimum; explain unavailable actions and keep their labels legible. A translucent glow may supplement a visible focus ring, but cannot replace it.

## Typography and spacing

Use `--font-body` for reading prose, `--font-ui` for compact interface content, `--font-label` for controls, `--font-caption` for nonessential metadata, and the page/section title roles for hierarchy. Smaller UI text is a deliberate density choice, not a reason to shrink long prose or essential errors. Preserve semantic heading order independent of rendered size. Verify 200% text resizing and the standard text-spacing overrides without clipping.

Inherit the product font stack and language coverage. For a new design, use available system fonts or supplied font assets; do not claim a specific typeface rendered unless it loaded. Fixed viewport measurements must record the actual font. Intermediate weights are optional only when the font supports them.

Use the named space scale and semantic field/group/section gaps from the CSS. Assign new page-specific geometry once in the project owner if a measured reference or layout needs it. Label-to-control and field-to-message spacing use `--field-gap`. Borders and focus offsets are separate from layout spacing. Avoid enforcing a marketing section gap on a settings form.

## Shape and elevation

| Role | Default assignment |
|---|---|
| `--radius-small` | Checkbox, badge, navigation highlight |
| `--radius-control` | Buttons, inputs, textarea, tooltip |
| `--radius-card` | Repeated item cards and toasts |
| `--radius-overlay` | Menu, popover, dialog, command palette, drawer |
| `--radius-feature` | Large feature/media frame in a new editorial composition |
| `--radius-pill` / `--radius-circle` | Switch track or pill / circular mark |

The CSS assigns distinct 6/8/12/16px roles to control/card/overlay/feature. They are not competing defaults for the same component. An inherited or measured assignment can replace a role for the project; change its owner, not individual examples. Page sections can remain unframed; add a card only when the grouping has a purpose. Avoid redundant nested frames.

Use `--elevation-flat` for normal content, `--elevation-popup` for small floating elements, and `--elevation-overlay` for dialogs. One elevation value per element; focus indication is separate. Dark overlays still need a visible edge. Do not add a shadow to every component.

## Control size and hit area

The visible control, the clickable/focusable element, and the layout space reserved around it are separate measurements. The default visual height is `--control-height` (40px); the default hit area is at least `--target-min` (44px) in both dimensions. A small checkbox or switch uses an associated clickable label row. A button may use a larger element or an inner visual face; an expanded hit area must remain inside reserved space and never overlap a neighbor or be clipped.

Compact desktop UI can use `--control-height-compact` (32px) with a documented fine-pointer target policy: at least `--target-compact-min` (24px) in both dimensions and at least 8px between separate targets. This is a deliberate density exception, not the generic default. Apply compact target overrides only within a fine-pointer media query; coarse-pointer targets remain at least 44px. Preserve a conforming existing product policy rather than enlarging every visible control to 44px. Inline text links and equivalent native controls need context-specific accessibility review; do not enlarge running prose into button rows.

An interactive table row must reserve enough height for its largest target; do not place a 44px hit area in consecutive 32px rows. Record both bounds during verification. Focus width and offset are defined in CSS; ensure the indicator remains visible in scroll containers and overlays.

## Layout and motion

Generic shell dimensions, content/form limits, layering, durations, and easing values live in [tokens.css](tokens.css). Responsive breakpoints and page geometry depend on the host or chosen page example; do not combine several shell specs. Controls keep stable dimensions on hover and press. Use color/border feedback by default; physical motion is an explicit choice described in [motion design](motion-design.md).

Remove nonessential motion under reduced motion and preserve focus, state updates, and cleanup without relying on animation events. Exit timing should be shorter than entry for the same element. One task can include different transition types; do not substitute animation quality for layout verification.
