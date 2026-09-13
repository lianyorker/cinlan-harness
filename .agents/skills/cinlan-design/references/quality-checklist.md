# Quality Checklist — Cinlan Design

Distilled from a dedicated anti-patterns + verification request to gpt-6-astra (reasoning=max), replacing the earlier cross-file synthesis. Run against every artifact before delivery. Report measured results, not impressions.

## Refused anti-patterns (zero tolerance)

**Color**: color-only status/selection/error/requiredness; red+green as the only distinction between two states; normal text <4.5:1; large text <3:1; a link with no non-color distinction; opacity <60% on actionable text/icons/controls; text over an image untested at its lowest-contrast point; a translucent overlay that drops the effective contrast below the gate; the same status mapped to different colors in different components.

**Contrast & boundaries**: a control boundary/focus indicator/meaningful graphical object <3:1 against its adjacent background; placeholder as the only label, or placeholder text <4.5:1; hover/pressed/selected/focus indicated only by a <3:1 color change; a disabled control hidden below 3:1 with no text explanation; a decorative border as the only separation between two interactive regions when it's below 3:1.

**Typography**: body text <16px; line-height <1.5× font size; paragraph spacing <2× font size when spacing is the only separator; text that can't reach 200% zoom without clipping/overlap; fixed-height text containers that clip at 100/200/400% zoom; required single-line text that can't wrap; letter-spacing below −0.02em or word-spacing below 0.1em that causes touching glyphs; >80 characters per line for primary reading (target 45–75); hierarchy from font size alone; ellipsis-truncating a required label/error/price/date/value with no full-value access; all-caps/underline/italic on more than 2 consecutive lines.

**Spacing & layout**: actionable target <44×44px (a documented 24×24px exception needs ≥8px separation from every other target); overlapping targets by even 1px; <8px between two independently-tappable controls with different actions; <16px inset from a viewport edge below 480px; <8px between a label and its input, or an error and the field it describes; spacing off the documented 4px scale; whitespace alone separating two differently-acting controls; forced horizontal scroll at 320px/400% zoom for ordinary content; fixed content that overlaps/clips at 200% text size or 320px width; a fixed footer/banner/modal that blocks scrolling the focused element into view.

**Motion**: >3 flashes per second, or any flash with a large saturated-red area; autoplaying motion/blink/scroll >5s with no pause/stop/hide; a nonessential animation running under `prefers-reduced-motion: reduce` (replace with an instant change or ≤100ms transition); a routine transition >300ms (use 120–250ms); parallax/zoom/rotation/oscillation as the *only* way to communicate state; animated layout that moves an active target >20px mid-interaction; an indeterminate loader running >10s with no status text or retry/cancel; autoplaying audio/video >3s with no pause and no independent volume control.

**Accessibility**: an interactive element with no accessible name; a clickable `div`/`span`/image with no native keyboard behavior, role, name, or state; any positive `tabindex`; removing the focus indicator without a ≥2px/≥3:1 replacement; a keyboard trap; a modal that doesn't move focus in, keep it in, and return it on close; hover-only menus/tooltips/disclosures with no keyboard/touch equivalent; heading levels chosen for size, or skipped by more than one level; reading order diverging from DOM/keyboard order beyond the interaction model's own logic; a drag-only operation with no keyboard/field alternative; `aria-live="assertive"` on routine updates; an icon or image as the *only* accessible name; an error color with no programmatic association to its field; a required-field asterisk with no programmatic requiredness + text explanation; a session timeout with <20s warning and no extension.

**Interaction**: an irreversible destructive action from one ambiguous click, with no confirmation or ≥5s undo; a disabled primary action with no adjacent reason; form-wide-only validation when a field-level error was identifiable sooner; user-entered data cleared after a validation/nav/upload/network failure without explicit confirmation; a form submittable more than once per activation with no progress state within 500ms; a link that navigates behaving like a button or vice versa; the only route to a page/action hidden behind hover-only or a time limit; an overlay dismissible *only* by outside-click; a new tab/window opened with no visible/accessible indication; an automatic context change from merely changing a select/checkbox/radio; a carousel with no pause/stop, position indicator, or keyboard prev/next; a silent empty state replacing a failed request instead of an error + retry; a persistent notification gone before 5s or with no way to reopen it.

## Verification checklist

### Color and contrast
- [ ] Every normal-text pair measures ≥4.5:1; large text (≥24px regular or ≥18.66px bold) ≥3:1
- [ ] Every meaningful icon/chart-mark/input-boundary/checkbox/radio/toggle/button boundary ≥3:1
- [ ] Every focus indicator ≥3:1 against each adjacent color
- [ ] Hover/pressed/selected/checked/invalid states remain distinguishable at ≥3:1
- [ ] Every error/warning/success/info state has a text label AND a non-color cue
- [ ] Every body-text link has a non-color distinction (normally underline)
- [ ] Text over images tested at the lowest-contrast point under each glyph
- [ ] Opacity-transformed text/icons measured after compositing over the real background

### Typography and reflow
- [ ] Body ≥16px; line-height ≥1.5× (≥24px for 16px text); paragraph spacing ≥2× where it's the sole separator
- [ ] No clipping/overlap at 100/200/400% zoom; usable at 320px width with no horizontal scroll for ordinary content
- [ ] Text reflows to 200% without lost content or overlap; tolerates line-height 1.5, paragraph-spacing 2em, letter-spacing 0.12em, word-spacing 0.16em overrides
- [ ] No required label/error/price/date/status/value truncated without a full-value path
- [ ] Primary reading lines ≤80 characters, target 45–75

### Spacing, sizing, layout
- [ ] Every actionable target ≥44×44px (or a documented 24×24px exception with ≥8px separation)
- [ ] No two actionable targets overlap at any tested viewport/zoom
- [ ] ≥8px between distinct adjacent controls; ≥16px inset below 480px width
- [ ] ≥8px between a label and its control, and between a field and its error
- [ ] All spacing on the documented 4px scale; exceptions recorded with exact value + purpose
- [ ] Fixed headers/footers/banners/dialogs never cover the focused element
- [ ] No clipping at 320px, 200% zoom, or 400% zoom
- [ ] A visible skip link appears on first keyboard focus and reaches main content

### Motion
- [ ] Nothing flashes more than 3×/second
- [ ] Every moving/blinking/scrolling region >5s has pause/stop/hide
- [ ] `prefers-reduced-motion: reduce` disables nonessential transitions or caps them at ≤100ms
- [ ] Routine transitions measure 120–250ms; none exceeds 300ms without a documented, essential reason
- [ ] No interaction-driven animation moves an active target >20px mid-interaction
- [ ] Indeterminate loaders >10s show status text + retry/cancel
- [ ] Autoplay audio/video stops or can pause within 3s, with independent volume control
- [ ] Every carousel has pause/stop/prev/next, all keyboard-operable, with an exposed position

### Keyboard and focus
- [ ] Every function is keyboard-operable; no action depends on hover/drag/gesture alone
- [ ] Tab order follows visual/DOM reading order
- [ ] Zero positive `tabindex`
- [ ] Every focusable element has a ≥2px, ≥3:1 visible focus indicator
- [ ] Modals trap focus, close on `Escape`, and return focus to the trigger
- [ ] Every menu/disclosure/submenu/tooltip/dialog/popover has a full keyboard path
- [ ] Every drag operation has a non-drag alternative
- [ ] No keyboard test produces a trap

### Semantics and assistive tech
- [ ] Every interactive element has a nonempty, purpose-identifying accessible name
- [ ] Every form control has a visible, programmatically associated label (not placeholder-only)
- [ ] Required/invalid states are exposed programmatically and linked to their text
- [ ] On submission errors, the first invalid field receives focus
- [ ] Heading levels are correct and don't skip more than one level
- [ ] Landmarks identify main regions; DOM/screen-reader/keyboard order match
- [ ] Every meaningful image has alt text; decorative images use `alt=""`
- [ ] Live-region announcements are limited to the changed information; assertive is reserved for urgent updates
- [ ] New tabs/downloads/external destinations/time limits are identified in text
- [ ] Session-expiration warnings appear ≥20s before expiry with a usable extension

### Interaction and error recovery
- [ ] Destructive actions require confirmation or expose ≥5s undo
- [ ] One activation can't double-submit; a progress state appears within 500ms
- [ ] Disabled primary actions expose their reason in adjacent/accessible text
- [ ] Validation errors identify the field and the fix, no later than the submit response
- [ ] Entered values survive failures unless the user explicitly confirms data loss
- [ ] Dismissible overlays have a visible close control, not only outside-click
- [ ] No automatic context change from a select/checkbox/radio change alone
- [ ] Failed requests show an error + retry in the same region within 1s of detection
- [ ] Persistent notifications stay ≥5s with a way to reopen their full content
- [ ] Hover-revealed content is also reachable by keyboard/touch and has no timeout <5s

### Contract fidelity
- [ ] Every color/space/type value resolves to a token in `design-tokens.md`
- [ ] `DESIGN.md` updated when token or component decisions changed
- [ ] Anti-pattern sweep above is clean; a11y attributes present unprompted (labels, roles, `aria-*`, landmarks)
