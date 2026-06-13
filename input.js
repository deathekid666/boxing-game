// input.js — owns the shared input state object.
// All input sources (keyboard, touch, network) write to inputState.
// game.js reads inputState each frame; it never touches raw keys.

const inputState = {
  p1: { left: false, right: false, duck: false, up: false, punch: false, kick: false, super: false, dash: 0, jump: false },
  p2: { left: false, right: false, duck: false, up: false, punch: false, kick: false, super: false, dash: 0, jump: false }
};

// Called by game.js spawnFighters() to clear stale dash signals and tap history.
function resetDoubleTap() {
  _lastTap.p1 = { dir: 0, time: -9999 };
  _lastTap.p2 = { dir: 0, time: -9999 };
  inputState.p1.dash = 0;
  inputState.p2.dash = 0;
}

// ── internals ──────────────────────────────────────────────────────────────────
const DASH_TAP_WINDOW_MS = 230;
const _keys = {};
const _lastTap = { p1: { dir: 0, time: -9999 }, p2: { dir: 0, time: -9999 } };

function _syncKeys() {
  inputState.p1.left  = !!(_keys['a'] || _keys['A']);
  inputState.p1.right = !!(_keys['d'] || _keys['D']);
  inputState.p1.duck  = !!(_keys['s'] || _keys['S']);
  inputState.p1.up    = !!(_keys['w'] || _keys['W']);
  inputState.p1.punch = !!(_keys['f'] || _keys['F']);
  inputState.p1.kick  = !!(_keys['g'] || _keys['G']);
  inputState.p1.super = !!(_keys['h'] || _keys['H']);

  inputState.p2.left  = !!_keys['ArrowLeft'];
  inputState.p2.right = !!_keys['ArrowRight'];
  inputState.p2.duck  = !!_keys['ArrowDown'];
  inputState.p2.up    = !!_keys['ArrowUp'];
  inputState.p2.punch = !!(_keys['l'] || _keys['L']);
  inputState.p2.kick  = !!(_keys['k'] || _keys['K']);
  inputState.p2.super = !!(_keys['j'] || _keys['J']);
}

function _checkDoubleTap(player, dir, t) {
  const last = _lastTap[player];
  if (last.dir === dir && (t - last.time) < DASH_TAP_WINDOW_MS) {
    inputState[player].dash = dir;
    last.time = -9999;
  } else {
    last.dir = dir;
    last.time = t;
  }
}

document.addEventListener('keydown', e => {
  const wasDown = _keys[e.key];
  _keys[e.key] = true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  _syncKeys();
  if (wasDown) return; // ignore key-repeat for tap detection

  const t = performance.now();
  if (e.key === 'a' || e.key === 'A') _checkDoubleTap('p1', -1, t);
  if (e.key === 'd' || e.key === 'D') _checkDoubleTap('p1',  1, t);
  if (e.key === 'ArrowLeft')  _checkDoubleTap('p2', -1, t);
  if (e.key === 'ArrowRight') _checkDoubleTap('p2',  1, t);
  if (e.key === 'q' || e.key === 'Q') inputState.p1.jump = true;
  if (e.key === 'u' || e.key === 'U') inputState.p2.jump = true;
});

document.addEventListener('keyup', e => {
  _keys[e.key] = false;
  _syncKeys();
});

window.addEventListener('blur', () => {
  for (const k in _keys) _keys[k] = false;
  _syncKeys();
});
