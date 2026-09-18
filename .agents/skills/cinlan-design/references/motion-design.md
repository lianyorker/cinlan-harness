# Motion Design — Cinlan Design

Motion guidance for web interfaces. Reuse existing product motion; generic duration and easing values live in [tokens.css](tokens.css). Motion communicates **what changed, why, where it came from, and what the user can do next** — it's part of the information architecture, not decoration added after.

## 0. Governing rules

1. Animate state, not decoration — every motion communicates cause/effect, spatial relationship, hierarchy, or system status.
2. Use `transform`/`opacity` first; animate layout properties only when the layout change itself *is* the information.
3. One primary motion, at most two secondary motions per element.
4. Interaction feedback is always faster than navigation feedback.
5. Use the shortest duration that preserves recognition — understood before the movement finishes, never waited-for.
6. Motion is interruptible: a new user action retargets or cancels the old animation rather than queuing, except explicitly queued status messages.
7. Measure from the input event: first visible response within `50ms`, target `16ms` for direct manipulation.
8. Respect `prefers-reduced-motion`: remove nonessential travel/parallax/scale/rotation/looping; preserve opacity, focus visibility, and essential status cues at `≤100ms`.
9. Distance-to-duration relationship: `0–4px:80–120ms · 5–24px:140–220ms · 25–120px:220–320ms · 121–480px:320–480ms · >480px: cap 500ms`, no linear scaling beyond that.
10. Don't animate an element solely because it can be — if the motion explains nothing, remove it.

## 1. Easing curve selection

Use the `--ease-*` variables from [tokens.css](tokens.css); do not redeclare an independent easing set in components.

| Curve | Use | Avoid for |
|---|---|---|
| Linear | Progress bars, continuously-driven values, color interpolation | Entrances/exits |
| Ease-in | An object leaving, deliberate departure | Reveals, direct manipulation |
| Ease-out (default arrival) | Entrances, hover feedback, menus/panels arriving | Long loops, progress |
| Ease-in-out | Reversible in-place state changes: toggle thumb, tab underline, crossfade | Immediate feedback needing instant feel |
| Standard | General movement, page transitions, cards repositioning | Small presses under 120ms |
| Emphasized | High-priority modal, primary nav transition | Repeated list items, tooltips |
| Pressed | Button/toggle press, touch feedback | Large-distance movement |

Enter with ease-out; exit with a shorter ease-in — e.g. a toast enters `240ms` ease-out, leaves `160ms` ease-in. Never use ease-in-out for a small tooltip/button (the ramp-up feels sluggish); never ease-in an entrance (looks unresponsive); never ease-out an exit (lingers, competes with the arriving state).

### Springs

Use only for physical/directly-manipulable relationships: drag release, sheets, reorderable items, docking, pull-to-refresh.

| Preset | Stiffness | Damping | Use | Max settle |
|---|---:|---:|---|---:|
| `spring-snappy` | 500 | 30 | Small drag recovery, `0–24px` | `320ms` |
| `spring-standard` | 300 | 24 | Cards, sheets, menus, `25–240px` | `480ms` |
| `spring-soft` | 220 | 26 | Large panels/objects, `>240px` | `600ms` |
| `spring-bouncy` | 400 | 20 | One-off celebratory confirmation only | `520ms` |

Limit overshoot to `2–6%` of travel; stop when velocity < `0.01`/frame or at the max settle time; retarget from current position/velocity on reversal, never reset to start; never spring text, focus indicators, or destructive/financial/accessibility-critical actions; one spring system per coupled group, not independent springs per child.

### Choosing between curves (decision sequence)

1. Continuously driven value → linear/direct mapping. 2. Directly dragged/released → spring. 3. Arriving → ease-out. 4. Leaving → ease-in. 5. Changing state in place → ease-in-out. 6. High-priority + spatially large → emphasized (max `400ms`). 7. Pressed response under `120ms` → pressed curve. 8. Repeating → linear or symmetric ease-in-out, never a restarting ease-out.

## 2. Duration scale

Use the `--duration-*` variables from [tokens.css](tokens.css). Interaction-specific timings below are examples to resolve once in the project motion settings.

Choose shared duration roles for routine UI. Record a separate measured timing when direct manipulation, media, or a supplied reference needs one; do not impose a second approved-value list.

| Interaction | Duration | Curve |
|---|---:|---|
| Pointer-down acknowledgement | `0–50ms`, target `16ms` | pressed |
| Button color/border feedback | `--duration-micro`; no default compression | standard |
| Hover color/border | `120ms` | ease-out |
| Focus ring | `100ms` | ease-out |
| Toggle thumb / tab indicator | `180ms` | ease-in-out |
| Tooltip entrance / exit | `160ms` / `100ms` | ease-out / ease-in |
| Toast entrance / exit | `240ms` / `180ms` | ease-out / ease-in |
| Dropdown entrance / exit | `200ms` / `140ms` | ease-out / ease-in |
| Accordion open / close | `240ms` / `180ms` | ease-in-out / ease-in |
| Modal backdrop / surface entrance | `200ms` / `320ms` | ease-out (surface starts `40ms` after backdrop) |
| Modal exit (backdrop + surface together) | `160ms` / `200ms` | ease-in |
| Bottom sheet entrance / exit | `320ms` spring-standard / `240ms` ease-in | — |
| Page transition, same hierarchy / major reorientation | `240ms` / `320ms` (max `400ms`) | ease-in-out / emphasized |
| Skeleton shimmer | `1400ms` | linear |

Entrance/exit rule: exit is normally `40–80ms` shorter than its matching entrance (`240→160`, `280→180`, `320→200`, `400→240`); an exit's delay is always `0ms`; max total wait for one interaction sequence is `500ms` (`800ms` only for cinematic/onboarding, with an immediate skip).

Distance/scale/opacity adjustments: translation `0–8px:120–160ms · 9–24px:160–200ms · 25–120px:200–280ms · 121–300px:280–360ms · 301–480px:360–480ms`; scale `0.98→1:120–160ms · 0.96→1:160–200ms · 0.92→1:200–280ms` (never scale full page/text beyond `0.96` on entrance); opacity `120ms` micro, `160ms` control/tooltip, `200–240ms` surface, `100–180ms` exit.

## 3. Choreography

Sequence hierarchy: container/backdrop → primary surface → primary focal object → supporting content → secondary/decoration last. A child shouldn't appear before the surface containing it unless intentionally leading.

| Content type | Stagger | Max items | Max added delay |
|---|---:|---:|---:|
| Tiny control group | `16ms` | 6 | `80ms` |
| Navigation items | `24ms` | 8 | `168ms` |
| List/grid cards | `32ms` | 8 | `224ms` |
| Dialog sections | `40ms` | 5 | `160ms` |
| Onboarding/editorial scene | `60ms` | 6 | `300ms` |
| Decorative particles | `80ms` | 4 | `240ms` |

`delay(index) = min(index × stagger, max-added-delay)`. Never stagger content the user needs to scan immediately (table rows, search results, form labels, error messages) — reveal in one `160–240ms` group transition instead. Cap page-load stagger at `300ms` total. If the user interacts mid-stagger, cancel not-yet-started items and show the target state within `120ms`. Overlap children `40–80ms` after their surface begins rather than waiting for full completion; start an exit and its backdrop exit simultaneously, never serialized.

## 4. Secondary motion and follow-through

Limits: secondary travel `2–8px`, rotation `2–8deg`, scale `1.01–1.04`, opacity `0.08–0.24`, delay `20–80ms` after primary, duration = primary + `40–120ms`, overshoot `2–6%` of secondary travel, max 2 secondary properties per element — never stack max travel + max rotation + max scale + max opacity on one small element.

- **Parent-child lag**: `20ms` icon-on-button, `40ms` label-on-toggle, `60ms` decorative-detail-on-card.
- **Overshoot and settle**: primary `0–240ms` ease-out, settle `180–280ms` spring-snappy, keep settle to `2–6px`/`1–3deg`, no second bounce.
- **Error shake**: `240ms` total, max `4px` amplitude, one repetition only, always paired with text/icon/focus — never the sole error signal.
- **Success confirmation**: draw the mark `160ms` ease-out, scale `0.96→1.03` over `120ms`, settle `1.03→1.00` over `120ms`, delay any highlight `40ms`.
- **Weight/inertia** (timing communicates weight, not bounce size): light control `80–160ms`/`0–2px` overshoot; standard surface `200–320ms`/`2–4px`; heavy sheet/modal `280–480ms`/`0–6px`; large illustration `320–600ms`/`4–12px`. Never `>10%` overshoot on ordinary components.

## 5. Ambient and idle motion

Only animate ambiently when all hold: it's nonessential decoration/status/active-system-state; it doesn't change layout; it stays peripheral without demanding attention; it pauses on input, reduced-motion, hidden document, low-power; ≤2 simultaneously-moving properties.

| Element | Amplitude | Duration | Rule |
|---|---:|---:|---|
| Background drift | `2–6px` | `12000ms` | phase-offset each object `2000ms` |
| Floating illustration | `4–8px` | `6000ms` | pause on input |
| Pulsing status dot | `0.08–0.16` opacity | `2000ms` | only for genuinely active status |
| Loading spinner | `360deg` | `1000ms`/turn | linear, stop immediately on completion |
| Skeleton shimmer | full width | `1400ms` | linear, one active shimmer per region |

Pause ambient motion after `2000ms` of active input, resume `1000ms` after input stops; pause fully on `visibilitychange`; never use looping motion to fake urgency for a non-actionable notification; never use infinite motion for a one-time completion (end after 1 cycle or `160–320ms`).

Loading motion: spinner for indeterminate <10s; progress bar when percentage is known; skeleton for content expected >300ms, delayed `150ms` to avoid flashing fast responses, kept visible ≥300ms once shown; crossfade to real content over `160ms`.

## 6. Reduced-motion behavior

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 100ms !important;
    transition-delay: 0ms !important;
  }
}
```

Replace, don't just shorten: parallax → `0px` travel + `100ms` opacity; large page translation → `100ms` crossfade; rotation → `100ms` opacity or static change; spring bounce → `100ms` ease-out with zero overshoot; ambient loops → stopped entirely; auto-advancing carousels → stopped, manual controls retained; error shake → `100ms` border/focus-color transition. Never remove focus indication, loading status, progress updates, drag feedback, or motion necessary to understand cause and effect.

## 7. Anti-patterns

**Timing/easing**: one duration everywhere; arbitrary non-token durations; feedback slower than `200ms`; an ordinary transition `>500ms`; undefined `ease`; linear entrances/exits; ease-in on entrances or ease-out on exits; ease-in-out on immediate feedback; a spring on every animation; uncontrolled bounce `>6%`; multiple bounces; restarting a looping ease-out at its boundary; delaying direct feedback or an exit; stacking nested transition delays; waiting for serial completion instead of `40–80ms` overlap; animating to an unmeasured endpoint.

**Excessive motion**: animating every element on page load; staggering entire tables/search results; staggering >8 items or >300ms of load-time stagger; combining translate+rotate+scale+blur+opacity+color on one element; large travel for small feedback; scaling text or the whole page; shake as the only error signal; bounce on destructive/financial/medical actions; perpetual motion to create urgency; parallax on essential content; cursor-follow effects with no `1000ms` idle stop; motion blur as an easing substitute; pulsing static controls; blinking text.

**Interaction/state**: animating a state the click may not have committed; showing success before the operation actually succeeds; leaving stale motion running after unmount; interactive elements remaining clickable while visually hidden; queueing repeated animations instead of retargeting; replaying entrance on every render instead of only on real transitions; a delayed tooltip on keyboard focus (must be `0ms`); hiding focus during a transition; making an element interactive before it's readable (`>100ms` delay); moving content the user has begun reading.

**Layout/performance**: animating `top/left/width/height` by default; `transition: all`; unbounded `setInterval` as a clock; `will-change` applied everywhere and left on; too many composited layers; animating unoptimized large images; fractional geometry that shifts every frame; ignoring frame budget (`>16.67ms` on 60Hz); running ambient motion in background tabs.

**Accessibility/sensory**: ignoring `prefers-reduced-motion`; replacing all motion with instant disappearance and losing essential cause/effect cues; large viewport movement (full-screen zoom/spin/parallax) for essential navigation; rapid flashes; pulsing faster than `1200ms` for a status cue; moving focus during an animation; color/motion as the only state cue; auto-advancing content with no pause/position control; shrinking a hit target below `44×44px` on press.

**Spatial/semantic**: teleporting related content instead of a shared-element/directional transition; contradictory directions for related navigation; wrong transform-origin (a menu should grow from its anchor, a sheet from its edge); a full-page slide for a small local update; identical motion for drawer/dialog/menu/tooltip regardless of their different spatial relationships; a misleading morph on a shared element that changed identity.

## 8. Recommended default recipe

```css
.surface {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
  transition: opacity var(--duration-standard) var(--ease-out),
              transform var(--duration-entrance) var(--ease-out);
}
.surface[data-state="open"] { opacity: 1; transform: translateY(0) scale(1); }

.button { transition: background-color var(--duration-micro) var(--ease-standard),
                      border-color var(--duration-micro) var(--ease-standard); }
```

`0ms` delay on the surface itself, `40ms` on its first supporting child, `32ms` sibling stagger for a list, `160–200ms` for the corresponding exit. Swap the transition for `spring-standard` when the surface is directly dragged or released.
