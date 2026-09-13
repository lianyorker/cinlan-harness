# Prompt Patterns & Recipes — Cinlan AIGC

Full templates and rules distilled from gpt-6-astra (reasoning=max). The quality loop lives in `SKILL.md`. Treat generation as a controlled production pipeline: define the deliverable → specify subject/meaning → lock structure → add modifiers → generate broadly → evaluate against a checklist → refine one variable at a time → select, edit, validate.

## Requirement record

```yaml
project:
  deliverable: "image | video | audio | text | mixed"
  audience: ""
  platform: ""
  purpose: ""
must_have: [""]
must_not_have: [""]
quality_thresholds:
  factual_accuracy: "100% for named facts"
  required_elements_present: "100%"
  prohibited_elements_present: "0"
technical:
  aspect_ratio: "16:9"
  resolution: "3840x2160"
  color_space: "sRGB"
```

## Media generation

### Universal prompt structure

```
[OUTPUT AND TASK] [PRIMARY SUBJECT] [SUBJECT ATTRIBUTES] [ACTION OR STATE]
[ENVIRONMENT AND CONTEXT] [COMPOSITION] [CAMERA OR VIEWPOINT] [LIGHTING]
[COLOR AND MATERIAL] [STYLE OR MEDIUM] [DETAIL AND QUALITY]
[TECHNICAL CONSTRAINTS] [EXCLUSIONS]
```

### Image prompt template

```
Create a [image type] of [primary subject], [specific attributes], [action or state],
inside [environment and context]. Composition: [shot size], [viewpoint],
[subject placement], [foreground/midground/background], [negative space].
Camera: [lens], [depth of field], [focus target]. Lighting: [key direction],
[quality], [color temperature], [shadow behavior]. Palette: [exact colors].
Materials and texture: [specific surfaces]. Style: [medium], [influences as traits].
Mood: [emotion]. Detail level: [requirement].
Output: [aspect ratio], [resolution], [color space]. Avoid: [negative prompt].
```

Filled example: *"One matte red insulated bottle with a black screw cap, upright on a light gray tabletop. Front three-quarter view, eye-level camera; bottle on the right third, left third empty. Soft window light from the left, subtle contact shadow. Preserve the cylindrical body, black cap, and brushed metal base."*

### Subject specification — layers to specify when they matter

| Layer | Specify | Example |
|---|---|---|
| Identity | object/character category | "two-seat electric concept coupe" |
| Count | exact number | "three red apples, no additional fruit" |
| Geometry | shape/proportions | "wide base, narrow neck, 2:1 ratio" |
| Material | surface response | "brushed aluminum, fine horizontal grain" |
| Color | named + behavior | "deep cobalt blue, low-saturation highlights" |
| State | condition/expression | "slightly wet, focused, mid-stride" |
| Scale | relation to surroundings | "small boat, lower-right quarter" |
| Relationships | spatial arrangement | "lamp behind the chair, plant left of window" |

Weak: `A futuristic car in a city.` Operational: name material, geometry, lighting, and placement explicitly (see filled examples above) — specificity is what makes a prompt controllable.

### Character identity sheet (reuse verbatim across generations)

```yaml
character:
  name: "Mara"
  face: "oval face, dark almond-shaped eyes, small beauty mark below left eye"
  hair: "short tightly curled black hair, side part"
  wardrobe: "rust-orange utility jacket, cream shirt, charcoal trousers"
  prohibited_changes: ["do not lengthen hair", "do not change skin tone", "do not add glasses"]
```

### Composition and spatial control

Vocabulary: shot size (extreme close-up → extreme wide), viewpoint (eye level, low/high angle, bird's/worm's-eye, three-quarter), placement (centered, thirds, quadrants), depth (foreground/midground/background, shallow/deep focus), balance (symmetrical/asymmetrical/triangular/radial/leading-line), negative space (reserved for text/logo/compositing). Use explicit relationships for multi-object scenes ("the chair is much closer to camera than the window; the table is half a chair-width to the right") rather than metric distances a model can't reliably honor.

### Camera, lens, lighting recipes

| Intended result | Camera |
|---|---|
| Product isolation | 85mm, f/8, tripod, focus on front logo, straight verticals |
| Environmental portrait | 50mm, eye-level, f/2.8, subject sharp / background soft |
| Intimate portrait | 85mm close-up, f/1.8, focus on nearer eye |
| Architectural interior | 24mm tilt-shift, level camera, f/11, straight verticals |
| Dynamic action | 35mm, low three-quarter angle, 1/1000s motion-freeze |
| Macro detail | 100mm macro, 1:1, focus-stacked look |

Lighting: specify source, direction, quality (hard/soft/diffused), color temperature (e.g. 3200K warm / 6500K cool), contrast, shadow behavior, and interaction (reflections/rim light) — one coherent setup, never contradictory instructions stacked together.

### Style modifiers

Separate content from style; content first, style second. Style dimensions: medium, rendering, era, palette, contrast, texture, composition, finish. Avoid incompatible collisions ("photorealistic watercolor, sharp flat vector, accurate oil paint" simultaneously); if a hybrid is intentional, state the hierarchy explicitly (e.g. "photorealistic base geometry; hand-painted gouache limited to sky/background; face and hands stay realistic"). Translate a creator/brand reference into observable traits ("restrained editorial palette, generous negative space, geometric framing, soft directional light") for portability.

### Negative prompts

Template targets likely defects, not a generic blacklist: `extra people, duplicate objects, incorrect object count, cropped subject, cut-off hands, deformed anatomy, fused fingers, warped text, misspelled lettering, floating objects, watermark, logo, border`. Rules: most-likely failures first; concrete visual failures ("extra fingers" not "bad anatomy"); don't negate the desired subject ("no blur" can conflict with "soft background blur" — say "subject sharp; background only may blur"); if negatives aren't supported, move exclusions into the main prompt under `Must not contain:`.

### Parameter control

```yaml
model: "exact model and version"
seed: 184729
steps: 30
cfg_or_guidance: 6.5
denoise_strength: 0.35
reference_strength: 0.75
outputs_per_prompt: 8
```

| Control | Starting value | Increase when | Decrease when |
|---|---:|---|---|
| Steps | 28–40 | details incomplete | already stable, slow |
| Guidance/CFG | 5.5–7.5 | weak prompt adherence | brittle/oversaturated |
| Denoise (edit) | 0.25–0.40 | preserve composition | changes not appearing |
| Denoise (transform) | 0.55–0.75 | original over-constrains | identity must stay fixed |
| Reference strength | 0.65–0.85 | identity/style match matters | reference overpowers content |

One parameter change per refinement cycle — changing seed, prompt, resolution, and guidance together makes results undiagnosable. Fixed seed when comparing changes; different seeds when exploring diversity. Generate composition at moderate resolution, select, then upscale/refine — never upscale a flawed composition expecting the upscaler to fix semantics.

### Video

`SHOT / START / ACTION / END / CAMERA / INVARIANTS / DURATION / AUDIO` — one motion + one camera move per shot, complex sequences built shot by shot:

```yaml
shot:
  duration: 8.0
  camera_start: "static at eye level"
  camera_end: "tracks 2 meters right"
  primary_action: "walks steadily and stops"
  continuity_locks: ["rust-orange jacket", "silver watch on left wrist"]
```

Temporal negative prompt: `no flicker, no frame-to-frame identity change, no wardrobe change, no melting face, no rubber limbs, no unstable horizon, no duplicated subject`. Continuity method: generate start/end keyframes → verify identity/wardrobe/lighting → describe only the connecting motion → short shots, cut at natural motion points.

### Audio

`TYPE / SCRIPT_OR_EVENT / VOICE_OR_INSTRUMENTS / DELIVERY / TIMING / PRONUNCIATIONS / OUTPUT`; music adds BPM, meter, instrumentation, energy map. Keep dialogue short with exact timing (`"The train leaves at six." Duration: 2.2s, begin 0.8s`). For exact/long speech, generate audio separately and use a dedicated lip-sync stage rather than depending on a video model.

### Text rendering inside images

Prefer generating a clean reserved area and typesetting externally for exact copy. Otherwise: use a structural reference if supported, keep text short/large/high-contrast and verify every character, or inpaint the text region separately. Never accept text by visual approximation when spelling, legal language, price, or product identity matters.

## Text generation

### Universal prompt structure

```
ROLE: [expert role] TASK: [single deliverable] AUDIENCE: [specific reader]
PURPOSE: [decision/education/conversion/analysis] SOURCE MATERIAL: [approved knowledge]
STRUCTURE: [headings, sequence, length/section] VOICE: [tone, formality, POV, rhythm]
CONSTRAINTS: [facts, exclusions, reading level, format] EVIDENCE RULES: [citation/uncertainty]
QUALITY TEST: [checklist] OUTPUT FORMAT: [Markdown/JSON/table/etc.]
```

### Planning before drafting

Separate outline (`purpose, reader question, 3–5 claims, evidence needed, target word count per section — do not write final prose`) from draft (`preserve section order and word targets within ±10%; every section: claim → example → implication`) from revision (`revise without changing factual meaning; return revised text + a labeled change log`).

### Voice specification

```yaml
voice:
  person: "second person"
  sentence_length: "12-22 words, occasional 6-word emphasis"
  prohibited: ["hype", "cliches", "empty transitions", "unverifiable superlatives"]
```

Give a reference voice sample and instruct matching its sentence length/directness/tone without copying its subject or phrases longer than 5 consecutive words — operationalizing voice this way beats adjective lists like "friendly and professional."

### Constraint patterns

Length/structure: exact bullet counts + word ranges, exact heading counts. Reading level: target grade level, mostly 1–2 clause sentences, define terms at first use. Evidence: use only supplied sources; mark absent facts as `[evidence not supplied]`; separate observed facts from inferences from recommendations. Output schema: exact JSON schema, `Do not add keys`, explicit null policy.

### Task-specific patterns

Summarization (preserve claim + 3 facts + limitation + next step, list ambiguity separately), extraction (one row per occurrence: quote/normalized value/location/confidence), analysis (pattern → strongest explanation → 2 alternatives → missing evidence → one distinguishing test — never confuse correlation with causation), brainstorming (grouped ideas with effort/differentiator/risk), copywriting (exact word-count headlines, banned superlative list), editorial fact-check (per-sentence claim/type/support/confidence table, never silently rewrite unsupported claims).

### Four-pass iterative method

1. **Coverage** — draft everything, mark unresolved facts `[VERIFY]`, don't optimize style.
2. **Structure** — reorder so each section answers one question; no new facts.
3. **Language** — clarity/rhythm pass; preserve numbers/qualifications/citations exactly.
4. **Compliance** — PASS/FAIL each requirement with the quoted satisfying passage, then output final text only.

Critique-before-revision: identify the five highest-impact problems (with evidence, why it matters, proposed fix, whether it changes meaning) and wait for approval before revising — this prevents untracked changes while diagnosing.

## Quality evaluation and refinement loop

### Weighted rubrics (score 0–5 per criterion)

Image: subject identity 20%, composition 15%, required elements 15%, anatomy/geometry 15%, lighting/materials 10%, style/brand fit 10%, text/legibility 5%, technical quality 10%. Accept at weighted score ≥0.85 with zero critical failure in identity/required-elements/safety/legibility.

Video: identity+continuity 20%, motion plausibility 20%, composition 10%, temporal stability 20%, lighting continuity 10%, audio/lip-sync 10%, technical delivery 10%. Require ≥4.25/5, zero severe continuity errors.

Text: factual accuracy 25%, requirement coverage 20%, reasoning/coherence 15%, audience usefulness 15%, structure 10%, voice fit 10%, grammar 5%. Require ≥4.25/5 with factual accuracy and coverage each ≥4/5.

Evaluate in order: hard constraints → content correctness → coherence → audience fit → aesthetic quality → technical quality. High aesthetic quality never compensates for a failed hard constraint.

### Root-cause refinement (map failure → likely cause → fix)

| Failure | Likely cause | First fix |
|---|---|---|
| Subject missing | buried in prompt / guidance too low | move subject to first sentence |
| Identity drift | weak reference / excessive denoise | increase reference strength |
| Extra objects | count not explicit | say "exactly N", list exclusions |
| Bad hands | difficult pose, tiny scale | simplify pose, enlarge in frame |
| Video flicker | insufficient temporal conditioning | shorten shot, lock keyframes |
| Unsupported claim | ungrounded drafting | require source-only behavior |

### Controlled loop

```
1. Generate candidate.
2. Evaluate against every hard constraint; if any fails, change the smallest
   relevant part of the prompt/settings and regenerate.
3. If hard constraints pass, score with the rubric; fix the lowest-weighted
   criterion; regenerate.
4. Stop when: score >= threshold; no critical defect; two refinements yield
   <2% improvement; or the iteration budget is reached.
5. At budget exhaustion, escalate: reference image, mask, manual edit, human
   rewrite, alternate model, or new composition — not more identical attempts.
```

Once composition/identity are approved, stop full regenerations — use local edits or a separate compositing stage.

## Style transfer and consistency

Separate a **style bible** (palette, contrast, lighting, lens language, prohibited list) from a **content bible** (fixed identity features vs. variable features). Reference-image workflow: one canonical reference, cleaned up, ID/seed/crop recorded, reused for every scene in a set with fixed reference strength while testing scene prompts; compare each output against a feature checklist (face/hair/body/wardrobe/palette/rendering). Style transfer without content destruction: explicitly state what's preserved (subject, silhouette, pose, camera, object count, background layout, lighting direction) and transfer only the named visual treatment; start style strength at 0.35–0.50, raise only if the style isn't apparent, lower if identity/composition drifts.

Character consistency: a fixed `[IDENTITY LOCK] / [WARDROBE LOCK] / [STYLE LOCK] / [SCENE VARIABLE]` block reused verbatim, changing only the scene variable. Multi-shot video consistency: a shot table (duration/start pose/end pose/wardrobe/location/camera) generated from each preceding shot's final frame — never expect a model to remember details across unrelated generations.

Brand consistency: a `brand_tokens` block (visual + verbal) with preferred/prohibited terms; use generation for concepts and visual assets but deterministic design systems for logos, exact brand colors, and legal copy.

## Common failure modes and fixes

| Domain | Failure | Fix |
|---|---|---|
| Prompt | Vague subject | State subject first + count/attributes/action/distinguishing features |
| Prompt | Contradictory instructions | Remove contradictions, define an explicit hierarchy |
| Prompt | Noun piles | Convert to relationships/actions between named objects |
| Image | Anatomy defects | Simplify pose → enlarge scale → specify hand visibility → inpaint → composite |
| Image | Wrong object count | State the exact count twice, define relationships, add a count negative |
| Image | Overprocessed/plastic | Specify natural texture/grain, lower guidance |
| Image | Poor text | Reserve the area, typeset externally |
| Video | Flicker | Shorten shot, stable reference frame, remove unnecessary camera movement |
| Video | Object mutation | Fewer moving objects, defined start/end states, mask/composite |
| Text | Hallucinated facts | Source-only requirement, explicit "not established" marker, fact-check pass |
| Text | Repetition | Unique question per section, claim-overlap audit |
| Text | Generic advice | Require trigger/action/exact value/expected result/fallback per recommendation |
| Consistency | Style/character/product drift | Style bible / identity sheet / preserved product reference, respectively |

## Reusable end-to-end templates

Master image, video, text, and evaluation prompts follow the section structures above (`TASK / SUBJECT / SCENE / COMPOSITION / CAMERA / LIGHTING / COLOR AND MATERIAL / STYLE / MUST INCLUDE / MUST NOT INCLUDE / OUTPUT` for images; `TASK / SUBJECT AND LOCKS / START FRAME / ACTION TIMELINE / CAMERA / ENVIRONMENT / LIGHTING / AUDIO / CONTINUITY / EXCLUDE / OUTPUT` for video; `ROLE / TASK / AUDIENCE AND PURPOSE / SOURCE AND EVIDENCE / STRUCTURE / VOICE / CONSTRAINTS / QUALITY CHECK` for text). Evaluation prompt: score each rubric category 0–5 with evidence, severity, and one targeted fix; then compute the weighted score and recommend exactly one next change, or write `APPROVED`.

## Practical defaults (starting points, not universal truths)

```yaml
image_exploration: { candidates: 8, resolution: "1024x683", steps: 32, guidance: 6.5 }
image_refinement: { candidates: 4, resolution: "1536x1024", denoise: 0.35, reference_strength: 0.75 }
video_exploration: { duration_seconds: 6, fps: 24, primary_actions_per_shot: 1, camera_movements_per_shot: 1 }
approval:
  image_weighted_score: 0.85
  video_score: 4.25
  text_score: 4.25
  human_review_required_for:
    - "legal or regulated claims"
    - "medical or financial guidance"
    - "exact brand or product representation"
    - "real-person likeness"
```

The central rule: make every generation decision observable — define the requirement, encode it in a structured prompt, control the relevant parameter, score against a fixed rubric, and change only the variable connected to the failure.
