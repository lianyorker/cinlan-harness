# Quality checks — Cinlan Design

Apply the checks relevant to the task and report measured results. [Design tokens](design-tokens.md) owns the default roles and target policy; the project's resolved design decisions govern inherited or reference-specific values. [Visual verification](verification.md) defines the required comparison procedure. This checklist does not certify aesthetic quality or model performance.

## Evidence and visual fit

- [ ] Task mode and designated reference are recorded; supplied, measured, inherited, and provisional decisions are distinguished.
- [ ] Every shared color, radius, type, and spacing role resolves to the project token owner; components do not redefine a second theme.
- [ ] Screenshots use the fixed viewport, fixture, font, theme, and state recorded for the baseline.
- [ ] The actual screenshots have been opened and compared side by side; measured geometry and observed differences are recorded.
- [ ] Shell width, content edges, group spacing, text wrapping, visible rows, and control weight fit the reference or declared new-design goals.
- [ ] All relevant states share the same hierarchy and density; loading, empty, error, and dialogs are not unrelated templates.

## Contrast and state cues

- [ ] Normal text measures at least 4.5:1; large text (24px regular or 18.66px bold) at least 3:1.
- [ ] Essential boundaries, meaningful icons/chart marks, and focus indicators measure at least 3:1 against adjacent colors.
- [ ] Decorative borders are used only for passive separation. A pale divider does not serve as the only control boundary.
- [ ] Actual composited colors are measured, including opacity, imagery, raised/inset backgrounds, and each supported theme.
- [ ] Hover, pressed, selected, checked, and invalid states are distinguishable. Essential state indicators meet contrast requirements; no arbitrary 3:1 difference between every pair of transient background colors is required.
- [ ] Status and selection have text, icon, or shape cues beyond color. Body links have a non-color distinction.
- [ ] Placeholders are readable and never substitute for labels. Disabled controls remain identifiable, with an explanation for unavailable primary actions; their exempt contrast is not used for active controls.

## Typography, geometry, and targets

- [ ] Reading prose and compact UI use their intended type roles; the actual font loaded. A universal 16px minimum is not imposed on an inherited compact interface.
- [ ] Text remains usable at 200% resize and with line-height 1.5, paragraph spacing 2em, letter-spacing 0.12em, and word-spacing 0.16em overrides.
- [ ] Ordinary content reflows at 320 CSS px; 200%/400% zoom produces no lost content or obscured controls. Two-dimensional data can use a labeled scroll region.
- [ ] Required labels/errors/values wrap or have an accessible full-value path. Reading lines target 45–75 characters and stay below 80 where practical.
- [ ] Visible control bounds and clickable bounds are measured separately. Default targets reach 44×44px; documented fine-pointer compact targets meet the [compact policy](design-tokens.md#control-size-and-hit-area), and coarse-pointer targets reach 44×44px.
- [ ] Targets never overlap, extend into another row, or get clipped. Verify keyboard focus and touch behavior on the actual expanded area.
- [ ] Label/control and field/message gaps use the resolved field-gap role. No checklist introduces a second spacing scale.
- [ ] Sticky headers, footers, banners, and dialogs never cover the focused element or block its scroll path.

## Interaction and accessibility

- [ ] Every action has an accessible name and keyboard path; no positive tabindex, keyboard trap, hover-only route, or drag-only action.
- [ ] Native buttons/links/fields match their purpose. Landmarks, heading order, reading order, and focus order follow the task.
- [ ] Fields have visible associated labels, exposed required/invalid state, and linked helper/errors. A failed submit focuses the error summary, or the first invalid field in a short form without a summary.
- [ ] Modals move focus in, retain it, close through a visible control and Escape, and restore focus. Menus, tabs, tooltips, and disclosures follow their expected keyboard pattern.
- [ ] Meaningful images have alt text; decorative images use empty alt. Icon-only controls have names beyond a decorative icon.
- [ ] One activation cannot double-submit. Pending work shows progress; failure retains entered values and offers an appropriate recovery action.
- [ ] Irreversible actions require explicit confirmation. Reversible actions can use a sufficiently visible undo path. Destructive confirmations name the item and consequence.
- [ ] Empty results, missing data, loading, stale data, permission denial, and request failure remain distinct when those states are possible.
- [ ] Routine updates use polite announcements; urgent errors may be assertive. Focus does not jump to routine notifications. Persistent/actionable notices remain recoverable.
- [ ] Context changes, new windows, and session expiry are explained where applicable; expiry allows warning and extension when the product supports it.

## Motion and runtime

- [ ] Motion follows the product's resolved durations; routine feedback is prompt, interruptible, and does not shift active targets. Focus is visible immediately.
- [ ] Reduced motion removes nonessential travel, scale, loops, and parallax while retaining status and control feedback.
- [ ] No flashing hazard; moving content lasting more than five seconds has pause/stop/hide when required. Audio/video has appropriate playback and volume controls.
- [ ] Work stops when its owner is disposed or the document is hidden where relevant. State and cleanup do not depend on an animation finishing.
- [ ] Required interactions work in the delivery environment without uncaught errors. Standalone/offline checks apply only when that format is required.

Automated accessibility checks, DOM measurements, and literal token searches support this review. They do not replace keyboard testing, rendered comparison, or a recorded statement of what remains unverified.
