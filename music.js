// music.js — synthesized looping BGM, no external audio files.
// Uses the same AudioContext (actx) created in game.js.
// Exposes window.BGM = { setPhase(p), toggle(), muted }

(function () {
  'use strict';

  let _master = null;
  let _muted = false;
  let _phase = null;
  let _step = 0, _nextTime = 0, _timer = null;

  const LOOK_AHEAD = 0.12; // seconds to schedule ahead
  const TICK_MS = 50;      // scheduler interval

  // ── Track definitions (16-step sequencer) ────────────────────────────────────
  // kick/snare/hat: 1=hit, 0=rest
  // bass/mel: MIDI note number, 0=rest
  const TRACKS = {
    fight: {
      bpm:   132,
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      bass:  [45,0,0,0, 40,0,43,0, 45,0,0,43, 40,0,0,0],
      mel:   [69,0,0,0, 72,0,0,0, 76,0,74,0, 72,0,0,0],
    },
    menu: {
      bpm:   84,
      kick:  [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [],
      bass:  [45,0,0,0, 43,0,0,0, 40,0,0,0, 43,0,0,0],
      mel:   [72,0,0,0, 0,0,76,0, 0,74,0,0, 72,0,0,0],
    },
  };

  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  // ── Instrument voices ─────────────────────────────────────────────────────────
  function kick(t) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.65, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(_master); o.start(t); o.stop(t + 0.22);
  }

  function snare(t) {
    const len = Math.ceil(actx.sampleRate * 0.12);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource(); src.buffer = buf;
    const filt = actx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 900;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(filt).connect(g).connect(_master); src.start(t); src.stop(t + 0.13);

    // body tone
    const o = actx.createOscillator(), g2 = actx.createGain();
    o.frequency.value = 210; o.type = 'triangle';
    g2.gain.setValueAtTime(0.18, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g2).connect(_master); o.start(t); o.stop(t + 0.09);
  }

  function hat(t) {
    const len = Math.ceil(actx.sampleRate * 0.035);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource(); src.buffer = buf;
    const filt = actx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 7500;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.10, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(filt).connect(g).connect(_master); src.start(t); src.stop(t + 0.04);
  }

  function bass(t, midi, sl) {
    const o = actx.createOscillator(); o.type = 'square';
    o.frequency.value = hz(midi - 12); // one octave down
    const g = actx.createGain();
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + sl * 0.75);
    o.connect(g).connect(_master); o.start(t); o.stop(t + sl * 0.8);
  }

  function melody(t, midi, sl) {
    const o = actx.createOscillator(); o.type = 'square';
    o.frequency.value = hz(midi);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.065, t); g.gain.exponentialRampToValueAtTime(0.001, t + sl * 1.6);
    o.connect(g).connect(_master); o.start(t); o.stop(t + sl * 1.8);
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────────
  function schedStep(t, track, sl) {
    const s = _step % 16;
    if (track.kick[s])            kick(t);
    if (track.snare[s])           snare(t);
    if (track.hat && track.hat[s]) hat(t);
    if (track.bass[s])            bass(t, track.bass[s], sl);
    if (track.mel[s])             melody(t, track.mel[s], sl);
  }

  function _tick() {
    if (!_phase || typeof actx === 'undefined' || actx.state !== 'running') {
      _timer = setTimeout(_tick, TICK_MS);
      return;
    }
    const track = TRACKS[_phase];
    const sl = 60 / track.bpm / 4; // 16th-note step length in seconds
    while (_nextTime < actx.currentTime + LOOK_AHEAD) {
      schedStep(_nextTime, track, sl);
      _step++;
      _nextTime += sl;
    }
    _timer = setTimeout(_tick, TICK_MS);
  }

  function _start(phase) {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _phase = phase;
    _step = 0;
    if (typeof actx !== 'undefined') _nextTime = actx.currentTime + 0.06;
    _tick();
  }

  // Resume after AudioContext unlock
  function _onResume() {
    if (_phase && !_timer) {
      _step = 0;
      _nextTime = actx.currentTime + 0.06;
      _tick();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  window.BGM = {
    init() {
      _master = actx.createGain();
      _master.gain.value = 0.50;
      _master.connect(actx.destination);
      actx.addEventListener('statechange', () => {
        if (actx.state === 'running') _onResume();
      });
    },

    setPhase(phase) {
      const target = phase === 'fight' ? 'fight' : 'menu';
      if (_phase === target) return;
      _start(target);
    },

    toggle() {
      _muted = !_muted;
      if (_master) _master.gain.setTargetAtTime(_muted ? 0 : 0.50, actx.currentTime, 0.12);
      return _muted;
    },

    get muted() { return _muted; },
  };

  // Auto-init once DOM is ready (actx is a global from game.js)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.BGM.init());
  } else {
    window.BGM.init();
  }
})();
