---
name: cinlan-design
description: Use when turning visual references, websites, screenshots, or a design direction into measured design decisions, reusable tokens, a working artifact, or a verified export. Triggers include Cinlan Design, DESIGN.md, design contract, reference-to-design, brand extraction, design handoff, design review, export fidelity, and UI style.
---

# Cinlan Design

Turn design evidence into a working artifact and reproducible verification. Favor clear hierarchy, legible typography, restrained emphasis, and useful density. This is design guidance, not a claim to reproduce a model's aesthetic judgment. The initial material came from prompted descriptions and three small component samples from gpt-6-astra; those observations do not establish full-page or cross-model quality.

## Choose the task mode

Select the mode before choosing tokens or exploring concepts. [Task modes](references/task-modes.md) gives concrete cases.

| Mode | Starting evidence | Work to do |
|---|---|---|
| Extend an existing product | Current implementation, theme, components, accepted pages | Preserve the shell, density, type roles, and interaction conventions; implement the requested change |
| Follow a reference | User-designated image, page, or artifact | Measure its geometry, hierarchy, and styling; identify missing states and responsive behavior |
| Create a new design | Brief and available content/assets | Explore composition using [art direction](references/art-direction.md), then choose one direction |

A product task can include a reference for one region. Apply that reference within its stated scope and inherit the rest. Do not restart concept exploration after the direction is accepted.

## Decision order

Resolve each design decision in this order: **explicit user requirements and approved reference → current product tokens and components → applicable page-type example → generic defaults**. A reference controls only what it shows or specifies; record uncertain measurements and use the next source for gaps. Reference examples in this skill are starting points, not approved visual baselines.

Accessibility and functional requirements apply in every mode. If a reference has a measured accessibility failure, preserve its intent while correcting the failing color pair, target, or interaction; record that specific deviation.

## Workflow

1. **Record evidence.** Identify the task mode, source for each decision, viewport, content, and required states. Measure layout and type before styling individual components.
2. **Resolve shared values once.** Reuse the product's token owner. For a new system, use [design tokens](references/design-tokens.md) and its canonical [CSS defaults](references/tokens.css). Record mappings and deliberate deviations in the project's existing design document, or a concise `DESIGN.md` if none exists; do not duplicate raw values there.
3. **Build the requested artifact.** Reuse the host architecture and [component patterns](references/component-patterns.md). For standalone interactive artifacts, consult [interactive artifacts](references/interactive-artifacts.md). Implement actual actions and relevant loading, empty, error, and focus states.
4. **Verify the rendering.** Run the applicable [quality checks](references/quality-checklist.md) and [visual comparison procedure](references/verification.md): fixed viewport and fixture, measured geometry, saved screenshots, and actual side-by-side inspection against the designated baseline. A screenshot capture or DOM check alone is not visual verification.
5. **Report evidence and gaps.** Name the changed files, measured results, visual differences, and checks not run. Without a supplied or approved baseline, report the design as provisional; do not claim reference fidelity or cross-model quality.

## Load references by need

- [Art direction](references/art-direction.md): composition and concept exploration for new designs.
- [Dashboard example](references/surfaces-dashboard.md): operational metrics, filters, tables, and live states.
- [Landing and data visualization examples](references/surfaces-landing-dataviz.md): marketing structure and chart decisions.
- [Copy](references/copy-editorial.md): task-specific voice and factual interface text.
- [Motion](references/motion-design.md) and [SVG illustration](references/svg-illustration.md): use when the requested artifact needs them.

## Required checks

- Components reference semantic tokens; shared UI colors and radii have one owner.
- Status and selection include a text, icon, or shape cue beyond color.
- Normal text reaches 4.5:1 contrast; large text reaches 3:1; essential control boundaries and focus indicators reach 3:1 against adjacent colors.
- Measure visible control size separately from its hit area using the [target policy](references/design-tokens.md#control-size-and-hit-area). Keep focus visible and targets non-overlapping.
- Preserve keyboard operation, entered data on failure, and reduced-motion behavior.
