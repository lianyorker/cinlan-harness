# SVG Illustration Craft — Cinlan Design

SVG illustration guidance. The literal colors below belong to the worked illustration's asset palette, not to the application's UI token system. Worked example throughout: a rabbit coasting on a bicycle, authored in a `960 × 640` coordinate system. Goal: a readable illustration with controlled depth, expressive motion, reusable geometry, coherent visual language — not merely recognizable objects.

## 1. Scene layers

SVG paints later elements over earlier ones — DOM order is the primary depth mechanism.

1. **Background**: `<rect width="960" height="640" fill="#E7F1F3"/>` + a sun `<circle cx="798" cy="108" r="34" fill="#F3CA5D"/>`. Keep background objects outline-free so they don't compete with the subject.
2. **Midground**: a hill path, then a ground rect, then the bicycle's ground shadow — drawn before its wheels.
3. **Subject**: order scarf and far-side limbs → wheels → bicycle frame → torso → near-side limbs → ears → head → facial details. Split the character across multiple groups whenever a bicycle component must pass between its far and near limbs.
4. **Foreground**: sparse grass strokes that frame the subject without obscuring tire contacts.

```svg
<svg viewBox="0 0 960 640" role="img" aria-labelledby="ride-title ride-desc">
  <title id="ride-title">Rabbit on a bicycle</title>
  <desc id="ride-desc">A rabbit coasts on a teal bicycle through a green landscape.</desc>
  <!-- defs, then: -->
  <g id="ride-background"/><g id="ride-midground"/><g id="ride-subject"/><g id="ride-foreground"/>
</svg>
```

### Focal hierarchy

Decide notice-order explicitly (1st: face+silhouette, 2nd: wheels+direction, 3rd: road/motion). Keep the sky low-contrast, simplify distant forms, reserve the strongest outlines and warmest highlights for the subject — not the most detail everywhere.

### Depth via overlap, not only scale

Far: lower saturation, lighter values, thin/no outlines. Mid: moderate contrast, simplified internal detail. Foreground: darker/more saturated, larger, partial cropping, sharper texture. **Avoid tangencies** — two contours merely touching reads as ambiguous; overlap clearly or separate by a visible gap.

### Block silhouettes before details

Build background/bicycle/animal as flat fills first; hide eyes/fur/spokes/texture. At thumbnail size verify: rider distinguishable from bicycle, travel direction obvious, wheel centers on a believable ground line, pose has clear gesture, subject reads as a solid silhouette. Details cannot repair a weak outer contour.

### Deliberate occlusion order (bicycle + rider)

Rear wheel → front wheel → rear frame → crank/pedals → fork/handlebar/front frame → rider legs/feet → torso/arms → paws over handlebar → head/ears/tail/clothing → foreground grass/dust. A leg behind the frame is drawn before the frame; a foot in front of a pedal is drawn after it — think in physical intersections, not one undifferentiated character group.

## 2. defs / use / clipPath / masks

`<defs>` for nonrendering definitions with stable descriptive IDs (prefix uniquely when embedding multiple illustrations); `<g>` for reusable geometry in unchanged user units; `<symbol>` when an instance needs its own `viewBox` and explicit dimensions. Reference with `href`, not the obsolete `xlink:href`. Use `currentColor` for instance-specific color — a hardcoded fill inside a `<symbol>` will not respond to `fill` set on its `<use>`.

```svg
<defs>
  <path id="ride-body" d="M426 366 C408 343 418 305 448 281 C469 264.2 492 265 507 285 C519 301 503 331 480 347 L451 369Z"/>
  <g id="ride-spokes" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M-52 0H52 M0-52V52 M-37-37L37 37 M-37 37L37-37"/>
  </g>
  <symbol id="ride-wheel" viewBox="-64 -64 128 128">
    <circle r="58" fill="none" stroke="#243840" stroke-width="8"/>
    <use href="#ride-spokes"/><circle r="52" fill="none" stroke="currentColor" stroke-width="2"/><circle r="7" fill="#243840"/>
  </symbol>
  <clipPath id="ride-body-clip" clipPathUnits="userSpaceOnUse"><use href="#ride-body"/></clipPath>
  <linearGradient id="ride-fade" gradientUnits="userSpaceOnUse" x1="430" y1="285" x2="501" y2="349">
    <stop offset="0" stop-color="white" stop-opacity="0"/><stop offset="1" stop-color="white" stop-opacity=".18"/>
  </linearGradient>
  <mask id="ride-body-mask" maskUnits="userSpaceOnUse" x="408" y="260" width="120" height="118" style="mask-type:alpha">
    <rect x="408" y="260" width="120" height="118" fill="url(#ride-fade)"/>
  </mask>
</defs>
```

A `clipPath` restricts rendering to a geometric interior with an antialiased boundary but gives no gradual opacity fade. An alpha mask does: alpha `0` hides, alpha `1` reveals, alpha `.18` transmits 18% of the overlay. In an alpha mask, opaque black still *reveals* — black only means "hide" in a luminance mask. Keep a body, its clipped overlays, and its final outline inside the same transformed parent so coordinate systems stay aligned.

## 3. Organic paths

- **Cubic `C`** for shoulders/backs/cheeks — contours needing independently controlled entry and exit tangents. When chaining cubics, choose the next control point as a scaled reflection of the previous one (`P + k(P−C2)`) to preserve tangent direction; `S` is only correct when its implicit reflected control is actually the one you want.
- **Quadratic `Q`** for a single uncomplicated bend (an arm, a blade of grass). Its endpoint is the point the curve passes through; its control point only pulls the curve, it is not on the path. Use explicit `Q` until curvature is settled — `T` reflects the previous control and can introduce an unwanted bend.
- **Fill vs. stroke**: close substantial silhouettes with `Z` and fill them (ears, torso); use `fill="none"` with a centerline stroke for limbs and mechanical tubing. Layer a wider dark outline stroke under a narrower color stroke (e.g. `18`-unit dark under `12`-unit fill color) for a hand-drawn bordered look — leaves an even outline on each side. Round caps/joins for anatomy; butt caps for hidden terminations; square caps for exposed flat terminals (extends the stroke by half its width beyond the endpoint); bevel joins for clipped corners; miter with `stroke-miterlimit` for controlled sharp corners.

## 4. Texture and depth

Use one light direction (e.g. upper-left) consistently across the whole scene. A body-fill gradient running in that direction plus an alpha-masked dark overlay on the shadowed side reads as volume without a second light source. Grain is a low-opacity **surface** treatment applied inside a clip, never an outline treatment — a small tiled `<pattern>` with a couple of low-opacity dots/marks unifies the palette.

```svg
<ellipse cx="476" cy="532" rx="202" ry="10" fill="#243840" opacity=".18" filter="url(#ride-shadow)"/>
<g clip-path="url(#ride-body-clip)">
  <use href="#ride-body" fill="url(#ride-coat)"/>
  <rect x="408" y="260" width="120" height="118" fill="#243840" mask="url(#ride-body-mask)"/>
  <rect x="408" y="260" width="120" height="118" fill="url(#ride-grain)"/>
</g>
<use href="#ride-body" fill="none" stroke="#243840" stroke-width="3" stroke-linejoin="round"/>
```

A Gaussian-blur `<filter>`'s bounding box must extend beyond the unfiltered shape by roughly 4 standard deviations on every side, or the blur clips visibly at its edge — size the `filter` region's `x/y/width/height` accordingly. Use unblurred small "contact ellipses" at wheel/foot touch points to ground the subject precisely, drawn before the wheels. Use overlap for local occlusion (a leg behind the frame, an ear root buried behind the head by a small margin, a hand overlapping its grip) rather than a blur filter — cheaper and crisper. Never blur the complete subject, and never apply the same drop shadow independently to every body part.

## 5. Making it feel alive

Establish concrete anchor points before drawing: torso bounding box, head/muzzle ellipse centers and radii, pelvis/shoulder/hand positions, crank center and pedal contact points, leg centerlines as short Bezier paths between those anchors. Treat a coasting pose as: crank/legs/torso/hands held stationary while only wheels turn, an ear sways, and an eye blinks — the illusion of life comes from a few independently-phased small motions, not everything moving.

```css
.ride-wheel-turn { transform-box: fill-box; transform-origin: 50% 50%; animation: ride-roll 1.6s linear infinite; }
.ride-ear { transform-box: fill-box; transform-origin: 50% 100%; animation: ride-sway 1.6s ease-in-out -.2s infinite; }
.ride-eye { transform-box: fill-box; transform-origin: 50% 50%; animation: ride-blink 5.6s linear infinite; }
@keyframes ride-roll { to { transform: rotate(360deg); } }
@keyframes ride-sway { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(3deg); } }
@keyframes ride-blink { 0%,43%,47%,100% { transform: scaleY(1); } 45% { transform: scaleY(.12); } }
@media (prefers-reduced-motion: reduce) { .ride-wheel-turn, .ride-ear, .ride-eye { animation: none; transform: none; } }
```

Animate an inner element and leave placement translation on an outer group — a CSS `animation` targeting `transform` replaces any static `transform` already on that same element, so translation and rotation/scale must live on different nodes in the hierarchy. Choose a pivot that is exactly the element's local `(0,0)` (e.g. an ear's bottom-center) so rotation leaves its attachment point fixed — no extra `transform-origin` offset needed. Secondary elements (scarf, flowers, clouds) drift on their own slower phase, driven from the same clock but different frequencies (see [interactive artifacts](interactive-artifacts.md) for the JS-driven version of this pattern).

## 6. Coordinates and viewBox discipline

Keep the artboard permanently at one fixed `viewBox`; change only the rendered display size via CSS. Reserve a safe margin (e.g. `48` units) so a content rectangle sits inside the full canvas without touching edges. Establish ground contact explicitly: a wheel's visual bottom equals its center-y plus its path radius plus half its stroke width — solve for that sum and place the ground line exactly there, not by eye. Use root/scene coordinates for placement, local coordinates (via a translated `<g>`) for repeated or rotating components, so a wheel's spokes can be authored around `(0,0)` and then positioned.

```html
<svg class="ride-scene" viewBox="0 0 960 640" preserveAspectRatio="xMidYMid meet">…</svg>
<style>.ride-scene { display:block; width:100%; max-width:960px; height:auto; aspect-ratio:3/2; margin-inline:auto; overflow:hidden; }</style>
```

For `preserveAspectRatio="xMidYMid meet"` at a fixed viewport `W×H`: scale `s = min(W/960, H/640)`, offsets `offsetX=(W-960s)/2`, `offsetY=(H-640s)/2`; a scene point `(x,y)` maps to `(offsetX+sx, offsetY+sy)`. For pointer input on the live SVG, use `new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse())` so browser layout and SVG transforms are both accounted for — don't hand-roll the inverse.

Let stroke widths scale normally with the rendered size (a `3`-unit outline becomes `1px`/`2px`/`3px` at proportionally smaller/larger render widths); reserve `vector-effect="non-scaling-stroke"` only for paths that deliberately need constant on-screen thickness regardless of scale. Before adding further detail, check: tire/foot contact points, hand/grip overlap, ear attachment throughout the animation, mask/gradient alignment, shadow-filter clipping, unique IDs across the document, and the reduced-motion state.
