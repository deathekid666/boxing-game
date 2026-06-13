// touch-controls.js — MOBA-style layout with radial cooldown indicators.
// Writes to inputState (defined in input.js). Only activates on touch devices.

(function () {
  'use strict';

  const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  window.isTouch = IS_TOUCH;
  window.localPlayer = IS_TOUCH ? 'p1' : 'both';

  // ── Orientation overlay ──────────────────────────────────────────────────────
  const portraitMQ = window.matchMedia('(orientation: portrait)');
  function checkOrientation() {
    const overlay = document.getElementById('orient-overlay');
    if (overlay) overlay.style.display = (IS_TOUCH && portraitMQ.matches) ? 'flex' : 'none';
  }
  portraitMQ.addEventListener('change', checkOrientation);
  checkOrientation();

  function tryNativeUX() {
    if (screen.orientation && typeof screen.orientation.lock === 'function')
      screen.orientation.lock('landscape').catch(() => {});
    if (IS_TOUCH) {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) try { el.webkitRequestFullscreen(); } catch (_) {}
    }
  }
  document.addEventListener('touchstart', tryNativeUX, { once: true });
  document.addEventListener('click',      tryNativeUX, { once: true });

  if (!IS_TOUCH) return;

  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  const hints = document.querySelector('.controls');
  if (hints) hints.style.display = 'none';

  // ── UI builder ───────────────────────────────────────────────────────────────
  function buildTouchUI() {
    const ui = document.createElement('div');
    ui.id = 'touch-ui';
    Object.assign(ui.style, {
      position: 'fixed', inset: '0',
      pointerEvents: 'none', zIndex: '100', touchAction: 'none',
    });
    document.body.appendChild(ui);
    buildJoystick(ui);
    buildButtons(ui);
  }

  // ── Virtual joystick (bottom-left) ──────────────────────────────────────────
  function buildJoystick(parent) {
    const BASE_R = 68, KNOB_R = 30, DEAD = 0.22, CLAMP = 0.78;

    const base = cel('div', {
      position: 'absolute', left: '18px', bottom: '18px',
      width: px(BASE_R * 2), height: px(BASE_R * 2), borderRadius: '50%',
      background: 'rgba(255,255,255,0.07)',
      border: '2px solid rgba(255,255,255,0.22)',
      boxShadow: '0 0 0 4px rgba(255,255,255,0.04)',
      pointerEvents: 'auto', touchAction: 'none',
    });

    const knob = cel('div', {
      position: 'absolute',
      width: px(KNOB_R * 2), height: px(KNOB_R * 2), borderRadius: '50%',
      background: 'rgba(255,255,255,0.38)',
      border: '2px solid rgba(255,255,255,0.60)',
      left: px(BASE_R - KNOB_R), top: px(BASE_R - KNOB_R),
      pointerEvents: 'none',
    });
    base.appendChild(knob);
    parent.appendChild(base);

    let activeTouchId = null, cx = 0, cy = 0;

    base.addEventListener('touchstart', e => {
      e.preventDefault();
      if (activeTouchId !== null) return;
      const t = e.changedTouches[0];
      activeTouchId = t.identifier;
      const r = base.getBoundingClientRect();
      cx = r.left + BASE_R; cy = r.top + BASE_R;
      handleMove(t.clientX, t.clientY);
    }, { passive: false });

    document.addEventListener('touchmove', e => {
      for (const t of e.changedTouches)
        if (t.identifier === activeTouchId) handleMove(t.clientX, t.clientY);
    }, { passive: false });

    function onEnd(e) {
      for (const t of e.changedTouches)
        if (t.identifier === activeTouchId) { activeTouchId = null; reset(); }
    }
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onEnd);

    function handleMove(px_, py_) {
      const dx = px_ - cx, dy = py_ - cy;
      const dist = Math.hypot(dx, dy);
      const clamped = Math.min(dist, BASE_R * CLAMP);
      const ang = Math.atan2(dy, dx);
      knob.style.left = px(BASE_R - KNOB_R + Math.cos(ang) * clamped);
      knob.style.top  = px(BASE_R - KNOB_R + Math.sin(ang) * clamped);
      const nx = dx / BASE_R, ny = dy / BASE_R;
      const p = window.localPlayer || 'p1';
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

  // ── Action buttons — MOBA fan/arc layout (right side) ────────────────────────
  //
  //  Fan layout (right/bottom = CSS distance from viewport edge):
  //
  //    [JUMP]                         ← isolated, upper-right
  //    [DASH]  [SUPER]                ← top of arc
  //        [KICK]                     ← mid arc
  //              [PUNCH]              ← anchor, largest, most accessible
  //
  // Cooldown constants mirror game.js (in frames at 60fps)
  const MAX_CD = { punch: 18, kick: 72, super: 480, dash: 45, jump: 30 };
  const CD_KEY  = { punch: 'punchCd', kick: 'kickCd', super: 'superCd', dash: 'dashCd', jump: 'jumpCd' };

  function localP() { return window.localPlayer || 'p1'; }

  const BTN_DEFS = [
    // id, label, size(px), right(px), bottom(px), accent color, bg color, action
    {
      id: 'punch', label: 'PUNCH', size: 88, right: 24, bottom: 20,
      color: '#5599ff', bg: 'rgba(8,30,100,0.82)',
      action: v => { inputState[localP()].punch = v; },
    },
    {
      id: 'kick', label: 'KICK', size: 70, right: 148, bottom: 88,
      color: '#ffaa00', bg: 'rgba(70,38,0,0.82)',
      action: v => { inputState[localP()].kick = v; },
    },
    {
      id: 'super', label: 'SUPER', size: 70, right: 80, bottom: 152,
      color: '#ff3cdc', bg: 'rgba(60,0,60,0.82)',
      action: v => { inputState[localP()].super = v; },
    },
    {
      id: 'dash', label: 'DASH', size: 70, right: 4, bottom: 152,
      color: '#00d2ff', bg: 'rgba(0,38,60,0.82)',
      action: v => {
        if (v) {
          const pl = localP();
          inputState[pl].dash = inputState[pl].right ? 1 : (inputState[pl].left ? -1 : 1);
        }
      },
    },
    {
      id: 'jump', label: 'JUMP', size: 66, right: 10, bottom: 252,
      color: '#88ff44', bg: 'rgba(18,44,0,0.82)',
      action: v => { if (v) inputState[localP()].jump = true; },
    },
  ];

  // id → { div, cvs, cctx, def }
  const BTN_ELS = {};

  function buildButtons(parent) {
    for (const def of BTN_DEFS) {
      const div = cel('div', {
        position: 'absolute',
        right: px(def.right), bottom: px(def.bottom),
        width: px(def.size), height: px(def.size),
        borderRadius: '50%',
        background: def.bg,
        border: `2.5px solid ${def.color}`,
        boxShadow: `0 0 14px 4px ${def.color}50, inset 0 0 10px rgba(255,255,255,0.04)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontFamily: 'Arial, sans-serif',
        fontSize: def.size >= 80 ? '13px' : '11px',
        fontWeight: 'bold', letterSpacing: '0.6px',
        pointerEvents: 'auto', touchAction: 'none',
        userSelect: 'none', webkitUserSelect: 'none',
        overflow: 'hidden',
      });

      // Label sits behind the cooldown canvas
      const lbl = cel('span', {
        position: 'relative', zIndex: '1', pointerEvents: 'none',
        textShadow: '0 1px 3px rgba(0,0,0,0.7)',
      });
      lbl.textContent = def.label;

      // Cooldown overlay canvas (drawn on top of the label)
      const cvs = document.createElement('canvas');
      cvs.width = def.size; cvs.height = def.size;
      Object.assign(cvs.style, {
        position: 'absolute', inset: '0',
        borderRadius: '50%', pointerEvents: 'none', zIndex: '2',
      });

      div.appendChild(lbl);
      div.appendChild(cvs);
      parent.appendChild(div);

      BTN_ELS[def.id] = { div, cvs, cctx: cvs.getContext('2d'), def };

      div.addEventListener('touchstart', e => {
        e.preventDefault();
        def.action(true);
        div.style.transform = 'scale(0.90)';
        div.style.transition = 'transform 0.05s ease';
      }, { passive: false });

      const release = e => {
        e.preventDefault();
        def.action(false);
        div.style.transform = 'scale(1)';
      };
      div.addEventListener('touchend',    release);
      div.addEventListener('touchcancel', release);
    }

    requestAnimationFrame(tickCooldowns);
  }

  // ── Cooldown rAF loop ────────────────────────────────────────────────────────
  function tickCooldowns() {
    const pl = localP();
    // p1/p2 are globals from game.js; undefined until game starts
    const fighter = (typeof p1 !== 'undefined') ? (pl === 'p2' ? p2 : p1) : null;

    for (const id of Object.keys(BTN_ELS)) {
      const { div, cctx, def } = BTN_ELS[id];
      const sz = def.size, r = sz / 2;
      const cd = fighter ? (fighter[CD_KEY[id]] || 0) : 0;

      cctx.clearRect(0, 0, sz, sz);

      if (cd > 0) {
        const frac = Math.min(cd / MAX_CD[id], 1);

        // Clip draw to circle shape
        cctx.save();
        cctx.beginPath();
        cctx.arc(r, r, r, 0, Math.PI * 2);
        cctx.clip();

        // Dark sweep from 12-o'clock clockwise, covering 'frac' of the circle
        cctx.beginPath();
        cctx.moveTo(r, r);
        cctx.arc(r, r, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
        cctx.closePath();
        cctx.fillStyle = 'rgba(0,0,0,0.60)';
        cctx.fill();

        // Countdown seconds (only for cooldowns ≥ 1 s = 60 frames)
        if (cd >= 60) {
          cctx.fillStyle = 'rgba(255,255,255,0.94)';
          cctx.font = `bold ${Math.round(r * 0.70)}px Arial`;
          cctx.textAlign = 'center';
          cctx.textBaseline = 'middle';
          cctx.fillText(String(Math.ceil(cd / 60)), r, r + 1);
        }
        cctx.restore();

        // Dim border + remove glow while on cooldown
        div.style.borderColor = `${def.color}30`;
        div.style.boxShadow = `inset 0 0 8px rgba(0,0,0,0.40)`;
      } else {
        // Ready: restore full glow
        div.style.borderColor = def.color;
        div.style.boxShadow = `0 0 14px 4px ${def.color}50, inset 0 0 10px rgba(255,255,255,0.04)`;
      }
    }

    requestAnimationFrame(tickCooldowns);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function px(n)         { return n + 'px'; }
  function cel(tag, styles) {
    const node = document.createElement(tag);
    Object.assign(node.style, styles);
    return node;
  }

  // Called here so all const declarations above are already initialized
  buildTouchUI();
})();
