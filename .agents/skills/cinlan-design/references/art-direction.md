# Art Direction & Composition — Cinlan Design

Use this reference for new composition work after choosing a [task mode](task-modes.md). For product extensions and reference matching, inspect the established hierarchy and geometry, then work within them; concept exploration is unnecessary unless the task asks to reconsider the direction. Numerical composition examples are starting points for new designs. Shared UI values come from [design tokens](design-tokens.md).

A **designed** artifact has a governing idea: content, composition, type, palette, imagery, and motion come from one point of view. An **assembled** artifact has individually competent parts each answering a different question.

## 1. Concept

- **Extract a design contract from the brief.** Six fields: artifact type, audience, viewing situation, primary action, necessary evidence, delivery constraints. Mark inferred requirements as assumptions; ask only when different answers would materially change content, interaction, or composition.
- **Separate the subject from the proposition.** The subject is the topic; the proposition explains why *this* presentation belongs to *this* material — complete the sentence "This artifact is about ___, presented as ___, so the viewer can ___." Reject propositions like "modern, beautiful, engaging" — they eliminate no design choices.
- **When a new direction is needed, compare distinct organizing ideas.** For an open brief, three concepts can expose useful differences in meaning, composition, and interaction. Keep an already selected direction.
- **Choose by elimination, in this order: truth, task, assets, distinctiveness.** Reject a concept if its premise is false, if it fights the actual task, if it needs assets you can't obtain, or if — among survivors — it doesn't uniquely fit this material with the fewest unrelated decorations.
- **Translate mood into observable decisions.** Limit direction to three adjectives, each paired with a consequence and an exclusion (e.g. "tactile means visible texture in authentic imagery, not a paper-texture overlay"). A mood word that can't change a layout, asset, sentence, or transition isn't useful yet.
- **Write the narrative as a change in the viewer's understanding**, not a cinematic story. For a tool this is a task sequence: recognize → narrow → inspect → retain. Write the one-sentence tie-breaker (e.g. "The posters provide expression; the catalog provides order") and use it throughout production.

## 2. Composition

- **Choose a structure from the artifact's job.** Work-first: restrained shell, dominant work region. Reading-first: start with the actual argument, `640px` max text column, `18px/28px` type. Scene-first: viewport below a `56px` toolbar, unframed, `44px` controls `16px` from occupied edges, `76px` reserved at edges framing important content. Don't add a landing page before an application unless the brief requires one.
- **Establish page geometry before arranging components.** A concrete responsive system: `≥1024px` → 12 columns, `24px` gaps, `1200px` max width, `≥32px` outer margins; `768–1023px` → 8 columns, `20px` gaps, `24px` margins; `<768px` → 4 columns, `12px` gaps, `16px` margins.
- **Allocate area according to the task, not aesthetics.** Give the working region the columns its job requires (e.g. filters 3/12, results 9/12 on desktop, collapsing to filters-above-results below 1024px). Give media a stable display area with `object-fit: contain` that preserves the source's real proportions.
- **Draw the attention path explicitly.** Mark the intended starting region, the next question it raises, and the region that answers it. Don't assume an F- or Z-pattern rescues incoherent content order.
- **Balance visual weight, not equal rectangles.** Weight comes from area, contrast, saturation, edge density, motion — not size alone. Check a grayscale thumbnail; if one side is heavy, move existing content or resize an image rather than adding a filler graphic on the other side.
- **Give negative space a specific job.** Starting rhythm: `8px` label-to-value, `16px` within a group, `32px` between task groups, `64px` between major desktop sections (`40px` mobile). Increase separation when unrelated groups feel connected; decrease it when related facts require a visual jump. Empty space isn't inherently premium; low density isn't inherently calm.
- **Choose grid vs. freeform by meaning.** Grid for comparison/search/scan/repeated action. Freeform when position itself carries meaning (a map, a game board) or an explicitly expressive composition needs it — name every anchor's responsive behavior, allow `0px` overlap with text/controls/evidence.
- **Treat a hero as a special case, not the default.** When genuinely needed: full-bleed image/scene with text directly over it, title = the actual product/place/person, target height `min(640px, calc(100svh - nav-height - 80px))`, keep ≥80px of the next section visible, never clip text or the subject to hit the target.

## 3. Art direction

- **Turn the concept into a grammar, not a mood board.** One rule each for palette, typography, imagery, composition, motion, language. A mood board is only useful with an annotation on every reference stating what's borrowed and what's explicitly rejected.
- **Assign palette by role and visual ownership.** Named roles (background/text/rule/interactive/error), decorative interface color kept below ~5% of the visible area (excluding content and status). Don't recolor source material to match the interface.
- **Choose typography for the material and reading behavior.** Fixed sizes at named breakpoints, never viewport-scaled. Distinguish readable labels from systematic identifiers (mono for catalog IDs) when the concept supports it.
- **Write an asset brief before sourcing imagery**: subject, viewpoint, treatment, what must stay inspectable. Use actual or clearly identified representative material — never present generated content as an authentic record.
- **Select one recurring visual device**, justified by a real function (e.g. a 1px rule organizing an index and metadata). A second device needs its own real function. The concept must survive removing anything unjustified.
- **Make motion express state and spatial relationships**, not ornament. Name exact durations/easing for the artifact's actual interactions; remove ambient decoration unless the concept specifically needs a living field. Under reduced motion, remove nonessential movement.
- **Give copy the same character as the composition.** Concrete, functional labels for transactional UI even inside an otherwise editorial voice. Verify facts before polishing tone.
- **Require each expressive choice to pass two tests**: does it support the governing idea, and does it preserve the task? A choice that helps meaning but breaks the task fails.

## 4. Visual hierarchy

- **Write a three-rank attention contract** naming specific content, not "the hero" — first/second/third for the main view AND for each materially different state (e.g. a detail view gets its own contract).
- **Give the primary region two strong advantages**, typically area + isolation — not also enlarging every nearby label, adding a colored background, and animating it. Multiple simultaneous emphasis techniques cancel each other into visual noise.
- **Create secondary/tertiary levels without making them unreadable.** Reduce weight, area, and prominence before reducing contrast; necessary information doesn't become optional because it's visually third.
- **Control competition at the task level.** One command gets the highest emphasis per active task group; never make every filter look primary. Selection needs a shape/mark/text cue in addition to color and must not change the element's dimensions.
- **Keep visual, reading, and interaction order compatible.** A visually right-hand panel must not unexpectedly come first for keyboard/screen-reader users. Preserve focus across opening/closing detail views.
- **Test hierarchy with three views**: the normal page, an 8px-blurred screenshot (dominant masses), and a grayscale screenshot (color dependence). If independent reviewers are available, a five-second recognition check can supplement the comparison; record who reviewed it and do not invent review results. Safety-critical/destructive confirmations override normal aesthetic ranking and must be unmistakable regardless of test results.

## 5. Designed vs. assembled

| | Before (assembled) | After (designed) |
|---|---|---|
| Structure | Generic card rows regardless of content | Structure matches the real information types; cards reserved for repeated items/modals/tools; no nested cards |
| Alignment | Each section internally tidy, different start x | A shared reference line (e.g. `x = 120px` desktop) ties sections together |
| Imagery | One stock photo + one illustration + inconsistent crops | All media reveal the actual subject under one declared framing rule |
| Type & color | New heading style/accent per section | Type expresses stable content roles; interactive color always means the same thing |
| Motifs | A pile of surface-level style ingredients (textures, stickers, arbitrary rotations) | A small set of meaningful, justified relationships |
| Motion & voice | Springy buttons + cinematic entrances + playful errors, unexplained | One behavioral character; restrained transitions track real actions; status language stays factual |
| Responsiveness | Squeezed until labels wrap unpredictably | Mobile recomposes the same idea under new constraints, content order intact |
| States | Populated view polished; loading/empty use generic defaults | Loading/empty/error states share alignment, typography, and task context |

Know when to stop: remove anything that repeats info without new understanding, adds a visual language without narrative reason, competes with the focal point, fills space because it "looks empty," or turns a quiet concept into generic "premium styling." Complete, not exhausted.

## 6. Process: brief → artifact

1. **Write the six-field brief contract** + one success sentence. Separate supplied facts from assumptions.
2. **Inventory the real material** — content types, images, metadata, interactions, states, including the longest actual title, an empty collection, a failed operation, a large result set. Never design only for perfect short copy.
3. **Resolve the direction** from the reference or product evidence. For open new-design work, compare concepts using truth → task → assets → distinctiveness; record the selected direction.
4. **Rank content before drawing** — first/second/third for the main view and each materially different state; remove blocks that answer no user question.
5. **Check composition with real content lengths and image proportions.** Compare grayscale alternatives when composition is still open; otherwise measure against the designated reference.
6. **Build the decisive first view with real content** at desktop and mobile widths; don't polish the footer first; reject a composition needing explanatory prose to be recognizable.
7. **Specify the art-direction grammar** — governing idea, image treatment, palette roles, type roles, recurring device, motion behavior, copy register — and test them together on one main view and one secondary view.
8. **Lay out the whole artifact before polishing individual parts.** Verify a deliberate beginning, working middle, appropriate endpoint.
9. **Implement responsively** — named breakpoints, shared alignments, image aspect ratios, content order; icon controls follow the [target policy](design-tokens.md#control-size-and-hit-area); no viewport-scaled fonts or fixed-height clipping containers.
10. **Use the requested delivery format.** For a self-contained file, embed required CSS/JS/assets and measure the finished size. For a product change, reuse its modules, assets, and build; do not turn it into a separate single-file application.
11. **Complete interactions and state transitions** — search, filter, select, open/close, empty, reset, loading, failure recovery — using established conventions and an existing icon library.
12. **Run structural and accessibility checks** — reading order, keyboard access, visible focus, icon names, contrast, reduced motion, 200% text, reflow at 320px. Fix clipping/overlap via layout or content grouping, never by hiding required information.
13. **Capture and compare the actual rendering** using the [fixed viewport and fixture procedure](verification.md); inspect hierarchy, density, wrapping, images, and control positions against the designated reference. For canvas/3D, also confirm nonblank pixels and visible changes after interaction.
14. **Test under the required delivery conditions** — verify assets, exercise the primary task, check runtime errors, and test offline only when offline delivery is required. When a failure appears, identify its layer: wrong meaning → concept; wrong priority → composition; illegibility → type/contrast; broken behavior → implementation.
15. **Perform a subtraction pass and freeze.** Remove each decorative element temporarily; keep it only if removal weakens identity, meaning, orientation, or feedback. Finish when content, the required interaction path, responsive compositions, and the requested delivery format pass; report any verification gap.
