---
name: cinlan-design
description: Use when turning visual references, websites, screenshots, or a design direction into a reusable design contract, measured brand evidence, a working artifact, or a verified export. Triggers include Cinlan Design, DESIGN.md, design contract, reference-to-design, brand extraction, design handoff, design review, export fidelity, UI style, and any task that must produce interfaces in the Cinlan visual language distilled from gpt-6-astra.
metadata:
  distilled_from: gpt-6-astra (api.cinlan.online)
  method: model-behavioral-distillation
---

# Cinlan Design

Turn design evidence into explicit decisions, a working artifact, and reproducible verification. The visual language is distilled from `gpt-6-astra`: **functional editorial minimalism** — quiet, legible, precise, trustworthy interfaces with neutral surfaces, strong typography, restrained accents, subtle borders, compact controls, and deliberate whitespace. Sampled artifacts (`.artifacts/distill-astra/sample-login-card.md`, `sample-settings-panel.md`, `sample-dashboard-card.md`) show the palette adapts to context (coral+near-black login card, full green settings panel, cool-blue dashboard card) while the **craft stays constant** — intermediate font weights (550/650), 5–6px radii, a focus ring that pairs a border-color change with a soft outline/glow, one shadow max on the outer frame, and full a11y/semantic markup plus working JS (persistence, validation) emitted unprompted. See `references/design-tokens.md` → Observed signature for the fingerprint.

## When to use

- A task asks for a UI, page, component, dashboard, or design direction
- A visual reference (screenshot, site, mock) must be converted into decisions or code
- A design review, design contract (`DESIGN.md`), or export-fidelity check is requested
- Any generated interface must match the Cinlan visual language

## Design priorities (in order)

1. **Clarity** — hierarchy and state immediately understandable
2. **Efficiency** — frequent actions need minimal movement and interpretation
3. **Consistency** — same visual language, same behavior everywhere
4. **Feedback** — every meaningful action produces a visible response
5. **Restraint** — emphasis reserved for what matters
6. **Accessibility** — contrast, keyboard, focus, touch targets, reduced motion are foundational

## Workflow

1. **Design the whole first** — apply `references/art-direction.md`: turn the brief into a meaning statement + central tension + governing metaphor, write a visual thesis, choose a compositional model, set explicit hierarchy. A designed artifact has one governing idea; an assembled one has competent parts answering different questions. Do this before touching tokens.
2. **Extract evidence** — from the reference or brief, record measured facts: palette, type scale, spacing rhythm, radius, elevation, motion. Never guess tokens; measure or default to `references/design-tokens.md`.
3. **Write the contract** — produce or update `DESIGN.md` in the target project: tokens, component rules, anti-patterns. The contract is the source of truth for the artifact.
4. **Decide the behavior layer** — for anything interactive, apply `references/interactive-artifacts.md`: JS vs CSS decision rule, single-file app architecture, animation driver choice, control wiring, lifecycle, state correctness. An artifact that moves or responds is a small application, not a styled page.
5. **Build the artifact** — implement against the contract. Semantic tokens only; no hardcoded colors in components; real controls and working logic, not static mockups.
6. **Verify** — run `references/quality-checklist.md`: contrast ratios, focus states, touch targets, reduced motion, anti-pattern sweep — plus the interactive-artifacts functional/lifecycle/a11y/performance tests. Report measured results, not impressions.

## Reference documents

- `references/art-direction.md` — the overall-design layer: brief→concept, visual thesis, composition before components, one art direction, explicit hierarchy, designed-vs-assembled, 12-step process
- `references/design-tokens.md` — full token system: color (light/dark), typography scale, spacing, breakpoints, radius, elevation, motion
- `references/component-patterns.md` — buttons, cards, inputs, navigation, tables, modals, toasts with concrete styling rules
- `references/interactive-artifacts.md` — JS-vs-CSS decision rule, single-file app architecture, animation drivers (keyframes/WAAPI/rAF), kinematics, control wiring, lifecycle, time correctness, performance, testing
- `references/quality-checklist.md` — deliberate anti-patterns and the verification checklist for every artifact
- `references/surfaces-dashboard.md` — data-dense dashboard spec: layout, KPI cards, filters, charts, detail table, density, real-time and empty states
- `references/surfaces-landing-dataviz.md` — marketing landing page spec + data-visualization spec (chart selection, color encoding, axes, tooltips, states, a11y)
- `references/svg-illustration.md` — hand-crafted SVG scene craft: layering, defs/use/clipPath, organic paths, texture/depth, character life, viewBox discipline
- `references/motion-design.md` — easing curves, duration scale, choreography, secondary/ambient motion, anti-patterns
- `references/copy-editorial.md` — voice by artifact type, hierarchy, microcopy, bilingual mixing, editorial techniques, anti-patterns

## Hard rules

- Semantic tokens in components; raw hex only inside the token layer
- One primary accent per product; red reserved for destructive/error/blocking states
- Never color-only status — pair with icon, label, or shape
- Body text ≥ 4.5:1 contrast; large text ≥ 3:1
- Touch targets ≥ 40px; focus outline 2px visible with ≥ 2px offset
- Dark mode uses dark neutrals, never pure black; text softened, never pure white
- Exit animations faster than entry; animate opacity/transform before layout
- Respect `prefers-reduced-motion`
