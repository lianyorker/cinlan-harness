# Interactive Artifacts — Cinlan Design

Engineering methodology for self-contained interactive HTML artifacts, distilled from gpt-6-astra (reasoning=max). This is the layer that separates a real artifact from a static mockup — **treat the file as a small application, not a page with a script appended**.

Responsibilities stay explicit even in one file: **HTML = document + accessibility surface, CSS = rendering + styling, JS = state + behavior**.

## Implementation order

1. Define the semantic DOM and the no-JavaScript experience.
2. Decide which behavior genuinely requires JavaScript.
3. Define a small state model and its transitions.
4. Choose the animation driver for each visual behavior.
5. Cache DOM references; wire controls through functions that also update accessibility state.
6. Add lifecycle handling: visibility, reduced motion, cleanup, fallback.
7. Test timekeeping, control transitions, keyboard access, resizing under real conditions.

## 1. JS vs CSS — the decision rule

Use pure HTML/CSS only when **every required behavior** can be expressed through native HTML state, CSS selectors, media/container queries, and declarative animation, while keeping correct semantics and keyboard operation — `<details>` disclosure, native checkbox/radio selection, hover/focus styling, a checkbox-driven `animation-play-state`. The existence of state alone doesn't require JS: native controls already maintain state.

Add JS when any requirement needs **application-owned state, computed geometry, simulation, runtime data, persistence, asynchronous work, coordinated timelines, seeking, phase-preserving speed changes, page-visibility handling, or accessible attributes native HTML can't maintain.** A custom play button whose name changes between "Play animation"/"Pause animation" requires JS; a native checkbox labeled "Animation" driving a CSS loop can work without it.

For a genuinely self-contained artifact: inline CSS/JS/required assets, no network requests, no external fonts/imports, no fetching sibling files from `file://`. Bundle any domain library into the HTML with its license notice.

## 2. Single-file architecture

Use an inline ES module with a root-scoped `mount(root)` returning an idempotent cleanup function. Cache required nodes once and fail immediately if the markup contract is broken. Keep user intent, environmental permissions, simulation state, and scheduler bookkeeping in separate fields. Event handlers update the model; rendering derives DOM output from that model — never reconstruct state from button text, computed transforms, or classes. Cache measured geometry via a resize handler or `ResizeObserver`; don't query layout repeatedly inside the animation loop.

```html
<motion-scene>
  <svg viewBox="0 0 160 160" role="img" aria-label="Pedal crank">…</svg>
  <div data-controls hidden>
    <button type="button" data-play aria-label="Play animation">Play animation</button>
    <label>Speed <input data-speed type="range" min="0.25" max="3" step="0.25" value="1"></label>
    <span data-rate aria-hidden="true">1.00x</span>
  </div>
  <noscript><p>JavaScript is disabled.</p></noscript>
</motion-scene>
<script type="module">
function mount(root) {
  const get = key => { const n = root.querySelector(`[data-${key}]`); if (!n) throw new Error(`Missing data-${key}`); return n; };
  const [controls, play, speed, rate] = ["controls","play","speed","rate"].map(get);
  const media = matchMedia("(prefers-reduced-motion: reduce)"), lifetime = new AbortController();
  const s = { wanted: true, visible: !document.hidden, reduced: media.matches, override: false, speed: 1, time: 0, last: null, raf: null, dead: false };
  const armed = () => s.wanted && (!s.reduced || s.override);
  const running = () => !s.dead && s.visible && armed();
  function advance(now) { if (s.last === null) return; const dt = Math.min(Math.max(now - s.last, 0), 50) / 1000; s.last = Math.max(s.last, now); s.time += dt * s.speed; }
  function frame(now) { s.raf = null; if (!running()) { s.last = null; return; } advance(now); render(); s.raf = requestAnimationFrame(frame); }
  function sync() {
    if (!running()) { if (s.raf !== null) cancelAnimationFrame(s.raf); s.raf = null; s.last = null; }
    else if (s.raf === null) { s.last = performance.now(); s.raf = requestAnimationFrame(frame); }
    const label = armed() ? "Pause animation" : "Play animation"; play.textContent = label; play.setAttribute("aria-label", label);
    speed.value = String(s.speed); rate.textContent = `${s.speed.toFixed(2)}x`;
  }
  function change(update) { if (s.dead) return; advance(performance.now()); update(); sync(); }
  const on = (t, type, h) => t.addEventListener(type, h, { signal: lifetime.signal });
  on(play, "click", () => change(() => { const start = !armed(); s.wanted = start; s.override = start && s.reduced; }));
  on(speed, "input", () => { const v = speed.valueAsNumber; if (!Number.isFinite(v)) { sync(); return; } change(() => { s.speed = Math.max(0.25, Math.min(3, Math.round(v * 4) / 4)); }); });
  on(document, "visibilitychange", () => change(() => { s.visible = !document.hidden; }));
  on(media, "change", e => change(() => { s.reduced = e.matches; s.override = false; }));
  sync(); controls.hidden = false;
  return () => { if (s.dead) return; s.dead = true; lifetime.abort(); if (s.raf !== null) cancelAnimationFrame(s.raf); controls.hidden = true; };
}
customElements.define("motion-scene", class extends HTMLElement {
  connectedCallback() { this.cleanup ??= mount(this); }
  disconnectedCallback() { this.cleanup?.(); this.cleanup = null; }
});
</script>
```

Key properties: **one state object, one frame scheduler, one time source, one render boundary, one synchronization path for control state.**

## 3. Animation drivers — when each

- **CSS keyframes** — authored, self-contained visual sequences whose intermediate values need no simulation or shared computed geometry. Pause with `animation-play-state: paused` (preserves position); don't implement phase-preserving speed control via `animation-duration` — that remaps existing elapsed time onto progress incorrectly.
- **`requestAnimationFrame`** — every frame depends on computed geometry, physics, inverse kinematics, canvas rendering, or a shared scene clock. Exactly one scheduling owner per scene: read one timestamp, advance the model once, calculate all poses, then batch writes. Never use `setInterval` as the animation clock or advance by a fixed amount per rendered frame.
- **Web Animations API** — the browser can interpolate the properties but JS must orchestrate playback/seeking/reversing/completion. Choose exactly one clock owner: autonomous playback uses `play()`/`pause()`/`updatePlaybackRate(rate)`; an effect attached to the scene clock stays paused at rate `1` and gets `a.currentTime = s.time * 1000` during render — never apply the speed multiplier to both. Store handles and cancel them during cleanup; handle a `finished` promise's `AbortError` from cancellation.

### Kinematics / connected parts

Drive connected body parts from **one phase/time source**; solve dependent joints with geometry, not unrelated keyframes:

```js
function legPath(hipX, hipY, footX, footY, bend) {
  const upper = 83, lower = 85;
  const dx = footX - hipX, dy = footY - hipY;
  const distance = Math.max(.001, Math.hypot(dx, dy));
  const along = (upper*upper - lower*lower + distance*distance) / (2*distance);
  const height = Math.sqrt(Math.max(0, upper*upper - along*along));
  const kneeX = hipX + along*dx/distance + bend*height*dy/distance;
  const kneeY = hipY + along*dy/distance - bend*height*dx/distance;
  return `M${hipX} ${hipY} L${kneeX} ${kneeY} L${footX} ${footY}`;
}
```

Clamp the reachable distance `D = clamp(d, |a-b|, a+b)` before solving; an unreachable target detaches visually — reject or adjust the rig instead of silently emitting `NaN`. Feet placed on the pedal circle (`footX = cx + cos(phase)*r`), both legs share `phase` offset by `π`.

### Physics

IK places limbs but doesn't simulate forces/contacts. For collisions, suspension, joints, or torque, use a bundled physics library fed through a fixed-step accumulator: `acc += dt*speed; while (acc >= h && steps < 24) { world.step(h); acc -= h; steps++ }` with `h = 1/120s`. Render with `alpha = acc/h` interpolation between snapshots; interpolate unwrapped angles, then solve visual IK from the interpolated targets. If a step budget is exhausted, explicitly discard the backlog (`acc %= h`) rather than silently drifting.

### Scene coherence

Use unwrapped phase for accumulated travel, wrapped phase only for periodic display. Derive dependent motion (wheel rotation, ground-strip offset, body bob) from the same canonical phase — never give mechanically connected elements independent free-running clocks.

## 4. Control wiring

Every state change goes through one function that updates the model AND all representations:

```js
function setPlaying(next) {
  state.playing = next;
  playButton.setAttribute('aria-pressed', String(next));
  playButton.setAttribute('aria-label', next ? 'Pause animation' : 'Play animation');
  root.classList.toggle('is-playing', next);
}
```

Choose one semantic pattern per control and don't mix them: a **command button** changes its visible text and `aria-label` between two states with no `aria-pressed`; a **toggle button** keeps a constant accessible name and sets `aria-pressed`, changing only a decorative icon. Native buttons already handle Enter/Space — a second keyboard handler risks a double toggle. Read continuous controls (range inputs) on `input`, reject nonfinite values, normalize to the control's exact step domain, and accrue the preceding interval **at the old rate** before applying a new speed. Synchronize `aria-valuetext` on ranges. Never announce frame-by-frame updates through live regions — only discrete transitions, via `role="status"`/`aria-live`.

## 5. Lifecycle

- **visibilitychange** — treat visibility as a suspension gate, not a change to user intent. On hide: settle the active interval, cancel any pending frame, set `last = null`. On show: schedule only if playback remains requested and permitted, with a fresh timestamp baseline. A user pause must survive any number of hide/show transitions.
- **prefers-reduced-motion** — read `matchMedia(...).matches` before starting, subscribe to its `change` event, respond live. Clicking Play explicitly permits motion for the current preference; clicking Pause clears that permission. A change to reduced-motion revokes any previous override and freezes at the current pose.
- **noscript** — static, meaningful content remains present in the original HTML regardless of JS success; `<noscript>` covers the disabled-JS case but not init errors, so don't depend on it for correctness.
- **cleanup** — idempotent teardown, mark the instance dead first. Cancel pending rAF (`null`, not `0`, as the empty sentinel); abort DOM/document/media-query listeners; cancel owned WAAPI animations; disconnect observers; clear timers; terminate workers; revoke object URLs. Guard outstanding async completions with the destroyed flag or a generation token. For a legacy `MediaQueryList`, pair `addListener`/`removeListener`.

## 6. State correctness (time)

```js
function tick(now) {
  state.frameId = null;
  if (!shouldAnimate()) { state.lastTimestamp = null; render(); return; }
  let dt = 0;
  if (state.lastTimestamp !== null) {
    dt = Math.max(0, Math.min((now - state.lastTimestamp) / 1000, 0.1)); // clamp
  }
  state.lastTimestamp = now;
  state.elapsed += dt * state.speed;
  render();
  state.frameId = requestAnimationFrame(tick);
}
```

- Accumulate time from timestamps; **clamp deltas** (~50–100ms cap) so a backgrounded tab doesn't teleport on return. Keep `last = max(last, now)` so an out-of-order timestamp never subtracts time.
- Discard pause gaps — reset `lastTimestamp` on resume, don't integrate the hidden/paused interval.
- Derive periodic phase from canonical `elapsed` (`phase = elapsed * ω`), never from `totalElapsed * currentSpeed` — that reinterprets the entire past whenever speed changes.
- Never round stored time or angles for display; for long-running periodic scenes, keep phase bounded and track whole cycles separately since floating-point accumulation isn't exact.
- Speed `0` = a stable paused sim, not division-by-zero.

## 7. Rendering & performance

- **Batch**: within a frame — read state/cached layout → compute geometry in memory → write DOM/SVG/canvas together. Never interleave a style write with a layout read (forced sync layout).
- **Compositor-friendly**: animate `transform`, `opacity`, and CSS custom properties consumed by transforms. `will-change` only on elements that actually animate, removed after.
- **Bounded frame work**: no per-frame object/DOM creation, no `innerHTML` rebuilds, no per-frame logging, no repeated layout queries.
- **Canvas DPR**: `const dpr = Math.min(devicePixelRatio||1, 2); canvas.width = cssWidth*dpr; ctx.setTransform(dpr,0,0,dpr,0,0)` — CSS px for geometry, drawing-buffer px for the store. SVG: stable `viewBox`, CSS controls display size.

## 8. Testing checklist

- **Functional**: works offline; useful static content before JS; play starts exactly one loop; pause cancels the pending frame without advancing time; resume doesn't count paused time; reset returns to exact initial pose; speed changes don't jump the pose; speed `0` is stable; repeated clicks don't duplicate listeners; resize preserves geometry; unreachable IK targets clamp without `NaN`.
- **Lifecycle**: tab switch → no motion jump; DevTools pause/resume → no teleport; OS reduced-motion toggle while running → responds live; repeated toggles; host removal/reinsertion.
- **Accessibility**: every control keyboard-operable with visible focus; `aria-pressed`/`aria-label` match actual state; screen-reader/a11y-tree check; motion stops when requested; noscript content is understandable alone.
- **Performance**: no forced sync layout; frame count → 0 when paused/hidden; tested at 60Hz and high-refresh; small viewport / low-power device; no uncaught exceptions after repeated play/pause/reset/resize/preference-change cycles.
- **Timekeeping** (numeric spot-check pattern): with a known `last`/`time`/`speed`, advancing by a known `Δt` must produce the exact clamped, speed-scaled `time`; an out-of-order timestamp must not move the baseline backward; a fully suspended interval must add zero simulation time.

## Final engineering rules

1. Semantic content usable without JavaScript.
2. CSS for declarative presentation; JS for runtime computation and coordination.
3. Isolate the app in an IIFE, module, or custom element.
4. Cache DOM nodes; one authoritative state model.
5. Separate simulation updates from rendering and control synchronization.
6. CSS keyframes for fixed decorative motion; WAAPI for script-controlled sequences; rAF for computed motion/physics.
7. Connected parts from one phase/time source; dependent joints solved with geometry, clamped against unreachable targets.
8. Native controls; synchronize `aria-pressed`/`aria-label`/visible label/classes in one place; never mix command-button and toggle-button semantics.
9. Stop work when hidden or reduced-motion is active; respond to preference changes live.
10. Accumulate time from timestamps, clamp deltas, discard pause gaps, derive phase from canonical elapsed — never from elapsed×currentSpeed.
11. Batch layout reads before DOM writes; animate compositor-friendly properties only.
12. Test lifecycle, accessibility, time correctness, resizing, and long-running stability — not only the first visual impression.
