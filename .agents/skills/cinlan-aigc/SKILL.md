---
name: cinlan-aigc
description: Use when generating or refining AI content — images, video, audio, or text — where the task needs structured prompts, parameter control, a scored quality loop, or reproducible recipes. Triggers include AIGC, image generation, prompt engineering, text-to-image, video generation, content generation, style consistency, media prompt, and any task that produces AI-generated assets with quality gates.
metadata:
  distilled_from: gpt-6-astra (api.cinlan.online)
  method: model-behavioral-distillation
---

# Cinlan AIGC

Produce AI-generated content through structured prompts, bounded batches, scored selection, and reproducible recipes. Distilled from `gpt-6-astra`. The core discipline is **define quality gates before generating, and change one causal variable per iteration**.

## Media prompt pattern (image/video/audio)

```
SUBJECT: [count, identity, salient attributes]
ACTION_OR_STATE: [what is happening / static pose]
SETTING: [location, background, depth]
COMPOSITION: [framing, camera angle, subject placement, aspect ratio]
LIGHTING: [source, direction, quality, mood]
STYLE: [medium, rendering, palette, texture]
PARAMETERS: [dimensions, duration, seed, steps, guidance, format]
INVARIANTS: [identity/geometry/clothing/layout that must not change]
```

- **Modifiers**: prefer concrete cues (`hard side lighting`, `flat vector fills`, `visible woven texture`) over empty intensifiers (`beautiful`, `masterpiece`, `8K`). Camera/lens terms are visual cues, not optical guarantees.
- **Negative prompts**: target observed defects (`duplicate bottle, extra cap, watermark`), not a generic blacklist; when unsupported, state the desired state positively.
- **Video**: `SHOT / START / ACTION / END / CAMERA / INVARIANTS / DURATION / AUDIO` — one motion, one camera move, generate complex sequences shot by shot.
- **Audio**: `TYPE / SCRIPT_OR_EVENT / VOICE_OR_INSTRUMENTS / DELIVERY / TIMING / PRONUNCIATIONS / OUTPUT`; music adds BPM, meter, instrumentation, energy map.
- **Starting preset** (non-distilled SDXL): `1024x1024; steps=30; CFG=5; seed=42` — an experimental baseline, not a universal preset.

## Text generation pattern

```
TASK / SOURCES / OUTPUT / VOICE / CONSTRAINTS(MUST·SHOULD·MAY) /
UNKNOWN POLICY / EXAMPLES / TRUST
```

- **Operationalize voice**: replace "friendly and professional" with concrete rules (person, sentence length, acronym policy, banned phrases) + approved examples.
- **Ground before drafting**: build an evidence table `claim | source | passage | verified`; draft facts only from verified entries.
- **Long content in stages**: `evidence map → approved outline → section drafts → integration edit → validation` with per-section word budgets.
- **Targeted revision**: `Revise DRAFT to fix only DEFECTS. Preserve approved facts, order, PROTECTED_STRINGS verbatim. Meet ACCEPTANCE_TESTS. Return only the revised artifact.`

## Quality loop

1. **Define gates before generating** — schema/fields/length for text; dimensions/subject/identity/readable-text for media. Aesthetic score never compensates a failed gate.
2. **Bounded batch** — start with 8 candidates for exploration, 4 for refinement; separate wording experiments from sampling variation; set a budget up front (e.g. 3 exploration rounds, 5 focused refinements, 3 local-inpaint attempts).
3. **Score with a weighted rubric per medium** (0–5 per criterion): image weights subject-identity 20%/composition 15%/required-elements 15%/anatomy 15%/lighting 10%/style 10%/text-legibility 5%/technical 10%, accept at ≥0.85 with no critical failure in identity/elements/safety/legibility. Video and text have their own weighted rubrics — see `references/prompt-patterns.md`.
4. **Evaluate in order**: hard constraints → content correctness → coherence → audience fit → aesthetic quality → technical quality. High aesthetic quality never compensates for a failed hard constraint.
5. **Inspect medium-specifically** — text: claims/calc/links/schema; images: thumbnail composition + 100% detail (anatomy, boundaries, text); video: full-speed + frame-by-frame transitions; audio: full listen + pronunciation/clipping/loudness.
6. **Root-cause refinement** — map each visible failure to its most likely control (e.g. subject missing → move it to the first sentence; identity drift → raise reference strength) before regenerating; see the full failure-mode table in `references/prompt-patterns.md`.
7. **One causal variable** — fix factual inputs before prose, composition before texture, continuity before grading; recompare under matched settings.
8. **Accept / escalate / stop** — stop when the score clears its threshold with no critical defect, or two refinements yield <2% improvement, or the budget is reached. At the budget, escalate (reference image, mask, manual edit, alternate model) rather than repeating identical attempts or waiving requirements.

## Reference

- `references/prompt-patterns.md` — full prompt templates, conditioning/series/recipe rules, and the failure-mode table
