// touch-controls.js — orientation lock, portrait overlay, and on-screen controls.
// Writes to inputState (defined in input.js). Only activates on touch devices.

(function () {
  'use strict';

  const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  window.isTouch = IS_TOUCH; // exposed for netplay.js to restore localPlayer on disconnect

  // Which player this device controls.
  // 'both' on desktop (keyboard couch mode); 'p1' on mobile by default.
  // netplay.js may change this to 'p2' for the joining player.
  window.localPlayer = IS_TOUCH ? 'p1' : 'both';

  // ── Orientation overlay ──────────────────────────────────────────────────────
  // Always wire up orientation checking (even on desktop the overlay stays hidden).
  const portraitMQ = window.matchMedia('(orientation: portrait)');

  function checkOrientation() {
    const isPortrait = portraitMQ.matches;
    const overlay = document.getElementById('orient-overlay');
    // Show overlay only on touch devices in portrait; never on desktop.
    if (overlay) overlay.style.display = (IS_TOUCH && isPortrait) ? 'flex' : 'none';
  }

  portraitMQ.addEventListener('change', checkOrientation);
  // Run immediately (DOM is already available since this script is at end of body).
  checkOrientation();

  // On first user gesture: request landscape lock + fullscreen for a native feel.
  // Both APIs require a user gesture; using { once: true } fires on the first tap/click
  // (e.g. "Continue →", "Host Game", canvas START) — already in the user-gesture callstack.
  function tryNativeUX() {
    // Orientation lock — works on Android Chrome/Firefox; silently fails on iOS/desktop.
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => {});
    }
    // Fullscreen — hides browser chrome on mobile for a native feel.
    // Gated on IS_TOUCH so desktop couch-play users don't get a surprise fullscreen prompt.
    if (IS_TOUCH) {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        // Older WebKit prefix fallback (not available on iOS Safari in normal browsing)
        try { el.webkitRequestFullscreen(); } catch (_) {}
      }
    }
  }
  document.addEventListener('touchstart', tryNativeUX, { once: true });
  document.addEventListener('click',      tryNativeUX, { once: true });

  // ── Touch-only UI ────────────────────────────────────────────────────────────
  if (!IS_TOUCH) return;

  // Prevent browser scroll/zoom gestures during gameplay.
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // Hide keyboard hint bar — not relevant on touch.
  const hints = document.querySelector('.controls');
  if (hints) hints.style.display = 'none';

  // Build and inject the touch UI.
  buildTouchUI();

  // ── UI builder ───────────────────────────────────────────────────────────────
  function buildTouchUI() {
    const ui = document.createElement('div');
    ui.id = 'touch-ui';
    Object.assign(ui.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',   // only child elements capture touches
      zIndex: '100',
      touchAction: 'none',
    });
    document.body.appendChild(ui);

    buildJoystick(ui);
    buildButtons(ui);
  }

  // ── Virtual joystick (left side) ─────────────────────────────────────────────
  function buildJoystick(parent) {
    const BASE_R  = 65;   // base circle radius (px)
    const KNOB_R  = 28;   // knob circle radius (px)
    const DEAD    = 0.22; // normalised dead-zone (fraction of BASE_R)
    const CLAMP   = 0.75; // how far the knob travels inside the base (fraction)

    const base = el('div', {
      position: 'absolute', left: '18px', bottom: '18px',
      width: px(BASE_R*2), height: px(BASE_R*2),
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.10)',
      border: '2px solid rgba(255,255,255,0.26)',
      pointerEvents: 'auto',
      touchAction: 'none',
    });
    base.id = 'joystick-base';

    const knob = el('div', {
      position: 'absolute',
      width: px(KNOB_R*2), height: px(KNOB_R*2),
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.40)',
      border: '2px solid rgba(255,255,255,0.65)',
      left: px(BASE_R - KNOB_R), top: px(BASE_R - KNOB_R),
      pointerEvents: 'none',
    });
    base.appendChild(knob);
    parent.appendChild(base);

    let activeTouchId = null;
    let cx = 0, cy = 0;

    base.addEventListener('touchstart', e => {
      e.preventDefault();
      if (activeTouchId !== null) return;
      const t = e.changedTouches[0];
      activeTouchId = t.identifier;
      const r = base.getBoundingClientRect();
      cx = r.left + BASE_R;
      cy = r.top  + BASE_R;
      move(t.clientX, t.clientY);
    }, { passive: false });

    document.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === activeTouchId) move(t.clientX, t.clientY);
      }
    }, { passive: false });

    function onEnd(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === activeTouchId) {
          activeTouchId = null;
          reset();
        }
      }
    }
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onEnd);

    function move(px_, py_) {
      const dx = px_ - cx, dy = py_ - cy;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, BASE_R * CLAMP);
      const ang = Math.atan2(dy, dx);
      knob.style.left = px(BASE_R - KNOB_R + Math.cos(ang) * clamped);
      knob.style.top  = px(BASE_R - KNOB_R + Math.sin(ang) * clamped);

      const nx = dx / BASE_R; // normalised, no clamp, so fast flick = large value
      const ny = dy / BASE_R;
      const p  = window.localPlayer || 'p1';
      inputState[p].left  = nx < -DEAD;
      inputState[p].right = nx >  DEAD;
      inputState[p].duck  = ny >  DEAD;
      inputState[p].up    = ny < -DEAD;
    }

    function reset() {
      knob.style.left = px(BASE_R - KNOB_R);
      knob.style.top  = px(BASE_R - KNOB_R);
      const p = window.localPlayer || 'p1';
      inputState[p].left = inputState[p].right = inputState[p].duck = inputState[p].up = false;
    }
  }

  // ── Action buttons (right side) ──────────────────────────────────────────────
  function buildButtons(parent) {
    // Diamond / cross layout:  KICK top-left, PUNCH top-right, DASH bot-left, SUPER bot-right
    const zone = el('div', {
      position: 'absolute', right: '18px', bottom: '18px',
      display: 'grid',
      gridTemplateColumns: '72px 72px',
      gridTemplateRows: '72px 72px 72px',
      gap: '10px',
      pointerEvents: 'none',
    });
    parent.appendChild(zone);

    function p() { return window.localPlayer || 'p1'; }

    function triggerDash() {
      const pl = p();
      // Use current stick direction; default to forward if stick is neutral.
      const dir = inputState[pl].right ? 1 : (inputState[pl].left ? -1 : 1);
      inputState[pl].dash = dir;
    }

    const btns = [
      { label: 'KICK',  bg: 'rgba(255,170,0,0.72)',  action: v => inputState[p()].kick  = v },
      { label: 'PUNCH', bg: 'rgba(68,136,255,0.72)', action: v => inputState[p()].punch = v },
      { label: 'DASH',  bg: 'rgba(0,210,255,0.60)',  action: v => { if (v) triggerDash(); } },
      { label: 'SUPER', bg: 'rgba(255,60,220,0.72)', action: v => inputState[p()].super = v },
      { label: 'JUMP',  bg: 'rgba(136,255,68,0.72)', action: v => { if (v) inputState[p()].jump = true; } },
    ];

    for (const def of btns) {
      const btn = el('div', {
        width: '72px', height: '72px',
        borderRadius: '16px',
        background: def.bg,
        border: '2px solid rgba(255,255,255,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontFamily: 'sans-serif',
        fontSize: '12px', fontWeight: 'bold', letterSpacing: '0.5px',
        pointerEvents: 'auto',
        touchAction: 'none',
        userSelect: 'none',
        webkitUserSelect: 'none',
        cursor: 'pointer',
      });
      btn.textContent = def.label;

      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        def.action(true);
        btn.style.opacity = '0.60';
        btn.style.transform = 'scale(0.92)';
      }, { passive: false });

      function release(e) {
        e.preventDefault();
        def.action(false);
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1)';
      }
      btn.addEventListener('touchend',    release);
      btn.addEventListener('touchcancel', release);

      zone.appendChild(btn);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function px(n) { return n + 'px'; }

  function el(tag, styles) {
    const node = document.createElement(tag);
    Object.assign(node.style, styles);
    return node;
  }
})();
