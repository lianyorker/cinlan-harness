---
name: dsh-client-ui-ux
description: Design, redesign, and review Cinlan / DeepSeek Harness client UI and Web surfaces — native Anti-Slop discipline, visual token discipline, Art Direction & layout variance, typography hierarchy, surfaces & texture depth, feedback surfaces, overlay/menu safety, platform window adaptation, and the Look-and-Fix browser verification loop. Use when adding, restyling, or reviewing product-user-visible GUI behavior in packages/client, apps/web, or website.
---

# Cinlan Harness Client UI/UX & Native Art Direction

This skill unites Cinlan Harness client engineering discipline with native Taste Skill art direction. It covers non-negotiable visual invariants, anti-slop house bans, feedback placement, surface depth, window adaptation, and the browser-level look-and-fix verification loop.

Copy quality follows [dsh-prose-standard](../dsh-prose-standard/SKILL.md); locale ownership follows the [locale-owned copy decision](../../notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md); token rules and shared primitives live in [docs/web-styling.md](../../../docs/web-styling.md) and [ui-primitives](../../../packages/client/ui-primitives/README.md).

---

## 1. The Three Consistency Locks

Every surface enforces three locks from first paint to final teardown:

1. **Color Consistency Lock**: Pick exactly one primary accent per surface or view. Never scatter unrelated brand accents (e.g. blue buttons next to emerald highlights and amber badges without semantic distinction).
2. **Shape Consistency Lock**: One corner-radius system per view. Containers, cards, inputs, and buttons share an optically harmonious radius scale (e.g. sharp, rounded, or pill). An inner element's radius must never exceed its containing card's radius.
3. **Theme & Dual-Palette Fidelity Lock**: Dark and light modes must achieve equal visual hierarchy and brand fidelity.
   - **No pure `#000000` or `#ffffff` backgrounds**: Use off-black (`#0a0a0a`, `#121212`, or tinted dark charcoal) and off-white (`#f5f4f2`, `#faf9f6`) to prevent stark, uncalibrated contrast.
   - **WCAG AA contrast parity**: Text must pass readability standards under both schemes before shipping. Never test one palette mode and assume the other works.

---

## 2. Anti-Slop House Bans

Generated code must never emit generic AI design artifacts. The following patterns are strictly banned:

- **Banned em-dashes and en-dashes (`—` and `–`)**: Do not use em-dashes or en-dashes in UI labels, headlines, buttons, cards, toasts, or captions. Use a standard hyphen (`-`) or rewrite the phrasing.
- **Banned three-equal-card feature rows**: Never default to three identical side-by-side cards with a centered icon. Replace with an asymmetric layout, a 2-column zig-zag, an interactive preview list, or an expandable detail card.
- **Banned AI gradients**: Purple-to-blue mesh blob gradients and saturated diagonal linear fades are prohibited. Use neutral surfaces, ambient lighting, or a single restrained accent tint.
- **Banned div-based fake UI**: Do not assemble mock product dashboards, fake code terminals, or simulated cards out of styled divs when real data or interactive components exist.
- **Banned repetitive borders**: Never apply `border-t` plus `border-b` across every item in a list or spec view. Use clean spacing, subtle background alternation, or grouped cards.
- **Banned raw scroll event listeners**: Never write `window.addEventListener('scroll')` in application scripts or React components. Use CSS scroll-driven animations, Motion `useScroll`, or `IntersectionObserver`.
- **Banned decorative status dots**: Colored pulse/status dots are reserved strictly for live semantic runtime state (e.g. active streaming, connection status). Never sprinkle static decorative green/yellow dots.

---

## 3. Typography & Breathing Space

- **Font weight discipline**: Feature CSS tops out at `font-weight: 500`. Do not use `600` or `700` for emphasis in standard feature code; establish hierarchy through size, ink contrast, or tracking instead. The markdown typography tokens in `ui-theme` are the sole standing exception.
- **Introduce Medium (500)**: Avoid jarring clashes between bare 400 (regular) and 700 (bold). Use 500 (medium) for subtle hierarchy in list titles, table headers, and tab labels.
- **Optical tracking & line-height**:
  - Headlines and display titles: Tighten letter-spacing (`tracking-tight` or `-0.015em` to `-0.025em`) with reduced line-height (`leading-[1.1]` to `leading-snug`).
  - Small labels, badges, and uppercase tags: Slightly loosen letter-spacing (`+0.04em` to `+0.08em`).
- **Tabular figures for data**: Enable `font-variant-numeric: tabular-nums` (or monospace tokens) for counters, dates, file sizes, token budgets, and prices to eliminate horizontal jitter during updates.
- **Headline discipline**:
  - Headlines must not exceed two lines on desktop displays.
  - Fix awkward single-word wrapping using `text-wrap: balance` on headings and `text-wrap: pretty` on short descriptions.
- **Double the whitespace**: When in doubt, increase padding and margin. Generous whitespace creates calm, intentional architecture; tight, claustrophobic margins signal unrefined layouts.

---

## 4. Surfaces, Depth & Tactile Quality

- **Tinted shadows**: Never use generic pure-black shadows (`rgba(0,0,0,0.15)`). Tint shadow values to match the surface or background hue (e.g. dark blue/slate shadows on slate backgrounds) to create realistic atmospheric depth.
- **Subtle borders & backdrops**: Give elevated cards and floating panels a hair-line border with a subtle top edge highlight (`border-t: rgba(255,255,255,0.08)` in dark mode) paired with `backdrop-filter: blur(12px)`.
- **Consistent lighting angle**: Shadows, bevels, and borders across a single surface must reflect a unified light source (top-down).

---

## 5. Visual Foundation & Token Discipline

- **Use existing tokens for color, radius, and spacing**: Search the target surface and established siblings (e.g. the Plugins and Settings surfaces) for existing tokens before adding custom CSS variables.
- **Scale discipline**: Keep the number of distinct font sizes on a single view small (13px is the canonical row/detail size, 14px for body text, 12px for badges/metadata).
- **Proportionate icons**: Icons must scale and align with adjacent text along a deliberate optical axis (vertical center or shared baseline). Never introduce an icon that visibly outweighs neighbouring text.
- **Reuse before adding**: Extend existing primitives (`Button`, `Menu`, `Toast`, `Modal`, `HoverCard`, `Badge`) before introducing new single-purpose DOM structures.
- **Icons from the icon library**: Use the existing `@deepseek-ai/dsh-client-ui-primitives` icon exports. New glyphs require designer review.
- **Slot registrations**: Right-sidebar content must register a slot in the unified right-sidebar host rather than opening a disconnected panel. Every sidebar tab declares a semantic icon.
- **Tooltips on icon-only actions**: Every icon-only button without visible text requires a `Tooltip`. Informational hover targets with selectable text use `HoverCard`.

---

## 6. Feedback Surfaces & State Placement

Choose the surface by message lifetime relative to the triggering action:

- **Transient operation outcomes use Toast**: App-wide `Toast` handles action outcomes (e.g. "Saved", "Copied", "Export completed") rendered in an overlay host that outlives the panel. A deletion can close its triggering modal; only a toast outside the modal survives.
- **Preserve data on failure**: A failed operation keeps existing rows and form fields intact; never blank the view to display a generic error card.
- **In-place notices for bound queries**: Use in-place notices with retry triggers for localized network failures. Only an entirely empty container centers a full zero-data error state.
- **Concise copy**: Error copy is direct and short (one to two sentences). Omit trailing Chinese periods (句号) in two-sentence in-place notices. Never disrupt adjacent layout geometry when error copy mounts.
- **Loading states**: Lists and structured cards use their skeleton placeholder; full-page loads center a single bare spinner. Concurrent regions must not flash disparate loading treatments.

---

## 7. Overlays, Menus & Container Safety

Every menu, popover, dropdown, and tooltip must verify the three overlay rules:

1. **Dismissable**: Clicking outside or pressing Escape cleanly closes the overlay.
2. **Viewport-fitting**: Overlays flip or slide to stay inside the viewport with a safe edge margin, without oscillation.
3. **Unclipped**: Overlays escape parent `overflow: hidden` containers (via portal to `document.body`).
4. **Scrollbar clearance**: Scrollbars use shared custom styling and keep a small inset so they never clip against rounded borders.

---

## 8. Platform Window Chrome Adaptation

- On macOS (`darwin`), the native titlebar clearance is governed by `--dsh-frame-top-clearance`. Never modify the global clearance variable to fix a single page.
- Add a scoped `[data-platform='darwin']` selector on the page's own container or inset, and verify total offset (clearance + page inset) matches peer pages.

---

## 9. The Look-and-Fix Browser Verification Loop

Visual work is incomplete until verified in a running browser environment:

1. **Three-Breakpoint Audit**:
   - Desktop (`1440px`): Check max-width constraints, grid symmetry breaks, and line lengths.
   - Compact/Tablet (`768px`): Verify navigation collapses gracefully and card rows adapt without horizontal overflow.
   - Mobile (`390px`): Ensure touch targets are at least 44px, text scales cleanly, and dialogs dock to bottom sheets or full overlays.
2. **Hero Viewport Discipline**:
   - The primary hero region must fit comfortably within the initial viewport (`100dvh`, never `100vh`).
   - The primary call-to-action (CTA) must be visible above the fold without requiring a scroll.
3. **Automated Inspection Scripts**:
   - Run `node .agents/skills/design-taste-frontend/scripts/lint.mjs` to scan for banned patterns, unanchored gradients, and generic phrasing.
   - Use `node .agents/skills/design-taste-frontend/scripts/inspect.mjs` against the live local development server (`http://127.0.0.1:3080/`) to capture multi-resolution screenshots and audit rule conformance.
   - Critique output against the house rules, fix top defects, and re-inspect before submitting changes.

---

## 10. Design Review Escalation

A PR introducing net-new user-visible surfaces, notable interaction overhauls, or theme token alterations requires a designated design/product review (roster: yx zhang, yifffan, zhangziya, gaokaige).
