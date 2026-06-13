// game.js — core simulation, rendering, and game loop.
// Reads from inputState (defined in input.js). Never touches raw keys.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const W = 820, H = 490;

// ── Sound engine (synthesized, no external files) ───────────────────────────
const actx = new (window.AudioContext || window.webkitAudioContext)();
function unlockAudio() { if (actx.state === 'suspended') actx.resume(); }
document.addEventListener('keydown', unlockAudio, { once: true });
canvas.addEventListener('click', unlockAudio, { once: true });

function now() { return actx.currentTime; }

function tone(freqStart, freqEnd, dur, type, vol, when=0) {
  const t0 = now() + when;
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd,1), t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(actx.destination);
  osc.start(t0); osc.stop(t0 + dur);
}

function noiseBurst(dur, vol, when=0, filterFreq=1500) {
  const t0 = now() + when;
  const bufferSize = actx.sampleRate * dur;
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random()*2-1) * (1 - i/bufferSize);
  const src = actx.createBufferSource();
  src.buffer = buffer;
  const filt = actx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = filterFreq;
  const gain = actx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt).connect(gain).connect(actx.destination);
  src.start(t0); src.stop(t0 + dur);
}

const SFX = {
  punch()      { tone(180,60,0.18,'square',0.25); noiseBurst(0.08,0.25,0,2500); },
  kick()       { tone(300,900,0.13,'sawtooth',0.22); tone(900,200,0.18,'sawtooth',0.18,0.1); noiseBurst(0.06,0.2,0,3000); },
  superCharge(){ tone(60,900,0.55,'sawtooth',0.22); tone(60,900,0.55,'square',0.14); noiseBurst(0.18,0.12,0.3,600); },
  superStretch(){ tone(320,60,0.18,'sine',0.22); tone(60,380,0.16,'sine',0.16,0.14); tone(280,560,0.10,'sine',0.12,0.08); },
  superWhiff() { tone(380,190,0.22,'sawtooth',0.18); tone(190,95,0.25,'sawtooth',0.14,0.14); tone(95,48,0.22,'sawtooth',0.10,0.28); },
  superHit()   { tone(500,30,0.6,'sawtooth',0.40); tone(40,20,0.7,'square',0.35,0.05); noiseBurst(0.4,0.45,0,900); setTimeout(()=>tone(180,90,0.35,'square',0.22),100); setTimeout(()=>tone(90,45,0.3,'square',0.18),220); },
  shieldBlock(){ tone(600,1200,0.1,'triangle',0.2); tone(1200,600,0.12,'triangle',0.15,0.08); },
  shieldBreak(){ tone(300,50,0.3,'square',0.25); noiseBurst(0.15,0.25,0,800); },
  stagger()    { tone(400,150,0.3,'sawtooth',0.15); },
  ko()         { const n=[330,294,262,220]; n.forEach((f,i)=>setTimeout(()=>tone(f,f*0.92,i===n.length-1?0.6:0.28,'sawtooth',0.25),i*260)); },
  bell()       { tone(900,880,0.5,'square',0.2); tone(900,880,0.5,'triangle',0.15,0.02); },
  victory()    { [262,330,392,523,659].forEach((f,i)=>setTimeout(()=>tone(f,f,0.22,'square',0.2),i*110)); },
  click()      { tone(700,1100,0.07,'triangle',0.15); },
  dodge()      { tone(500,200,0.12,'sine',0.15); },
  dash()       { tone(400,100,0.15,'sawtooth',0.12); noiseBurst(0.06,0.10,0,500); },
  jump()       { tone(200,600,0.12,'sine',0.15); },
  land()       { tone(100,40,0.12,'square',0.20); noiseBurst(0.05,0.18,0,600); },
  lowHp()      { tone(60,50,0.15,'sine',0.25); setTimeout(()=>tone(60,50,0.12,'sine',0.18),180); },
  timeWarn()   { tone(800,780,0.06,'square',0.12); },
  roundWin()   { [392,523,659].forEach((f,i)=>setTimeout(()=>tone(f,f,0.18,'square',0.22),i*90)); },
  impact(n)    { const v=Math.min(0.35,0.15+n*0.02); tone(200,60,0.2,'sawtooth',v); noiseBurst(0.1,v*0.8,0,2000); },
};

// ── Characters ───────────────────────────────────────────────────────────────
const CHARACTERS = [
  { name:'KID',     cls:'BALANCED', color:'#4488ff', dark:'#1144aa', maxHp:250, speed:3.5, dmgMul:1.00, dashSpeed:11, stats:[3,3,3] },
  { name:'BRUISER', cls:'POWER',    color:'#dd3322', dark:'#881111', maxHp:300, speed:2.5, dmgMul:1.45, dashSpeed:9,  stats:[2,5,4] },
  { name:'SWIFT',   cls:'SPEED',    color:'#00cc88', dark:'#008855', maxHp:190, speed:5.2, dmgMul:0.75, dashSpeed:14, stats:[5,2,2] },
  { name:'TANK',    cls:'DEFENSE',  color:'#aa44ff', dark:'#6611cc', maxHp:340, speed:1.8, dmgMul:1.20, dashSpeed:7,  stats:[1,4,5] },
];

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_HP      = 250; // fallback / netplay compat — fighters use char.maxHp
const MAX_SHIELD  = 80;
const SHIELD_REGEN_DELAY = 120;
const SHIELD_REGEN_RATE  = 0.35;
const KICK_CD  = 72;
const SUPER_CD = 540;
const PUNCH_CD = 18;
const DASH_SPEED = 11;
const DASH_FRAMES = 10;
const DASH_CD = 45;
const ROUND_TIME = 60 * 60;
const MIN_GAP = 64;
const PUNCH_REACH = 145;
const KICK_REACH  = 140;
const SUPER_REACH = 460;
const RING_BACK_Y    = 285;   // screen-Y at depth=0 (back of ring)
const RING_FRONT_Y   = 425;   // screen-Y at depth=1 (front of ring)
const RING_BACK_S    = 0.82;  // render scale at back (10-18% range — subtle 2.5D)
const RING_FRONT_S   = 1.0;
const DEPTH_SPEED    = 0.012; // depth axis movement per frame
const DEPTH_WORLD_SCALE = 60; // depth units → world-px (unified with X for hit detection)
const PUNCH_HIT_R  = 38;      // world-px hit radius for punch
const KICK_HIT_R   = 46;      // world-px hit radius for kick
const SUPER_HIT_R  = 70;      // world-px hit radius for super
const JUMP_VZ      = -12;
const GRAVITY      = 0.7;
const JUMP_CD      = 30;
const KD_FALL      = 10;   // frames to fall to ground
const KD_DOWN      = 36;   // frames lying down (~0.6 s)
const KD_RISE      = 14;   // frames to stand back up
const KD_TOTAL     = KD_FALL + KD_DOWN + KD_RISE; // 60 frames ≈ 1 s
const KD_INVUL     = 45;   // knockdown-immunity frames after rising (still hittable)
const KD_MIN_DMG   = 14;   // min post-shield damage on a tip-hit to trigger knockdown
const SHIELD_BREAK_STUN = 20; // frames of shield-broken vulnerability
const COMBO_WINDOW = 110;  // frames to land the next hit before combo resets (~1.8 s)

function depthToScreenY(depth) { return RING_BACK_Y + depth * (RING_FRONT_Y - RING_BACK_Y); }
function depthToScale(depth)   { return RING_BACK_S + depth * (RING_FRONT_S - RING_BACK_S); }
function fighterScreenY(p) { return depthToScreenY(p.depth) - (p.jz || 0); }
// Unified world-space distance: fist at (fistX, attackerDepth) vs defender center
function fistDist(fistX, attackerDepth, d) {
  return Math.hypot(fistX - d.x, (attackerDepth - d.depth) * DEPTH_WORLD_SCALE);
}

// ── Persistent stats (localStorage) ──────────────────────────────────────────
function _li(k, def=0)  { return parseInt(localStorage.getItem(k) || def, 10); }
function _lj(k, def={}) { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } }

let winStreak   = _li('fbg_streak');
let bestStreak  = _li('fbg_best');
let statWins    = _li('fbg_wins');
let statLosses  = _li('fbg_losses');
let statDraws   = _li('fbg_draws');
let statKOs     = _li('fbg_kos');
let statDmg     = _li('fbg_dmg');
let statBestCombo = _li('fbg_combo');
let statCharWins  = _lj('fbg_chars', {KID:0,BRUISER:0,SWIFT:0,TANK:0});

let _streakNewBest = false;

// Per-match accumulators (reset at startFight, accumulated each round)
let _mKOs = 0, _mDmg = 0, _mCombo = 0;

function _saveStats() {
  localStorage.setItem('fbg_streak', winStreak);
  localStorage.setItem('fbg_best',   bestStreak);
  localStorage.setItem('fbg_wins',   statWins);
  localStorage.setItem('fbg_losses', statLosses);
  localStorage.setItem('fbg_draws',  statDraws);
  localStorage.setItem('fbg_kos',    statKOs);
  localStorage.setItem('fbg_dmg',    statDmg);
  localStorage.setItem('fbg_combo',  statBestCombo);
  localStorage.setItem('fbg_chars',  JSON.stringify(statCharWins));
}

function _updateStreak(p1Won) {
  if (p1Won) {
    winStreak++;
    if (winStreak > bestStreak) { bestStreak = winStreak; _streakNewBest = true; }
    else { _streakNewBest = false; }
  } else {
    winStreak = 0; _streakNewBest = false;
  }
}

function _updateMatchStats(p1Won, isDraw) {
  _updateStreak(p1Won && !isDraw);
  if (isDraw)       { statDraws++; }
  else if (p1Won)   { statWins++;  statCharWins[CHARACTERS[p1CharIdx].name] = (statCharWins[CHARACTERS[p1CharIdx].name]||0)+1; }
  else              { statLosses++; }
  statKOs  += _mKOs;
  statDmg  += _mDmg;
  if (_mCombo > statBestCombo) statBestCombo = _mCombo;
  _saveStats();

  // Match-end achievement checks
  const played = statWins + statLosses + statDraws;
  if (p1Won && !isDraw) {
    if (statWins === 1)  _unlockAch('first_win');
    if (_mKOd)           _unlockAch('ko_artist');
    if (_mSuperLanded)   _unlockAch('super_star');
    if (_mP1KDs === 0)   _unlockAch('untouchable');
    if (_mWasLowHP)      _unlockAch('comeback');
    if (winStreak >= 3)  _unlockAch('hat_trick');
    if (winStreak >= 5)  _unlockAch('destroyer');
    if (statWins >= 10)  _unlockAch('champion');
    if (statWins >= 50)  _unlockAch('legendary');
    if (CHARACTERS.every(c => (statCharWins[c.name]||0) > 0)) _unlockAch('all_styles');
  }
  if (statDmg >= 5000)  _unlockAch('iron_fist');
  if (played >= 20)     _unlockAch('veteran');
}

// ── Achievements ─────────────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id:'first_win',   icon:'🥊', name:'First Win',      desc:'Win your first match' },
  { id:'ko_artist',   icon:'💥', name:'KO Artist',      desc:'Win by knocking out P2' },
  { id:'super_star',  icon:'⚡', name:'Super Star',     desc:'Land a super move hit' },
  { id:'combo_king',  icon:'🔥', name:'Combo King',     desc:'Land a 5-hit combo' },
  { id:'speed_demon', icon:'💨', name:'Speed Demon',    desc:'Win a round in 20 sec' },
  { id:'untouchable', icon:'🛡', name:'Untouchable',    desc:'Win without knockdown' },
  { id:'perfect',     icon:'✨', name:'Perfect Round',  desc:'Win a round at full HP' },
  { id:'comeback',    icon:'❤️', name:'Comeback Kid',   desc:'Win from below 25% HP' },
  { id:'hat_trick',   icon:'🎩', name:'Hat Trick',      desc:'Win 3 matches in a row' },
  { id:'destroyer',   icon:'💀', name:'Destroyer',      desc:'Reach a 5-win streak' },
  { id:'iron_fist',   icon:'👊', name:'Iron Fist',      desc:'Deal 5,000 total damage' },
  { id:'veteran',     icon:'🎖', name:'Veteran',        desc:'Play 20 matches' },
  { id:'champion',    icon:'🏆', name:'Champion',       desc:'Win 10 matches' },
  { id:'all_styles',  icon:'🌟', name:'All Styles',     desc:'Win with all 4 fighters' },
  { id:'legendary',   icon:'👑', name:'Legendary',      desc:'Win 50 matches' },
];

let unlockedAchs = new Set(JSON.parse(localStorage.getItem('fbg_ach') || '[]'));
let _achToasts   = []; // [{ id, t }]  t counts down from 240

// Extra per-match flags
let _mP1KDs = 0, _mWasLowHP = false, _mKOd = false, _mSuperLanded = false;
let _lowHpTick = 0;
let _hudPulse = 0;
let countdownTimer = 0;
let _rematchLocal = false, _rematchOpp = false;

function _unlockAch(id) {
  if (unlockedAchs.has(id)) return;
  unlockedAchs.add(id);
  localStorage.setItem('fbg_ach', JSON.stringify([...unlockedAchs]));
  _achToasts.push({ id, t: 260 });
  SFX.bell();
}

function drawAchToast() {
  if (_achToasts.length === 0) return;
  const toast = _achToasts[0];
  toast.t--;
  if (toast.t <= 0) { _achToasts.shift(); return; }
  const ach = ACHIEVEMENTS.find(a => a.id === toast.id);
  if (!ach) return;

  const slideIn  = Math.min(1, (260 - toast.t) / 22);
  const fadeOut  = toast.t < 50 ? toast.t / 50 : 1;
  const alpha    = slideIn * fadeOut;
  const TW = 300, TH = 52;
  const ty = H - 68 - (1 - slideIn) * 55;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(16,18,30,0.97)';
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.8;
  ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.roundRect(W/2 - TW/2, ty, TW, TH, 10); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '20px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  ctx.fillText(ach.icon, W/2 - TW/2 + 12, ty + 33);
  ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#ffd700';
  ctx.fillText('ACHIEVEMENT UNLOCKED', W/2 - TW/2 + 44, ty + 19);
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#fff';
  ctx.fillText(ach.name, W/2 - TW/2 + 44, ty + 35);
  ctx.restore();
}

function drawAchievements() {
  ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fillRect(0, 0, W, H);
  ctx.save();

  const CX = W/2, CW = 760, CH = 430, top = H/2 - CH/2 - 8;
  ctx.fillStyle = 'rgba(12,14,22,0.97)';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(CX - CW/2, top, CW, CH, 14); ctx.fill(); ctx.stroke();

  const total = ACHIEVEMENTS.length;
  const done  = ACHIEVEMENTS.filter(a => unlockedAchs.has(a.id)).length;
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#ffe44d';
  ctx.fillText('ACHIEVEMENTS', CX, top + 34);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#555';
  ctx.fillText(`${done} / ${total} unlocked`, CX, top + 50);

  // Progress bar
  const pbx = CX - 160, pby = top + 56, pbw = 320, pbh = 6;
  ctx.fillStyle = '#1a1a2a';
  ctx.beginPath(); ctx.roundRect(pbx, pby, pbw, pbh, 3); ctx.fill();
  if (done > 0) {
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.roundRect(pbx, pby, Math.round(pbw * done / total), pbh, 3); ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CX - CW/2 + 20, top + 70); ctx.lineTo(CX + CW/2 - 20, top + 70); ctx.stroke();

  // 3-column grid
  const cols = 3, cellW = (CW - 56) / cols, cellH = 56, rowStride = 64;
  const gx = CX - CW/2 + 16, gy = top + 78;

  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    const ach = ACHIEVEMENTS[i];
    const col = i % cols, row = Math.floor(i / cols);
    const ax = gx + col * (cellW + 12), ay = gy + row * rowStride;
    const unlk = unlockedAchs.has(ach.id);

    ctx.fillStyle = unlk ? 'rgba(28,32,50,0.95)' : 'rgba(16,16,20,0.80)';
    ctx.beginPath(); ctx.roundRect(ax, ay, cellW, cellH, 8); ctx.fill();
    if (unlk) {
      ctx.strokeStyle = 'rgba(255,215,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(ax, ay, cellW, cellH, 8); ctx.stroke();
    }

    ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
    ctx.globalAlpha = unlk ? 1.0 : 0.18;
    ctx.fillText(ach.icon, ax + 30, ay + cellH/2 + 8);
    ctx.globalAlpha = 1;

    ctx.textAlign = 'left';
    ctx.font = `bold 12px sans-serif`; ctx.fillStyle = unlk ? '#ffe44d' : '#3a3a42';
    ctx.fillText(ach.name, ax + 54, ay + 22);
    ctx.font = '10px sans-serif'; ctx.fillStyle = unlk ? '#666' : '#282828';
    ctx.fillText(ach.desc, ax + 54, ay + 36);

    if (unlk) {
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = '#44dd88';
      ctx.fillText('✓', ax + cellW - 10, ay + cellH/2 + 5);
    }
  }

  ctx.font = '12px sans-serif'; ctx.fillStyle = '#444'; ctx.textAlign = 'center';
  ctx.fillText('ESC or click to close  ·  TAB for stats', CX, top + CH - 14);
  ctx.restore();
}

// ── Game state ───────────────────────────────────────────────────────────────
let phase = 'menu';
let totalRounds = 3;
let currentRound = 1;
let roundsWon = [0, 0];
let p1, p2, floaties;
let roundEndMsg = '';
let roundEndTimer = 0;
let roundStats = null;
let p1CharIdx = 0, p2CharIdx = 1;
let p1Confirmed = false, p2Confirmed = false;
let cpuDifficulty = 'off'; // 'off' | 'easy' | 'medium' | 'hard'
let isArcade = false;
let arcadeIdx = 0;
let arcadeVSTimer = 0;
let _cpuTimer = 0, _cpuHoldLeft = false, _cpuHoldRight = false, _cpuHoldDuck = false;
let roundFrame = 0;
let hitStop = 0;
let shakeT = 0;
let shakeMag = 0;

// ── Fighter factory ──────────────────────────────────────────────────────────
function mkFighter(x, char, dir) {
  return {
    x, y: 315, color: char.color, dark: char.dark, dir, depth: 0.5, jz: 0, jvz: 0, jumpCd: 0,
    hp: char.maxHp, hpDisplay: char.maxHp, hpFlash: 0, maxHp: char.maxHp,
    speed: char.speed, dmgMul: char.dmgMul, dashSpeed: char.dashSpeed,
    knockdown: false, knockdownT: 0, knockdownInvul: 0, knockdowns: 0,
    combo: 0, comboTimer: 0, maxCombo: 0,
    shield: MAX_SHIELD, shieldBroken: false, shieldBrokenTimer: 0,
    shieldTimer: 0, vx: 0,
    punching: false, punchT: 0, punchCd: 0,
    kicking: false, kickT: 0, kickCd: 0,
    supering: false, superT: 0, superCd: 0, superHit: false,
    wobble: 0, hit: 0, superFlash: 0,
    dashT: 0, dashCd: 0, dashDir: 0,
    ducking: false
  };
}

function spawnFighters() {
  p1 = mkFighter(190, CHARACTERS[p1CharIdx],  1);
  p2 = mkFighter(630, CHARACTERS[p2CharIdx], -1);
  floaties = [];
  roundFrame = 0;
  resetDoubleTap();
  _cpuReactTimer = 0; _cpuHoldLeft = false; _cpuHoldRight = false; _cpuHoldDuck = false;
}

function startGame() {
  currentRound = 1;
  roundsWon = [0, 0];
  roundStats = null;
  p1Confirmed = false;
  p2Confirmed = false;
  cpuDifficulty = 'off';
  _rematchLocal = false;
  _rematchOpp = false;
  phase = 'charSelect';
  window.BGM?.setPhase('menu');
  window.netHooks.onStartGame();
}

function startVsAI(difficulty) {
  window.playerNames.p2 = 'CPU';
  currentRound = 1;
  roundsWon = [0, 0];
  roundStats = null;
  p1Confirmed = false;
  p2Confirmed = false;
  _rematchLocal = false;
  _rematchOpp = false;
  cpuDifficulty = difficulty || 'medium';
  phase = 'charSelect';
  window.BGM?.setPhase('menu');
}

function startArcade() {
  isArcade = true;
  arcadeIdx = 0;
  const opp = ARCADE_OPPONENTS[0];
  cpuDifficulty = opp.difficulty;
  p2CharIdx = opp.charIdx;
  window.playerNames.p2 = opp.name;
  currentRound = 1;
  roundsWon = [0, 0];
  roundStats = null;
  p1Confirmed = false;
  p2Confirmed = false;
  _rematchLocal = false;
  _rematchOpp = false;
  totalRounds = 1;
  phase = 'charSelect';
  window.BGM?.setPhase('menu');
}

function _nextArcadeFight() {
  const opp = ARCADE_OPPONENTS[arcadeIdx];
  cpuDifficulty = opp.difficulty;
  p2CharIdx = opp.charIdx;
  window.playerNames.p2 = opp.name;
  currentRound = 1;
  roundsWon = [0, 0];
  roundStats = null;
  p1Confirmed = true;
  p2Confirmed = true;
  arcadeVSTimer = 180;
  phase = 'arcadeVS';
  SFX.roundWin();
}

function startFight() {
  _mKOs = 0; _mDmg = 0; _mCombo = 0;
  _mP1KDs = 0; _mWasLowHP = false; _mKOd = false; _mSuperLanded = false; _lowHpTick = 0;
  _hudPulse = 0;
  spawnFighters();
  countdownTimer = 180; // 3 seconds at 60 fps
  phase = 'countdown';
  window.BGM?.setPhase('fight');
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
}

function startNextRound() {
  currentRound++;
  spawnFighters();
  phase = 'fight';
  SFX.bell();
  window.BGM?.setPhase('fight');
  window.netHooks.onStartNext();
}

// ── Floaties ─────────────────────────────────────────────────────────────────
const FTXT = {
  punch: ['POW!','BAM!','BONK!','OOF!','WHAM!'],
  kick:  ['KICK!','SWOOSH!','ZAP!','CRACK!'],
  super: ['KA-BOOM!','ULTRA!','DESTROY!','ANNIHILATE!'],
  dodge: ['DUCK!','WHIFF!','MISSED!','NOPE!']
};
function addFloat(x, y, col, type, dmg, isTip) {
  const arr = FTXT[type];
  const size = type==='super'?28:type==='kick'?22:type==='dodge'?20:18;
  let txt = arr[Math.floor(Math.random()*arr.length)] + (dmg ? '  -'+Math.round(dmg) : '');
  if (isTip) txt = '✨TIP!✨ ' + txt;
  floaties.push({ x, y, vx:(Math.random()-0.5)*4, vy:-3-Math.random()*3, t:0, col, size:isTip?size+4:size, txt });
}

// ── Hit application ───────────────────────────────────────────────────────────
function applyHit(attacker, defender, dmg, type, isTip) {
  let d = dmg * (attacker.dmgMul ?? 1.0);

  // Shield-broken: 25% bonus damage, no absorption, until stun expires
  let justBrokeShield = false;
  if (defender.shieldBroken) {
    d *= 1.25;
  } else if (defender.shield > 0) {
    const absorb = Math.min(defender.shield, d * 0.7);
    defender.shield = Math.max(0, defender.shield - absorb);
    d -= absorb;
    if (defender.shield === 0) {
      justBrokeShield = true;
      defender.shieldBroken = true;
      defender.shieldBrokenTimer = SHIELD_BREAK_STUN;
      floaties.push({ x: defender.x, y: fighterScreenY(defender)-130, vx:0, vy:-1.8, t:0, col:'#ff4444', size:22, txt:'SHIELD BREAK!' });
    }
  }

  defender.hp = Math.max(0, defender.hp - d);
  if (d > 0) {
    defender.hpFlash = 10;
    // Knockdown: super always, or tip-hit above damage threshold
    const isHeavyHit = type === 'super' || (isTip && d >= KD_MIN_DMG);
    if (isHeavyHit && !defender.knockdown && defender.knockdownInvul <= 0) {
      defender.knockdown = true; defender.knockdownT = 0; defender.knockdowns++;
      defender.punching = false; defender.kicking = false; defender.supering = false; defender.dashT = 0;
      floaties.push({ x: defender.x, y: fighterScreenY(defender)-110, vx:0, vy:-1.5, t:0, col:'#ffe44d', size:28, txt:'DOWN!' });
    }
  }

  attacker.combo++;
  attacker.comboTimer = COMBO_WINDOW;
  if (attacker.combo > attacker.maxCombo) attacker.maxCombo = attacker.combo;
  defender.wobble = type==='super' ? 35 : 20;
  defender.hit    = type==='super' ? 18 : 12;
  // shieldTimer only resets when not in shield-break stun
  if (!defender.shieldBroken) defender.shieldTimer = SHIELD_REGEN_DELAY;
  addFloat(defender.x, fighterScreenY(defender)-100, attacker.color, type, d, isTip);

  if (type === 'super') {
    defender.vx = attacker.dir * 18;
    floaties.push({ x: defender.x, y: fighterScreenY(defender)-70, vx:(Math.random()-0.5)*3, vy:-3.5, t:0, col:'#ffee00', size:44, txt:'★', star:true });
  } else {
    defender.vx = attacker.dir * (type==='kick' ? 5 : 4);
  }
  hitStop  = type==='super' ? 18 : (isTip ? 8 : 5);
  shakeMag = type==='super' ? 22 : (isTip ? 7 : 4);
  shakeT   = type==='super' ? 32 : 12;

  if (type==='super') { SFX.superHit(); if (attacker === p1) _mSuperLanded = true; navigator.vibrate?.(200); }
  else if (type==='kick') { SFX.kick(); navigator.vibrate?.(50); }
  else { SFX.punch(); navigator.vibrate?.(30); }
  if (attacker.combo >= 3) SFX.impact(attacker.combo);

  if (justBrokeShield) setTimeout(()=>SFX.shieldBreak(), 80);
  else if (!defender.shieldBroken && defender.shield > 0) setTimeout(()=>SFX.shieldBlock(), 30);
  if (defender.hp <= 0) { setTimeout(()=>SFX.ko(), 150); navigator.vibrate?.([100,50,100]); }
}

// ── Collision checks ──────────────────────────────────────────────────────────
function tipDamage(fistLen, maxReach, baseDmg, tipDmg) {
  const ext = Math.max(0, (fistLen-22) / (maxReach-22));
  return baseDmg + (tipDmg-baseDmg)*ext + Math.random()*6;
}

function checkPunch(a, d) {
  if (d.knockdownInvul > 0) return;
  if (!a.punching) return;
  const t = Math.sin(a.punchT * Math.PI);
  if (t < 0.45) return;
  const rawLen = 22 + t * (PUNCH_REACH - 22);
  const armReach = Math.min(rawLen, Math.abs(d.x - a.x) - 10);
  if (armReach < 0) return;
  if (fistDist(a.x + a.dir * armReach, a.depth, d) < PUNCH_HIT_R) {
    if (d.ducking) {
      a.punching=false; a.punchT=0; a.punchCd=PUNCH_CD;
      addFloat(d.x, fighterScreenY(d)-90, '#88ff88', 'dodge', 0, false); SFX.dodge(); return;
    }
    const isTip = (armReach-22)/(PUNCH_REACH-22) > 0.85;
    applyHit(a, d, tipDamage(armReach, PUNCH_REACH, 8, 22), 'punch', isTip);
    a.punching=false; a.punchT=0; a.punchCd=PUNCH_CD;
  }
}
function checkKick(a, d) {
  if (d.knockdownInvul > 0) return;
  if (!a.kicking) return;
  const t = Math.sin(a.kickT * Math.PI);
  if (t < 0.4) return;
  const rawLen = 30 + t * (KICK_REACH - 30);
  const armReach = Math.min(rawLen, Math.abs(d.x - a.x) - 10);
  if (armReach < 0) return;
  if (fistDist(a.x + a.dir * armReach, a.depth, d) < KICK_HIT_R) {
    if (d.jz > 30) {
      a.kicking=false; a.kickT=0;
      addFloat(d.x, fighterScreenY(d)-90, '#88ff88', 'dodge', 0, false); SFX.dodge(); return;
    }
    const isTip = (armReach-30)/(KICK_REACH-30) > 0.85;
    applyHit(a, d, tipDamage(armReach, KICK_REACH, 16, 38), 'kick', isTip);
    a.kicking=false; a.kickT=0;
  }
}
function checkSuper(a, d) {
  if (d.knockdownInvul > 0) return;
  if (!a.supering) return;
  const t = Math.sin(a.superT * Math.PI);
  if (t < 0.35) return;
  const rawLen = 22 + t * (SUPER_REACH - 22);
  const armReach = Math.min(rawLen, Math.abs(d.x - a.x) - 10);
  if (armReach < 0) return;
  if (fistDist(a.x + a.dir * armReach, a.depth, d) < SUPER_HIT_R) {
    if (d.ducking) {
      a.supering=false; a.superT=0;
      addFloat(d.x, fighterScreenY(d)-90, '#88ff88', 'dodge', 0, false); SFX.dodge(); return;
    }
    const isTip = (armReach-22)/(SUPER_REACH-22) > 0.85;
    applyHit(a, d, tipDamage(armReach, SUPER_REACH, 55, 120), 'super', isTip);
    a.superHit = true;
    a.supering=false; a.superT=0;
  }
}

// ── CPU AI ────────────────────────────────────────────────────────────────────
const CPU_LEVELS = {
  easy:   { react: 22, jitter: 14, attackRoll: 0.50, dodgeChance: 0.22, dashChance: 0.07, superRoll: 0.06, kickRoll: 0.18, approachTick: 10 },
  medium: { react: 12, jitter:  7, attackRoll: 0.72, dodgeChance: 0.68, dashChance: 0.22, superRoll: 0.14, kickRoll: 0.32, approachTick:  6 },
  hard:   { react:  5, jitter:  3, attackRoll: 0.90, dodgeChance: 0.92, dashChance: 0.48, superRoll: 0.25, kickRoll: 0.50, approachTick:  3 },
};

const ARCADE_OPPONENTS = [
  { name: 'THE ROOKIE',   title: 'Fight 1 / 6', charIdx: 0, difficulty: 'easy'   },
  { name: 'THE SWIFT',    title: 'Fight 2 / 6', charIdx: 2, difficulty: 'easy'   },
  { name: 'THE BRAWLER',  title: 'Fight 3 / 6', charIdx: 1, difficulty: 'medium' },
  { name: 'THE VETERAN',  title: 'Fight 4 / 6', charIdx: 3, difficulty: 'medium' },
  { name: 'IRON FIST',    title: 'Fight 5 / 6', charIdx: 2, difficulty: 'hard'   },
  { name: 'THE CHAMPION', title: 'Final Fight',  charIdx: 1, difficulty: 'hard'   },
];

let _cpuReactTimer = 0;

function updateCPU() {
  if (cpuDifficulty === 'off' || phase !== 'fight' || !p1 || !p2) return;
  const cfg = CPU_LEVELS[cpuDifficulty];

  inputState.p2.left  = _cpuHoldLeft;
  inputState.p2.right = _cpuHoldRight;
  inputState.p2.duck  = _cpuHoldDuck;
  inputState.p2.punch = false;
  inputState.p2.kick  = false;
  inputState.p2.super = false;
  inputState.p2.jump  = false;

  if (p2.knockdown) { _cpuHoldLeft=false; _cpuHoldRight=false; _cpuHoldDuck=false; return; }

  _cpuReactTimer--;
  if (_cpuReactTimer > 0) return;

  const dx = p1.x - p2.x;
  const absDx = Math.abs(dx);
  const inPunchRange = absDx < PUNCH_REACH - 10;
  const inSuperRange = absDx < SUPER_REACH + 20;
  const roll = Math.random();

  // Boost aggression when P1 is low HP
  const lowHp = p1.hp < p1.maxHp * 0.40;
  const atkRoll  = lowHp ? Math.min(0.96, cfg.attackRoll * 1.35) : cfg.attackRoll;
  const reactMul = lowHp ? 0.65 : 1.0;

  if (p1.supering && inSuperRange && roll < cfg.dodgeChance) {
    if (roll < cfg.dodgeChance * 0.5) {
      _cpuHoldDuck = true;
      _cpuHoldLeft = false; _cpuHoldRight = false;
    } else {
      inputState.p2.jump = true;
      _cpuHoldLeft = dx > 0; _cpuHoldRight = dx < 0;
      _cpuHoldDuck = false;
    }
    _cpuReactTimer = Math.ceil(cfg.react * reactMul);
  } else if (inPunchRange && roll < atkRoll) {
    _cpuHoldLeft=false; _cpuHoldRight=false; _cpuHoldDuck=false;
    if (p2.superCd <= 0 && roll < cfg.superRoll) {
      inputState.p2.super = true;
    } else if (p2.kickCd <= 0 && roll < cfg.kickRoll) {
      inputState.p2.kick = true;
    } else {
      inputState.p2.punch = true;
    }
    _cpuReactTimer = Math.ceil((cfg.react + Math.floor(Math.random() * cfg.jitter)) * reactMul);
  } else if (absDx > PUNCH_REACH - 15) {
    _cpuHoldLeft  = dx < 0;
    _cpuHoldRight = dx > 0;
    _cpuHoldDuck  = false;
    if (absDx > PUNCH_REACH + 60 && p2.dashCd <= 0 && roll < cfg.dashChance) {
      inputState.p2.dash = dx < 0 ? -1 : 1;
    }
    _cpuReactTimer = Math.ceil(cfg.approachTick * reactMul);
  } else {
    _cpuHoldLeft=false; _cpuHoldRight=false; _cpuHoldDuck=false;
    if (roll < atkRoll * 0.72) inputState.p2.punch = true;
    else if (roll < atkRoll * 0.88 && p2.kickCd <= 0) inputState.p2.kick = true;
    _cpuReactTimer = Math.ceil(cfg.react * reactMul);
  }
}

// ── Update ────────────────────────────────────────────────────────────────────
function update() {
  if (phase==='menu' || phase==='charSelect' || phase==='stats' || phase==='achievements') return;

  if (phase === 'arcadeVS') {
    arcadeVSTimer--;
    if (arcadeVSTimer <= 0) startFight();
    return;
  }
  if (phase === 'arcadeOver' || phase === 'arcadeComplete') return;

  if (phase === 'countdown') {
    _hudPulse++;
    countdownTimer--;
    if (countdownTimer <= 0) { phase = 'fight'; SFX.bell(); }
    return;
  }

  if (phase==='roundEnd') {
    if (roundEndTimer > 0) {
      roundEndTimer--;
      if (roundEndTimer === 0) {
        const needed = Math.ceil(totalRounds/2);
        if (roundsWon[0]<needed && roundsWon[1]<needed && currentRound<totalRounds && window.netHooks.canStartNext()) startNextRound();
      }
    }
    return;
  }
  if (phase==='gameOver') return;

  updateCPU();

  _hudPulse++;
  if (hitStop > 0) { hitStop--; return; }
  if (shakeT > 0) shakeT--;

  const canAct = p => !p.punching && !p.kicking && !p.supering && !p.knockdown;
  if (p1.knockdown) { p1.vx = 0; p1.dashT = 0; inputState.p1.dash = 0; }
  if (p2.knockdown) { p2.vx = 0; p2.dashT = 0; inputState.p2.dash = 0; }

  // dash trigger — consume the one-shot dash signal from inputState
  if (inputState.p1.dash !== 0 && p1.dashCd<=0 && p1.dashT<=0 && canAct(p1)) {
    p1.dashT=DASH_FRAMES; p1.dashDir=inputState.p1.dash; p1.dashCd=DASH_CD; SFX.dash();
  }
  if (inputState.p2.dash !== 0 && p2.dashCd<=0 && p2.dashT<=0 && canAct(p2)) {
    p2.dashT=DASH_FRAMES; p2.dashDir=inputState.p2.dash; p2.dashCd=DASH_CD; SFX.dash();
  }
  inputState.p1.dash = 0;
  inputState.p2.dash = 0;

  // movement — use per-fighter speed and dashSpeed from character selection
  if (p1.dashT>0) { p1.vx=p1.dashDir*p1.dashSpeed; p1.dashT--; }
  else if (inputState.p1.left) p1.vx=-p1.speed; else if (inputState.p1.right) p1.vx=p1.speed; else p1.vx*=0.7;

  if (p2.dashT>0) { p2.vx=p2.dashDir*p2.dashSpeed; p2.dashT--; }
  else if (inputState.p2.left) p2.vx=-p2.speed; else if (inputState.p2.right) p2.vx=p2.speed; else p2.vx*=0.7;

  p1.x = Math.max(70, Math.min(W-70, p1.x+p1.vx));
  p2.x = Math.max(70, Math.min(W-70, p2.x+p2.vx));

  // Depth movement — W/ArrowUp moves toward back of ring
  if (!p1.punching && !p1.kicking && !p1.supering && p1.dashT<=0 && !p1.knockdown) {
    if (inputState.p1.up) p1.depth = Math.max(0, p1.depth - DEPTH_SPEED);
    else p1.depth = Math.min(1, p1.depth + DEPTH_SPEED * 0.5);
  }
  if (!p2.punching && !p2.kicking && !p2.supering && p2.dashT<=0 && !p2.knockdown) {
    if (inputState.p2.up) p2.depth = Math.max(0, p2.depth - DEPTH_SPEED);
    else p2.depth = Math.min(1, p2.depth + DEPTH_SPEED * 0.5);
  }

  // Jump physics
  for (const p of [p1, p2]) {
    if (p.jz > 0 || p.jvz < 0) {
      p.jvz += GRAVITY;
      p.jz = Math.max(0, p.jz - p.jvz);
      if (p.jz === 0 && p.jvz >= 0) { p.jvz = 0; p.jumpCd = JUMP_CD; SFX.land(); }
    }
    if (p.jumpCd > 0) p.jumpCd--;
  }

  // Jump trigger (one-shot consumed here)
  if (inputState.p1.jump && p1.jz === 0 && p1.jumpCd <= 0 && canAct(p1)) { p1.jvz = JUMP_VZ; SFX.jump(); }
  if (inputState.p2.jump && p2.jz === 0 && p2.jumpCd <= 0 && canAct(p2)) { p2.jvz = JUMP_VZ; SFX.jump(); }
  inputState.p1.jump = false;
  inputState.p2.jump = false;

  // 2D Euclidean collision — push apart along line between fighters in (x, screen-y)
  const _colDx  = p2.x - p1.x;
  const _colDsy = depthToScreenY(p2.depth) - depthToScreenY(p1.depth);
  const _colDist = Math.hypot(_colDx, _colDsy);
  if (_colDist < MIN_GAP) {
    const overlap = MIN_GAP - _colDist;
    const nx = _colDist > 0.5 ? _colDx  / _colDist : 1;
    const ny = _colDist > 0.5 ? _colDsy / _colDist : 0;
    const pushX     = nx * overlap / 2;
    const pushDepth = (ny * overlap / 2) / (RING_FRONT_Y - RING_BACK_Y);
    p1.x     = Math.max(70, Math.min(W-70, p1.x     - pushX));
    p2.x     = Math.max(70, Math.min(W-70, p2.x     + pushX));
    p1.depth = Math.max(0,  Math.min(1,    p1.depth  - pushDepth));
    p2.depth = Math.max(0,  Math.min(1,    p2.depth  + pushDepth));
  }

  p1.dir = p2.x>p1.x ?  1 : -1;
  p2.dir = p1.x<p2.x ? -1 :  1;

  // ducking
  const canDuck = p => !p.punching && !p.kicking && !p.supering && p.dashT<=0 && !p.knockdown;
  p1.ducking = inputState.p1.duck ? canDuck(p1) : false;
  p2.ducking = inputState.p2.duck ? canDuck(p2) : false;

  // attacks
  const noAction = p => !p.punching && !p.kicking && !p.supering && p.punchCd<=0 && p.dashT<=0;
  if (inputState.p1.punch && noAction(p1))                          { p1.punching=true; p1.punchT=0; }
  if (inputState.p2.punch && noAction(p2))                          { p2.punching=true; p2.punchT=0; }
  if (inputState.p1.kick  && noAction(p1) && p1.kickCd<=0)         { p1.kicking=true;  p1.kickT=0;  p1.kickCd=KICK_CD; }
  if (inputState.p2.kick  && noAction(p2) && p2.kickCd<=0)         { p2.kicking=true;  p2.kickT=0;  p2.kickCd=KICK_CD; }
  if (inputState.p1.super && noAction(p1) && p1.superCd<=0)        { p1.supering=true; p1.superT=0; p1.superCd=SUPER_CD; p1.superFlash=30; p1.superHit=false; SFX.superCharge(); setTimeout(()=>{ if(p1.supering) SFX.superStretch(); }, 200); }
  if (inputState.p2.super && noAction(p2) && p2.superCd<=0)        { p2.supering=true; p2.superT=0; p2.superCd=SUPER_CD; p2.superFlash=30; p2.superHit=false; SFX.superCharge(); setTimeout(()=>{ if(p2.supering) SFX.superStretch(); }, 200); }

  // advance timers
  if (p1.punching) { p1.punchT+=0.07; if (p1.punchT>=1) { p1.punching=false; p1.punchT=0; p1.punchCd=PUNCH_CD; } }
  if (p2.punching) { p2.punchT+=0.07; if (p2.punchT>=1) { p2.punching=false; p2.punchT=0; p2.punchCd=PUNCH_CD; } }
  if (p1.kicking)  { p1.kickT+=0.055; if (p1.kickT>=1)  { p1.kicking=false;  p1.kickT=0; } }
  if (p2.kicking)  { p2.kickT+=0.055; if (p2.kickT>=1)  { p2.kicking=false;  p2.kickT=0; } }
  if (p1.supering) { p1.superT+=0.028; if (p1.superT>=1) { p1.supering=false; p1.superT=0; if(!p1.superHit){ floaties.push({x:p1.x+p1.dir*SUPER_REACH*0.55,y:fighterScreenY(p1)-55,vx:p1.dir*3,vy:-2,t:0,col:'#aaddff',size:22,txt:'WHOOSH! 💨'}); SFX.superWhiff(); } } }
  if (p2.supering) { p2.superT+=0.028; if (p2.superT>=1) { p2.supering=false; p2.superT=0; if(!p2.superHit){ floaties.push({x:p2.x+p2.dir*SUPER_REACH*0.55,y:fighterScreenY(p2)-55,vx:p2.dir*3,vy:-2,t:0,col:'#aaddff',size:22,txt:'WHOOSH! 💨'}); SFX.superWhiff(); } } }
  for (const p of [p1,p2]) {
    if (p.kickCd>0)    p.kickCd--;
    if (p.superCd>0)   p.superCd--;
    if (p.punchCd>0)   p.punchCd--;
    if (p.dashCd>0)    p.dashCd--;
    if (p.superFlash>0) p.superFlash--;
    if (p.wobble>0)    p.wobble--;
    if (p.hit>0)       p.hit--;
    if (p.hpFlash>0)   p.hpFlash--;
    else if (p.hpDisplay > p.hp) p.hpDisplay = Math.max(p.hp, p.hpDisplay - 1.2);
    if (p.knockdownInvul > 0) p.knockdownInvul--;
    if (p.comboTimer > 0) {
      p.comboTimer--;
      if (p.comboTimer === 0 && p.combo >= 2) {
        const n = p.combo;
        const col = n >= 6 ? '#ffd700' : n >= 4 ? '#ff4444' : '#ff8800';
        const msg = `${n} HIT${n >= 6 ? '!!' : '!'}`;
        floaties.push({ x: p.x + p.dir*55, y: fighterScreenY(p)-100, vx: p.dir*1.5, vy:-2.2, t:0, col, size: Math.min(30, 18+n*2), txt: msg });
        if (n >= 6) SFX.bell(); else SFX.shieldBlock();
        p.combo = 0;
      } else if (p.comboTimer === 0) {
        p.combo = 0;
      }
    }
    if (p.knockdown) {
      if (p.knockdownT === KD_FALL) SFX.stagger();
      const inDown = p.knockdownT >= KD_FALL && p.knockdownT < KD_FALL + KD_DOWN;
      if (inDown && (p.knockdownT - KD_FALL) % 12 === 0) SFX.click();
      p.knockdownT++;
      if (p.knockdownT >= KD_TOTAL) { p.knockdown=false; p.knockdownT=0; p.knockdownInvul=KD_INVUL; }
    }
    // Shield-break stun blocks regen timer; regen only starts after stun clears
    if (p.shieldBrokenTimer > 0) {
      p.shieldBrokenTimer--;
      if (p.shieldBrokenTimer === 0) { p.shieldBroken = false; p.shieldTimer = SHIELD_REGEN_DELAY; }
    } else if (p.shieldTimer > 0) {
      p.shieldTimer--;
    } else if (p.shield < MAX_SHIELD) {
      p.shield = Math.min(MAX_SHIELD, p.shield + SHIELD_REGEN_RATE);
    }
  }

  checkPunch(p1,p2); checkPunch(p2,p1);
  checkKick(p1,p2);  checkKick(p2,p1);
  checkSuper(p1,p2); checkSuper(p2,p1);

  // Achievement real-time checks
  if (p1.hp < p1.maxHp * 0.25) _mWasLowHP = true;
  if (p1.combo >= 5) _unlockAch('combo_king');

  // Low-HP heartbeat (either fighter below 25%)
  _lowHpTick++;
  if ((p1.hp < p1.maxHp * 0.25 || p2.hp < p2.maxHp * 0.25) && _lowHpTick % 90 === 0) SFX.lowHp();

  // Time warning — tick every second in last 10 seconds
  const _timeLeft = ROUND_TIME - roundFrame;
  if (_timeLeft > 0 && _timeLeft <= 600 && _timeLeft % 60 === 0) SFX.timeWarn();

  for (const f of floaties) { f.x+=f.vx; f.y+=f.vy; f.vy+=0.12; f.t++; }
  floaties = floaties.filter(f=>f.t<65);

  roundFrame++;
  if (p1.hp<=0 || p2.hp<=0) {
    if (p1.hp<=0 && p2.hp<=0) endRound('DRAW!', 0, 0);
    else if (p2.hp<=0) endRound(`🟦 ${window.playerNames.p1} wins the round! KO!`, 1, 0);
    else endRound(`🟥 ${window.playerNames.p2} wins the round! KO!`, 0, 1);
  } else if (roundFrame >= ROUND_TIME) {
    if (Math.abs(p1.hp-p2.hp) < 1) endRound('TIME UP — DRAW!', 0, 0);
    else if (p1.hp>p2.hp) endRound(`🟦 ${window.playerNames.p1} wins on points! (Time)`, 1, 0);
    else endRound(`🟥 ${window.playerNames.p2} wins on points! (Time)`, 0, 1);
  }
}

function endRound(msg, p1Win, p2Win) {
  if (!window.netHooks.canEndRound()) return;
  window.netHooks.onEndRound(msg, p1Win, p2Win);
  _endRound(msg, p1Win, p2Win);
}
function _endRound(msg, p1Win, p2Win) {
  const needed = Math.ceil(totalRounds/2);
  roundsWon[0]+=p1Win; roundsWon[1]+=p2Win;
  roundEndMsg = msg;
  roundEndTimer = 180;
  window.BGM?.setPhase('menu');
  roundStats = {
    p1: { hp: p1.hp, maxHp: p1.maxHp, knockdowns: p1.knockdowns, maxCombo: p1.maxCombo, dmgDealt: Math.round(p2.maxHp - p2.hp) },
    p2: { hp: p2.hp, maxHp: p2.maxHp, knockdowns: p2.knockdowns, maxCombo: p2.maxCombo, dmgDealt: Math.round(p1.maxHp - p1.hp) },
    winner: p1Win > 0 ? 0 : p2Win > 0 ? 1 : -1,
  };
  // Accumulate per-round stats for the match totals
  _mKOs   += p2.knockdowns;
  _mDmg   += Math.round(p2.maxHp - p2.hp);
  _mCombo  = Math.max(_mCombo, p1.maxCombo);
  _mP1KDs += p1.knockdowns;
  if (p1Win > 0 && p2.hp <= 0) _mKOd = true;
  // Round-level achievements
  if (p1Win > 0 && roundFrame < 20 * 60) _unlockAch('speed_demon');
  if (p1Win > 0 && p1.hp >= p1.maxHp)   _unlockAch('perfect');
  if (roundsWon[0]>=needed || roundsWon[1]>=needed || currentRound>=totalRounds) {
    roundEndTimer = 999;
    phase = 'roundEnd';
    _updateMatchStats(roundsWon[0] > roundsWon[1], roundsWon[0] === roundsWon[1] && currentRound >= totalRounds);
    setTimeout(()=>SFX.victory(), 700);
  } else {
    phase = 'roundEnd';
    if (p1Win > 0 || p2Win > 0) setTimeout(()=>SFX.roundWin(), 300);
  }
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawRing() {
  ctx.fillStyle='#c8a870'; ctx.fillRect(50,245,720,210);
  ctx.fillStyle='#8b6040'; ctx.fillRect(50,445,720,12);
  ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(W/2-2,245,4,200);
  for (let i=0;i<3;i++) {
    ctx.beginPath(); ctx.moveTo(50,252+i*18); ctx.lineTo(770,252+i*18);
    ctx.strokeStyle=i===1?'#ff4':'#fff'; ctx.lineWidth=5; ctx.stroke();
    ctx.fillStyle='#ccc';
    ctx.fillRect(44,245,12,210); ctx.fillRect(764,245,12,210);
  }
}
function drawCrowd() {
  for (let i=0;i<38;i++) {
    const cx=8+i*22, wave=Math.sin(Date.now()/400+i*0.7)*6;
    ctx.beginPath(); ctx.ellipse(cx,215+wave,9,14,0,0,Math.PI*2);
    ctx.fillStyle=`hsl(${i*28},55%,35%)`; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,195+wave,9,0,Math.PI*2);
    ctx.fillStyle=`hsl(${20+i*10},40%,65%)`; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx-9,205+wave); ctx.lineTo(cx-18,193+Math.sin(Date.now()/300+i)*10+wave);
    ctx.moveTo(cx+9,205+wave); ctx.lineTo(cx+18,193+Math.cos(Date.now()/300+i)*10+wave);
    ctx.strokeStyle=`hsl(${i*28},55%,35%)`; ctx.lineWidth=3; ctx.stroke();
  }
}

function drawFighter(p) {
  const s    = depthToScale(p.depth);
  const sy   = fighterScreenY(p);
  const wobX = Math.sin(p.wobble*0.5)*10;
  const hitFlash = p.hit>0 && Math.floor(p.hit)%2===0;
  ctx.save();
  if (p.knockdownInvul > 0 && Math.floor(p.knockdownInvul / 5) % 2 === 0) ctx.globalAlpha = 0.35;
  ctx.translate(p.x+wobX, sy);
  ctx.scale(s, s);
  if (p.knockdown) {
    const t = p.knockdownT;
    const angle = t < KD_FALL
      ? (t / KD_FALL) * (Math.PI / 2)
      : t < KD_FALL + KD_DOWN
        ? Math.PI / 2
        : (1 - (t - KD_FALL - KD_DOWN) / KD_RISE) * (Math.PI / 2);
    ctx.translate(0, 52); ctx.rotate(-p.dir * angle); ctx.translate(0, -52);
  } else if (p.ducking) { ctx.translate(0,18); ctx.scale(1,0.72); }
  const col  = hitFlash ? '#fff' : (p.superFlash>0 ? '#ffff44' : p.color);
  const dark = p.dark ?? (p.color==='#4488ff' ? '#1144aa' : '#aa1111');

  if (p.superFlash>0) {
    ctx.save(); ctx.globalAlpha=(p.superFlash/30)*0.45;
    ctx.beginPath(); ctx.arc(0,-30,55,0,Math.PI*2); ctx.fillStyle='#ffff00'; ctx.fill();
    ctx.restore();
  }
  if (p.shieldBroken) {
    // Red pulsing ring — shield-break stun indicator
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(Date.now() / 40) * 0.30;
    ctx.beginPath(); ctx.arc(0,-30,52,0,Math.PI*2);
    ctx.strokeStyle='#ff3333'; ctx.lineWidth=3; ctx.stroke();
    ctx.restore();
  } else if (p.shield>0) {
    ctx.save();
    ctx.globalAlpha=(p.shield/MAX_SHIELD)*0.22;
    ctx.beginPath(); ctx.arc(0,-30,50,0,Math.PI*2); ctx.fillStyle='#44aaff'; ctx.fill();
    ctx.globalAlpha=(p.shield/MAX_SHIELD)*0.45;
    ctx.beginPath(); ctx.arc(0,-30,50,0,Math.PI*2); ctx.strokeStyle='#88ccff'; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
  }
  const opponent = (p===p1) ? p2 : p1;
  const fighterGap = (p1&&p2) ? Math.abs(opponent.x-p.x) / s : 999;

  if (p.kicking) {
    const t=Math.sin(p.kickT*Math.PI);
    const rawLx=30+t*(KICK_REACH-30);
    const clampedLx=Math.max(22,Math.min(rawLx,fighterGap-10));
    const lx=p.dir*clampedLx, ly=-10+t*20;
    const kickTip=(clampedLx-30)/(KICK_REACH-30)>0.8;
    ctx.beginPath(); ctx.moveTo(p.dir*8,20); ctx.quadraticCurveTo(p.dir*40,10,lx,ly);
    ctx.strokeStyle=col; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
    if (kickTip) {
      ctx.save(); ctx.globalAlpha=0.5+Math.sin(Date.now()/40)*0.3;
      ctx.beginPath(); ctx.ellipse(lx,ly,20,15,p.dir*0.4,0,Math.PI*2);
      ctx.fillStyle='#ff8800'; ctx.fill(); ctx.restore();
    }
    ctx.beginPath(); ctx.ellipse(lx,ly,14,9,p.dir*0.4,0,Math.PI*2);
    ctx.fillStyle='#333'; ctx.fill();
  }
  const armY = -35;
  const nowMs = Date.now();

  if (p.supering) {
    const t = p.superT;
    // Phase 1 (t<0.20): wind-up — arm coils backward
    // Phase 2 (t 0.20→1.0): extension using sin curve
    let visualFrac;
    if (t < 0.20) {
      visualFrac = -0.10 * Math.sin((t / 0.20) * Math.PI);
    } else {
      visualFrac = Math.sin(((t - 0.20) / 0.80) * Math.PI);
    }
    let sArmLen = 22 + visualFrac * (SUPER_REACH - 22);
    sArmLen = Math.max(4, Math.min(sArmLen, fighterGap - 10));
    const extFrac = Math.max(0, visualFrac); // 0→1 during extension

    // Wind-up charge effect
    if (t < 0.20) {
      const chargeT = t / 0.20;
      ctx.save();
      ctx.globalAlpha = chargeT * 0.55 * (0.5 + 0.5 * Math.sin(nowMs / 25));
      ctx.beginPath(); ctx.arc(-p.dir * 14, armY, 10 + chargeT * 22, 0, Math.PI * 2);
      ctx.fillStyle = '#ff8800'; ctx.fill();
      ctx.globalAlpha = chargeT * 0.35;
      ctx.beginPath(); ctx.arc(-p.dir * 14, armY, 6 + chargeT * 10, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();
    }

    // Ghost trail afterimages (3 fists behind the current fist)
    if (extFrac > 0.15) {
      for (let i = 3; i >= 1; i--) {
        const trailFrac = extFrac - i * 0.13;
        if (trailFrac <= 0) continue;
        const trailLen = Math.max(4, Math.min(22 + trailFrac * (SUPER_REACH - 22), fighterGap - 10));
        const tfx = p.dir * trailLen;
        ctx.save();
        ctx.globalAlpha = (0.15 - i * 0.04) * extFrac;
        ctx.beginPath(); ctx.arc(tfx, armY, 18, 0, Math.PI * 2);
        ctx.fillStyle = '#ffff44'; ctx.fill();
        ctx.restore();
      }
    }

    // Whoosh speed lines during fast extension
    if (extFrac > 0.20 && extFrac < 0.85) {
      const fx2 = p.dir * sArmLen;
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const lx = fx2 - p.dir * (22 + i * 28);
        const ly = armY + (i % 2 === 0 ? -7 : 7);
        const lineLen = (18 + i * 10) * extFrac;
        ctx.globalAlpha = (0.55 - i * 0.09) * extFrac;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx - p.dir * lineLen, ly);
        ctx.strokeStyle = '#ffffbb';
        ctx.lineWidth = 2.5 - i * 0.3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    // Noodle arm — sine-wave wiggle along arm length
    const segs = 10;
    ctx.beginPath();
    ctx.moveTo(p.dir * 12, armY);
    for (let seg = 1; seg <= segs; seg++) {
      const segFrac = seg / segs;
      const segX = p.dir * (12 + segFrac * (sArmLen - 12));
      const wiggle = extFrac * 16 * Math.sin(segFrac * Math.PI * 3 - nowMs / 55) * (1 - segFrac * 0.6);
      ctx.lineTo(segX, armY + wiggle);
    }
    ctx.strokeStyle = col; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.strokeStyle = dark; ctx.lineWidth = 2.5; ctx.stroke();

    // Fist
    const fx = p.dir * sArmLen;
    const fistR = 26;
    if (extFrac > 0.70) {
      ctx.save();
      ctx.globalAlpha = 0.55 + Math.sin(nowMs / 35) * 0.30;
      ctx.beginPath(); ctx.arc(fx, armY, fistR + 12, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6600'; ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(fx, armY, fistR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffff44'; ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(fx+p.dir*(4+i*3),armY-9); ctx.lineTo(fx+p.dir*(4+i*3),armY+9); ctx.strokeStyle=dark; ctx.lineWidth=1.5; ctx.stroke(); }
  } else {
    // Normal punch arm
    let armLen = 22;
    if (p.punching) { const raw=22+Math.sin(p.punchT*Math.PI)*(PUNCH_REACH-22); armLen=Math.max(22,Math.min(raw,fighterGap-10)); }
    const fx = p.dir * armLen;
    ctx.beginPath(); ctx.moveTo(p.dir*12, armY);
    ctx.bezierCurveTo(p.dir*(armLen*0.3), armY-15, p.dir*(armLen*0.7), armY+10, fx, armY);
    ctx.strokeStyle=col; ctx.lineWidth=12; ctx.lineCap='round'; ctx.stroke();
    ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
    const fist = 16;
    const punchExt = p.punching ? (armLen-22)/(PUNCH_REACH-22) : 0;
    if (p.punching && punchExt > 0.8) {
      ctx.save(); ctx.globalAlpha=0.5+Math.sin(nowMs/40)*0.3;
      ctx.beginPath(); ctx.arc(fx, armY, fist+8, 0, Math.PI*2);
      ctx.fillStyle='#ff4400'; ctx.fill(); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(fx, armY, fist, 0, Math.PI*2);
    ctx.fillStyle=col; ctx.fill();
    ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
    for (let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(fx+p.dir*(4+i*3),armY-8);ctx.lineTo(fx+p.dir*(4+i*3),armY+8);ctx.strokeStyle=dark;ctx.lineWidth=1.5;ctx.stroke();}
  }
  ctx.beginPath(); ctx.ellipse(0,-10,24,34,0,0,Math.PI*2);
  ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle=dark; ctx.fillRect(-22,5,44,8);
  ctx.fillStyle='#ffdd00'; ctx.fillRect(-6,4,12,10);
  ctx.beginPath(); ctx.ellipse(0,20,20,14,0,0,Math.PI*2); ctx.fillStyle=dark; ctx.fill();
  ctx.fillStyle='#ffcc99'; ctx.fillRect(-14,28,10,22); ctx.fillRect(4,28,10,22);
  ctx.fillStyle='#333';
  ctx.beginPath();ctx.ellipse(-9,52,10,6,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(9,52,10,6,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(-p.dir*16,-22,11,0,Math.PI*2);
  ctx.fillStyle=col;ctx.fill();ctx.strokeStyle=dark;ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(0,-58,24,0,Math.PI*2);
  ctx.fillStyle='#ffcc99';ctx.fill();ctx.strokeStyle='#cc9966';ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(0,-62,26,Math.PI*1.1,Math.PI*1.9);
  ctx.strokeStyle=col;ctx.lineWidth=8;ctx.stroke();
  ctx.beginPath();ctx.moveTo(-26,-58);ctx.lineTo(-22,-36);ctx.moveTo(26,-58);ctx.lineTo(22,-36);
  ctx.strokeStyle=col;ctx.lineWidth=6;ctx.stroke();
  const eo=p.dir*5;
  if(p.hp<40){ctx.fillStyle='#333';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillText('x',eo-7,-54);ctx.fillText('x',eo+7,-54);}
  else{ctx.fillStyle='#222';ctx.beginPath();ctx.arc(eo-7,-61,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(eo+7,-61,4,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(eo-5,-62,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(eo+9,-62,1.5,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='#883300';ctx.lineWidth=2;ctx.beginPath();
  if(p.hit>0)ctx.arc(eo,-51,7,0,Math.PI);else ctx.arc(eo,-55,5,0,Math.PI,true);ctx.stroke();
  if(p.hp<(p.maxHp??MAX_HP)*0.5){ctx.fillStyle='#88ccff';ctx.beginPath();ctx.ellipse(p.dir*18,-70+Math.sin(Date.now()/200)*3,3,5,0.3,0,Math.PI*2);ctx.fill();}

  // Range indicator: ground arc + hit-zone ring during attack windup
  if (p.punching || p.kicking || p.supering) {
    const atk_t  = p.punching ? p.punchT : (p.kicking ? p.kickT : p.superT);
    const sin_t  = Math.sin(atk_t * Math.PI);
    if (sin_t > 0.2) {
      const maxR   = p.punching ? PUNCH_REACH  : (p.kicking ? KICK_REACH  : SUPER_REACH);
      const minR   = p.punching ? 22           : (p.kicking ? 30          : 22);
      const hitR   = (p.punching ? PUNCH_HIT_R : (p.kicking ? KICK_HIT_R : SUPER_HIT_R)) / s;
      const reach  = Math.max(minR, Math.min(minR + sin_t*(maxR-minR), fighterGap - 10));
      const tipX   = p.dir * reach;
      const tipY   = p.kicking ? (-10 + sin_t*20) : -35;
      ctx.save();
      // Ground shadow ellipse showing reach
      ctx.globalAlpha = 0.18 * sin_t;
      ctx.beginPath();
      ctx.ellipse(tipX/2, 54, Math.max(6, reach/2), Math.max(3, reach/5), 0, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();
      // Hit-zone ring at tip
      ctx.globalAlpha = 0.35 * sin_t;
      ctx.beginPath();
      ctx.arc(tipX, tipY, hitR, 0, Math.PI*2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2 / s;
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawBar(x,y,w,h,val,max,c1,c2,ghost,flash){
  ctx.fillStyle='#222';ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.fill();
  // Ghost (yellow) bar: shows pending drain between ghost and actual HP
  if(ghost>val){const gw=Math.max(0,(ghost/max)*w);ctx.fillStyle='#c87800';ctx.beginPath();ctx.roundRect(x,y,gw,h,5);ctx.fill();}
  // Actual bar
  const fw=Math.max(0,(val/max)*w);
  if(fw>0){const g=ctx.createLinearGradient(x,0,x+w,0);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,fw,h,5);ctx.fill();}
  // Hit flash: white pulse over the filled portion
  if(flash>0&&fw>4){ctx.save();ctx.globalAlpha=(flash/10)*0.45;ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(x,y,fw,h,5);ctx.fill();ctx.restore();}
  ctx.strokeStyle='#fff3';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.stroke();
}
function drawCdBtn(x,y,label,cd,maxCd,accent){
  const ready=cd<=0;
  ctx.save();ctx.globalAlpha=ready?1:0.55;
  ctx.fillStyle=ready?accent:'#444';ctx.beginPath();ctx.roundRect(x,y,42,22,5);ctx.fill();
  ctx.fillStyle=ready?'#111':'#999';ctx.font='bold 10px sans-serif';ctx.textAlign='center';
  ctx.fillText(label,x+21,y+15);
  if(!ready){const pct=1-cd/maxCd;ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x,y,42*pct,22,5);ctx.stroke();}
  ctx.restore();
}

function drawHUD() {
  const bw=230;
  drawBar(18,14,bw,20,p1.hp,p1.maxHp,`hsl(${(p1.hp/p1.maxHp)*120},80%,45%)`,`hsl(${(p1.hp/p1.maxHp)*120},90%,60%)`,p1.hpDisplay,p1.hpFlash);
  if (p1.hp < p1.maxHp * 0.20) {
    const a = 0.25 + Math.sin(_hudPulse * 0.18) * 0.20;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#ff2222';
    ctx.beginPath(); ctx.roundRect(18, 14, bw, 20, 5); ctx.fill(); ctx.restore();
  }
  drawBar(18,38,bw,10,p1.shield,MAX_SHIELD, p1.shieldBroken?'#ff3333':'#44aaff', p1.shieldBroken?'#ff6666':'#88ddff');
  if (p1.shieldBroken) { const a=0.4+Math.sin(Date.now()/50)*0.3; ctx.save();ctx.globalAlpha=a;ctx.fillStyle='#ff2200';ctx.beginPath();ctx.roundRect(18,38,bw,10,3);ctx.fill();ctx.restore(); }
  ctx.fillStyle='#fff';ctx.font='bold 12px sans-serif';ctx.textAlign='left';
  ctx.fillText(`${window.playerNames.p1}  ${Math.ceil(p1.hp)}`,26,27);
  drawCdBtn(18,52,'KICK',p1.kickCd,KICK_CD,'#ffaa00');
  drawCdBtn(65,52,'SUPER',p1.superCd,SUPER_CD,'#ff44ff');
  drawCdBtn(112,52,'DASH',p1.dashCd,DASH_CD,'#00ddff');
  drawBar(W-18-bw,14,bw,20,p2.hp,p2.maxHp,`hsl(${(p2.hp/p2.maxHp)*120},90%,60%)`,`hsl(${(p2.hp/p2.maxHp)*120},80%,45%)`,p2.hpDisplay,p2.hpFlash);
  if (p2.hp < p2.maxHp * 0.20) {
    const a = 0.25 + Math.sin(_hudPulse * 0.18 + 1) * 0.20;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#ff2222';
    ctx.beginPath(); ctx.roundRect(W-18-bw, 14, bw, 20, 5); ctx.fill(); ctx.restore();
  }
  drawBar(W-18-bw,38,bw,10,p2.shield,MAX_SHIELD, p2.shieldBroken?'#ff3333':'#88ddff', p2.shieldBroken?'#ff6666':'#44aaff');
  if (p2.shieldBroken) { const a=0.4+Math.sin(Date.now()/50)*0.3; ctx.save();ctx.globalAlpha=a;ctx.fillStyle='#ff2200';ctx.beginPath();ctx.roundRect(W-18-bw,38,bw,10,3);ctx.fill();ctx.restore(); }
  ctx.fillStyle='#fff';ctx.font='bold 12px sans-serif';ctx.textAlign='right';
  ctx.fillText(`${Math.ceil(p2.hp)}  ${window.playerNames.p2}`,W-26,27);
  ctx.textAlign='left';
  drawCdBtn(W-18-bw,52,'KICK',p2.kickCd,KICK_CD,'#ffaa00');
  drawCdBtn(W-18-bw+48,52,'SUPER',p2.superCd,SUPER_CD,'#ff44ff');
  drawCdBtn(W-18-bw+96,52,'DASH',p2.dashCd,DASH_CD,'#00ddff');
  ctx.fillStyle='#fff';ctx.font='bold 16px sans-serif';ctx.textAlign='center';
  ctx.fillText(`🥊  ROUND ${currentRound} / ${totalRounds}  🥊`,W/2,26);
  const remaining=Math.max(0,Math.ceil((ROUND_TIME-roundFrame)/60));
  ctx.fillStyle=remaining<=10?'#ff4444':'#fff'; ctx.font='bold 22px sans-serif';
  ctx.fillText(`${remaining}`,W/2,78);
  ctx.font='bold 12px sans-serif';
  ctx.textAlign='left';  ctx.fillStyle=p1.knockdowns>0?'#ff8800':'#444';
  ctx.fillText(`▼ ${p1.knockdowns}`,18,78);
  ctx.textAlign='right'; ctx.fillStyle=p2.knockdowns>0?'#ff8800':'#444';
  ctx.fillText(`▼ ${p2.knockdowns}`,W-18,78);
  for(let i=0;i<totalRounds;i++){
    const cx=W/2-(totalRounds*18)/2+i*18+9;
    ctx.beginPath();ctx.arc(cx,50,7,0,Math.PI*2);
    ctx.fillStyle=i<roundsWon[0]?'#4488ff':(totalRounds-1-i<roundsWon[1]?'#ff4444':'#333');
    ctx.fill();ctx.strokeStyle='#666';ctx.lineWidth=1;ctx.stroke();
  }
  // Mute + fullscreen buttons — bottom-right corner
  const muted = window.BGM?.muted;
  const isFS = !!document.fullscreenElement;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
  // Mute
  ctx.beginPath(); ctx.roundRect(W-54, H-26, 36, 20, 6); ctx.fill();
  ctx.fillStyle = muted ? '#666' : '#aaa';
  ctx.fillText(muted ? '🔇' : '🔊', W-36, H-13);
  // Fullscreen
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.roundRect(W-96, H-26, 36, 20, 6); ctx.fill();
  ctx.fillStyle = '#aaa';
  ctx.fillText(isFS ? '⛶' : '⛶', W-78, H-13);
  ctx.restore();
  ctx.textAlign='left';
}

function drawCombos() {
  for (const p of [p1, p2]) {
    if (p.combo < 2 || p.comboTimer <= 0) continue;
    const s    = depthToScale(p.depth);
    const sx   = p.x + p.dir * 48 * s;
    const sy   = fighterScreenY(p) - 108 * s;
    const fade = Math.min(1, p.comboTimer / 25);          // fade out in last 25 frames
    const pulse = 1 + Math.sin(Date.now() / 70) * 0.06;  // subtle bounce
    const col  = p.combo >= 6 ? '#ffd700' : p.combo >= 4 ? '#ff4444' : '#ff8800';
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';
    // Big number
    ctx.font = `bold ${Math.round(42 * pulse)}px sans-serif`;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
    ctx.strokeText(String(p.combo), sx, sy);
    ctx.fillStyle = col;
    ctx.fillText(String(p.combo), sx, sy);
    // Small "HIT" label
    ctx.font = 'bold 13px sans-serif';
    ctx.lineWidth = 4;
    ctx.strokeText('HIT', sx, sy + 17);
    ctx.fillStyle = '#fff';
    ctx.fillText('HIT', sx, sy + 17);
    ctx.restore();
  }
}

function drawKnockdownCount() {
  for (const p of [p1, p2]) {
    if (!p.knockdown) continue;
    const t = p.knockdownT;
    if (t < KD_FALL || t >= KD_FALL + KD_DOWN) continue;
    const countFrame = t - KD_FALL;
    const count = Math.min(8, Math.floor(countFrame / 15) + 1);
    const sx = p.x;
    const sy = fighterScreenY(p) - 96 * depthToScale(p.depth);
    const pulse = 1 + Math.sin(countFrame * 0.35) * 0.08;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.round(52 * pulse)}px sans-serif`;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 7;
    ctx.strokeText(String(count), sx, sy);
    ctx.fillStyle = '#ffe44d';
    ctx.fillText(String(count), sx, sy);
    ctx.restore();
  }
}

function drawFloaties(){
  for(const f of floaties){
    const alpha = Math.max(0, 1-f.t/55);
    ctx.save(); ctx.globalAlpha = alpha;
    if (f.star) {
      // Draw starburst impact star
      const r1 = (f.size * 0.5) * (1 + f.t * 0.04);
      const r2 = r1 * 0.42;
      const spikes = 8;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.t * 0.08);
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const r = i % 2 === 0 ? r1 : r2;
        i === 0 ? ctx.moveTo(Math.cos(angle)*r, Math.sin(angle)*r) : ctx.lineTo(Math.cos(angle)*r, Math.sin(angle)*r);
      }
      ctx.closePath();
      ctx.fillStyle = f.col; ctx.fill();
      ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 3; ctx.stroke();
    } else {
      ctx.fillStyle=f.col; ctx.strokeStyle='#000'; ctx.lineWidth=3;
      ctx.font=`bold ${f.size-f.t*0.1}px sans-serif`; ctx.textAlign='center';
      ctx.strokeText(f.txt,f.x,f.y); ctx.fillText(f.txt,f.x,f.y);
    }
    ctx.restore();
  }
}

// ── Character select ─────────────────────────────────────────────────────────
function _drawCharPreview(cx, cy, char) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.62, 0.62);
  const col = char.color, dark = char.dark;

  // Arm (left, idle)
  ctx.beginPath(); ctx.moveTo(-12, -35);
  ctx.bezierCurveTo(-22, -50, -34, -28, -28, -35);
  ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.stroke();
  ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(-28, -35, 14, 0, Math.PI*2);
  ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();

  // Body
  ctx.beginPath(); ctx.ellipse(0, -10, 24, 34, 0, 0, Math.PI*2);
  ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = dark; ctx.fillRect(-22, 5, 44, 8);
  ctx.fillStyle = '#ffdd00'; ctx.fillRect(-6, 4, 12, 10);

  // Hips + legs
  ctx.beginPath(); ctx.ellipse(0, 20, 20, 14, 0, 0, Math.PI*2); ctx.fillStyle = dark; ctx.fill();
  ctx.fillStyle = '#ffcc99'; ctx.fillRect(-14, 28, 10, 22); ctx.fillRect(4, 28, 10, 22);
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.ellipse(-9, 52, 10, 6, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(9, 52, 10, 6, 0, 0, Math.PI*2); ctx.fill();

  // Head
  ctx.beginPath(); ctx.arc(0, -58, 24, 0, Math.PI*2);
  ctx.fillStyle = '#ffcc99'; ctx.fill(); ctx.strokeStyle = '#cc9966'; ctx.lineWidth = 2; ctx.stroke();
  // Cap
  ctx.beginPath(); ctx.arc(0, -62, 26, Math.PI*1.1, Math.PI*1.9);
  ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-26, -58); ctx.lineTo(-22, -36);
  ctx.moveTo(26, -58); ctx.lineTo(22, -36);
  ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke();

  // Eyes + smile
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(-7, -61, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(7, -61, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-5, -62, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(9, -62, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#883300'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, -55, 5, 0, Math.PI, true); ctx.stroke();

  ctx.restore();
}

function drawCharSelect() {
  ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fillRect(0, 0, W, H);
  ctx.save();

  // Title
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px sans-serif';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
  ctx.strokeText('SELECT  YOUR  FIGHTER', W/2, 56);
  ctx.fillStyle = '#ffe44d'; ctx.fillText('SELECT  YOUR  FIGHTER', W/2, 56);

  ctx.font = '11px sans-serif'; ctx.fillStyle = '#444';
  if (cpuDifficulty !== 'off') {
    ctx.fillText('A / D  navigate  ·  F  confirm  ·  ← / →  pick CPU fighter', W/2, 74);
  } else {
    ctx.fillText('P1: A / D  navigate  ·  F  confirm          P2: ← / →  navigate  ·  L  confirm', W/2, 74);
  }

  const CW = 158, CH = 285, GAP = 12;
  const totalW = CHARACTERS.length * CW + (CHARACTERS.length - 1) * GAP;
  const startX = (W - totalW) / 2;
  const cardY = 88;

  for (let i = 0; i < CHARACTERS.length; i++) {
    const ch = CHARACTERS[i];
    const cx = startX + i * (CW + GAP);
    const isP1 = p1CharIdx === i;
    const isP2 = p2CharIdx === i;

    // Card bg
    ctx.fillStyle = (isP1 || isP2) ? 'rgba(22,26,42,0.98)' : 'rgba(14,16,26,0.95)';
    ctx.beginPath(); ctx.roundRect(cx, cardY, CW, CH, 12); ctx.fill();

    // Border
    if (isP1 && isP2) {
      ctx.strokeStyle = '#4488ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(cx, cardY, CW, CH, 12); ctx.stroke();
      ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 3; ctx.setLineDash([9, 9]);
      ctx.beginPath(); ctx.roundRect(cx, cardY, CW, CH, 12); ctx.stroke();
      ctx.setLineDash([]);
    } else if (isP1) {
      const alpha = p1Confirmed ? 1 : 0.65;
      ctx.shadowColor = `rgba(68,136,255,${alpha})`; ctx.shadowBlur = p1Confirmed ? 16 : 8;
      ctx.strokeStyle = `rgba(68,136,255,${alpha})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(cx, cardY, CW, CH, 12); ctx.stroke();
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    } else if (isP2) {
      const alpha = p2Confirmed ? 1 : 0.65;
      ctx.shadowColor = `rgba(255,68,68,${alpha})`; ctx.shadowBlur = p2Confirmed ? 16 : 8;
      ctx.strokeStyle = `rgba(255,68,68,${alpha})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(cx, cardY, CW, CH, 12); ctx.stroke();
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(cx, cardY, CW, CH, 12); ctx.stroke();
    }

    // Fighter preview
    _drawCharPreview(cx + CW/2, cardY + 112, ch);

    // Name
    ctx.font = `bold 15px sans-serif`; ctx.fillStyle = ch.color; ctx.textAlign = 'center';
    ctx.fillText(ch.name, cx + CW/2, cardY + 184);

    // Class
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#555';
    ctx.fillText(ch.cls, cx + CW/2, cardY + 198);

    // Stat bars (SPEED, POWER, HP)
    const statLabels = ['SPEED', 'POWER', 'HP'];
    const statColors = ['#00ddff', '#ff6644', '#44dd88'];
    for (let s = 0; s < 3; s++) {
      const sy = cardY + 212 + s * 22;
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'left';
      ctx.fillText(statLabels[s], cx + 13, sy + 10);
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.roundRect(cx + 52, sy, 90, 12, 3); ctx.fill();
      ctx.fillStyle = statColors[s];
      ctx.beginPath(); ctx.roundRect(cx + 52, sy, Math.round(90 * ch.stats[s] / 5), 12, 3); ctx.fill();
    }

    // Confirmed badges
    if (isP1 && p1Confirmed) {
      ctx.fillStyle = 'rgba(68,136,255,0.90)';
      ctx.beginPath(); ctx.roundRect(cx + 4, cardY + 4, 46, 18, 5); ctx.fill();
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText('✓ P1', cx + 27, cardY + 16);
    }
    if (isP2 && p2Confirmed) {
      const badge = cpuDifficulty !== 'off' ? 'CPU ✓' : 'P2 ✓';
      ctx.fillStyle = cpuDifficulty !== 'off' ? 'rgba(100,200,100,0.90)' : 'rgba(255,68,68,0.90)';
      ctx.beginPath(); ctx.roundRect(cx + CW - 50, cardY + 4, 46, 18, 5); ctx.fill();
      ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText(badge, cx + CW - 27, cardY + 16);
    }
  }

  const _cpuColors = { off:'#444', easy:'#44dd88', medium:'#ffaa00', hard:'#ff4444' };

  if (cpuDifficulty !== 'off' && isArcade) {
    // ── Arcade: show opponent info instead of difficulty buttons ──
    const opp = ARCADE_OPPONENTS[arcadeIdx];
    const diffColor = { easy: '#44dd88', medium: '#ffe44d', hard: '#ff5555' }[opp.difficulty];
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#555';
    ctx.fillText('ARCADE  •  ' + opp.title.toUpperCase() + '  •  VS  ' + opp.name, W/2, H - 62);
    ctx.font = '10px sans-serif'; ctx.fillStyle = diffColor;
    ctx.fillText(opp.difficulty.toUpperCase() + '  difficulty', W/2, H - 48);
  } else if (cpuDifficulty !== 'off') {
    // ── Prominent 3-button difficulty row (VS AI mode) ──
    const diffLevels = ['easy', 'medium', 'hard'];
    const diffLabels = ['🟢 EASY', '🟡 MEDIUM', '🔴 HARD'];
    const diffBtnW = 130, diffBtnH = 34, diffGap = 14;
    const diffTotalW = diffLevels.length * diffBtnW + (diffLevels.length - 1) * diffGap;
    const diffStartX = (W - diffTotalW) / 2;
    const diffY = H - 58;
    ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    ctx.fillText('DIFFICULTY', W/2, diffY - 6);
    diffLevels.forEach((lvl, i) => {
      const bx = diffStartX + i * (diffBtnW + diffGap);
      const active = cpuDifficulty === lvl;
      ctx.fillStyle = active ? (lvl==='easy'?'rgba(0,120,60,0.55)' : lvl==='medium'?'rgba(120,80,0,0.55)' : 'rgba(120,20,20,0.55)') : 'rgba(20,20,30,0.70)';
      ctx.beginPath(); ctx.roundRect(bx, diffY, diffBtnW, diffBtnH, 8); ctx.fill();
      ctx.strokeStyle = active ? _cpuColors[lvl] : 'rgba(255,255,255,0.08)'; ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(bx, diffY, diffBtnW, diffBtnH, 8); ctx.stroke();
      ctx.fillStyle = active ? _cpuColors[lvl] : '#444';
      ctx.font = `bold ${active ? 13 : 12}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(diffLabels[i], bx + diffBtnW/2, diffY + diffBtnH/2 + 5);
    });
  } else {
    // ── Small C key toggle (2P mode) ──
    const _cpuBgAlpha = { off:'rgba(40,40,40,0.60)', easy:'rgba(0,80,40,0.30)', medium:'rgba(80,50,0,0.30)', hard:'rgba(80,10,10,0.30)' };
    const _cpuLabels = { off:'🤖 CPU: OFF', easy:'🤖 EASY', medium:'🤖 MEDIUM', hard:'🤖 HARD' };
    const cpuBtnX = W - 116, cpuBtnY = H - 54, cpuBtnW = 108, cpuBtnH = 26;
    ctx.fillStyle = _cpuBgAlpha[cpuDifficulty];
    ctx.beginPath(); ctx.roundRect(cpuBtnX, cpuBtnY, cpuBtnW, cpuBtnH, 8); ctx.fill();
    ctx.strokeStyle = _cpuColors[cpuDifficulty]; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(cpuBtnX, cpuBtnY, cpuBtnW, cpuBtnH, 8); ctx.stroke();
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = _cpuColors[cpuDifficulty];
    ctx.fillText(_cpuLabels[cpuDifficulty] + '  [C]', cpuBtnX + cpuBtnW/2, cpuBtnY + 17);
  }

  // Bottom status
  if (p1Confirmed && p2Confirmed) {
    ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
    ctx.strokeText('FIGHT!', W/2, H - 22);
    ctx.fillStyle = '#ffe44d'; ctx.fillText('FIGHT!', W/2, H - 22);
  } else {
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = p1Confirmed ? '#4488ff' : '#555';
    ctx.fillText(p1Confirmed ? `✓ P1  ${CHARACTERS[p1CharIdx].name}` : 'P1: pick a fighter', 26, H - 22);
    ctx.textAlign = 'right';
    if (cpuDifficulty !== 'off') {
      ctx.fillStyle = _cpuColors[cpuDifficulty];
      ctx.fillText(`🤖 CPU  ${CHARACTERS[p2CharIdx].name}`, W - 26, H - 22);
    } else {
      ctx.fillStyle = p2Confirmed ? '#ff4444' : '#555';
      ctx.fillText(p2Confirmed ? `P2  ${CHARACTERS[p2CharIdx].name}  ✓` : 'P2: pick a fighter', W - 26, H - 22);
    }
  }

  ctx.restore();
}

// ── Menu ──────────────────────────────────────────────────────────────────────
let menuSelected = 3;
function drawMenu() {
  ctx.fillStyle='rgba(0,0,0,0.92)';ctx.fillRect(0,0,W,H);
  ctx.save();ctx.textAlign='center';
  ctx.font='bold 52px sans-serif';ctx.fillStyle='#ffe44d';
  ctx.fillText('🥊  FUNNY BOXING  🥊',W/2,120);
  ctx.font='18px sans-serif';ctx.fillStyle='#aaa';
  ctx.fillText('Choose number of rounds',W/2,180);
  const opts=[1,3,5];
  opts.forEach((r,i)=>{
    const bx=W/2-130+i*110,by=205,bw=90,bh=50;
    const active=r===menuSelected;
    ctx.fillStyle=active?'#ffe44d':'#2a2a2a';
    ctx.beginPath();ctx.roundRect(bx,by,bw,bh,10);ctx.fill();
    ctx.strokeStyle=active?'#ffe44d':'#555';ctx.lineWidth=active?3:1;
    ctx.beginPath();ctx.roundRect(bx,by,bw,bh,10);ctx.stroke();
    ctx.fillStyle=active?'#111':'#ccc';
    ctx.font='bold 26px sans-serif';ctx.textAlign='center';
    ctx.fillText(r,bx+bw/2,by+bh/2+9);
  });
  ctx.font='13px sans-serif';ctx.fillStyle='#666';
  opts.forEach((r,i)=>{ const bx=W/2-130+i*110; ctx.fillText(r===1?'Quick':'Best of '+r,bx+45,275); });
  ctx.fillStyle='#ffe44d';ctx.beginPath();ctx.roundRect(W/2-100,290,200,40,12);ctx.fill();
  ctx.fillStyle='#111';ctx.font='bold 20px sans-serif';ctx.textAlign='center';
  ctx.fillText('START FIGHT',W/2,316);
  ctx.fillStyle='rgba(255,160,40,0.18)';ctx.beginPath();ctx.roundRect(W/2-100,338,200,34,12);ctx.fill();
  ctx.strokeStyle='#ff9922';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(W/2-100,338,200,34,12);ctx.stroke();
  ctx.fillStyle='#ff9922';ctx.font='bold 15px sans-serif';ctx.textAlign='center';
  ctx.fillText('🏆 Arcade Mode',W/2,361);
  ctx.fillStyle='rgba(68,180,255,0.15)';ctx.beginPath();ctx.roundRect(W/2-100,380,200,32,12);ctx.fill();
  ctx.strokeStyle='#44aaff';ctx.lineWidth=1.5;ctx.beginPath();ctx.roundRect(W/2-100,380,200,32,12);ctx.stroke();
  ctx.fillStyle='#44aaff';ctx.font='bold 14px sans-serif';ctx.textAlign='center';
  ctx.fillText('🤖 Practice vs AI',W/2,402);
  // Win streak
  if (bestStreak > 0) {
    const streakY = 422;
    ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = winStreak > 0 ? '#ffe44d' : '#555';
    ctx.fillText(`🔥 Streak: ${winStreak}`, W/2 - 80, streakY);
    ctx.fillStyle = '#888';
    ctx.fillText(`🏆 Best: ${bestStreak}`, W/2 + 70, streakY);
  }

  // STATS button
  const sbx = W/2-52, sby = 434, sbw = 104, sbh = 24;
  const played = statWins + statLosses + statDraws;
  ctx.fillStyle = 'rgba(40,40,50,0.85)';
  ctx.beginPath(); ctx.roundRect(sbx, sby, sbw, sbh, 7); ctx.fill();
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(sbx, sby, sbw, sbh, 7); ctx.stroke();
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#888';
  ctx.fillText(played > 0 ? `📊 STATS  (${played} played)` : '📊 STATS', W/2, sby + 17);

  ctx.restore();
}

function drawStats() {
  ctx.fillStyle = 'rgba(0,0,0,0.92)'; ctx.fillRect(0, 0, W, H);
  ctx.save();

  const CX = W/2, CW = 640, CH = 400, top = H/2 - CH/2 - 8;
  ctx.fillStyle = 'rgba(12,14,22,0.97)';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(CX-CW/2, top, CW, CH, 14); ctx.fill(); ctx.stroke();

  const L = CX - 290, R = CX + 290;
  ctx.textAlign = 'center';

  // Title
  ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#ffe44d';
  ctx.fillText('PLAYER  STATS', CX, top + 34);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, top+46); ctx.lineTo(R, top+46); ctx.stroke();

  const played = statWins + statLosses + statDraws;
  const winRate = played > 0 ? Math.round(statWins / played * 100) : 0;

  // W / L / D row
  let cx2 = CX - 180;
  for (const [lbl, val, col] of [
    ['WINS', statWins, '#44dd88'], ['LOSSES', statLosses, '#ff5555'], ['DRAWS', statDraws, '#aaa'], ['WIN RATE', winRate+'%', '#ffe44d']
  ]) {
    ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'center';
    ctx.fillText(val, cx2, top + 88);
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#555';
    ctx.fillText(lbl, cx2, top + 103);
    cx2 += 120;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, top+114); ctx.lineTo(R, top+114); ctx.stroke();

  // Streak row
  let sy = top + 136;
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
  ctx.fillText('STREAK', CX - 100, sy); ctx.fillText('BEST STREAK', CX + 100, sy);
  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = winStreak > 0 ? '#ffe44d' : '#666'; ctx.fillText(winStreak, CX - 100, sy + 26);
  ctx.fillStyle = '#aaa'; ctx.fillText(bestStreak, CX + 100, sy + 26);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  sy += 42;
  ctx.beginPath(); ctx.moveTo(L, sy); ctx.lineTo(R, sy); ctx.stroke();
  sy += 16;

  // Combat records
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#444'; ctx.textAlign = 'center';
  ctx.fillText('COMBAT  RECORDS', CX, sy);
  sy += 18;
  const combatRows = [
    ['Best Combo', statBestCombo >= 2 ? statBestCombo + ' HIT' : '—',
      statBestCombo >= 6 ? '#ffd700' : statBestCombo >= 3 ? '#ff8800' : '#ccc'],
    ['Total Knockdowns Dealt', statKOs > 0 ? String(statKOs) : '—', '#ff8800'],
    ['Total Damage Dealt',     statDmg > 0 ? statDmg.toLocaleString() : '—', '#ccc'],
  ];
  for (const [lbl, val, col] of combatRows) {
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'left';
    ctx.fillText(lbl, L, sy);
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'right';
    ctx.fillText(val, R, sy);
    sy += 22;
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, sy+2); ctx.lineTo(R, sy+2); ctx.stroke();
  sy += 18;

  // Per-character wins
  ctx.font = '10px sans-serif'; ctx.fillStyle = '#444'; ctx.textAlign = 'center';
  ctx.fillText('WINS  BY  CHARACTER', CX, sy);
  sy += 16;
  const maxCharWin = Math.max(1, ...CHARACTERS.map(c => statCharWins[c.name] || 0));
  for (const ch of CHARACTERS) {
    const wins = statCharWins[ch.name] || 0;
    const bx = CX - 80, bw = 160, bh = 10;
    ctx.font = '10px sans-serif'; ctx.fillStyle = ch.color; ctx.textAlign = 'right';
    ctx.fillText(ch.name, CX - 86, sy + 8);
    ctx.fillStyle = '#1a1a2a';
    ctx.beginPath(); ctx.roundRect(bx, sy, bw, bh, 3); ctx.fill();
    if (wins > 0) {
      ctx.fillStyle = ch.color;
      ctx.beginPath(); ctx.roundRect(bx, sy, Math.round(bw * wins / maxCharWin), bh, 3); ctx.fill();
    }
    ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = wins > 0 ? ch.color : '#444'; ctx.textAlign = 'left';
    ctx.fillText(wins + 'W', CX + 86, sy + 8);
    sy += 18;
  }

  // Close hint
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#444'; ctx.textAlign = 'center';
  ctx.fillText('ESC or click to close  ·  TAB for achievements', CX, top + CH - 14);

  ctx.restore();
}

function drawRoundEnd() {
  const needed    = Math.ceil(totalRounds / 2);
  const matchOver = roundsWon[0]>=needed || roundsWon[1]>=needed || currentRound>=totalRounds;

  ctx.fillStyle = 'rgba(0,0,0,0.80)';
  ctx.fillRect(0, 0, W, H);
  ctx.save();

  // ── Card ──────────────────────────────────────────────────────────────────
  const CX = W/2, CY = H/2 + 5, CW = 610, CH = 375;
  const top = CY - CH/2, L = CX - 270, R = CX + 270;
  ctx.fillStyle = 'rgba(12,14,22,0.97)';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(CX-CW/2, top, CW, CH, 14); ctx.fill(); ctx.stroke();

  ctx.textAlign = 'center';

  // Round label
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#666';
  ctx.fillText(`ROUND  ${currentRound} / ${totalRounds}`, CX, top+26);

  // Winner banner
  const winCol = !roundStats ? '#ffe44d'
    : roundStats.winner===0 ? '#4488ff' : roundStats.winner===1 ? '#ff4444' : '#ffe44d';
  ctx.font = 'bold 24px sans-serif';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
  ctx.strokeText(roundEndMsg, CX, top+54);
  ctx.fillStyle = winCol; ctx.fillText(roundEndMsg, CX, top+54);

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, top+66); ctx.lineTo(R, top+66); ctx.stroke();

  if (roundStats) {
    const st = roundStats;

    // Column headers
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';  ctx.fillStyle = '#4488ff'; ctx.fillText(window.playerNames.p1, L, top+86);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff4444'; ctx.fillText(window.playerNames.p2, R, top+86);

    // HP bars — P1 left→right, P2 right→left (mirror)
    const bary = top+96, barh = 15, barw = 220;
    const drawHpBar = (bx, val, maxHp, flip) => {
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.roundRect(bx, bary, barw, barh, 3); ctx.fill();
      const fw = Math.max(0, (val/maxHp)*barw);
      if (fw > 0) {
        const hsl = `hsl(${(val/maxHp)*120},80%,45%)`;
        ctx.fillStyle = hsl;
        ctx.beginPath(); ctx.roundRect(flip ? bx+barw-fw : bx, bary, fw, barh, 3); ctx.fill();
      }
      ctx.strokeStyle='#fff2'; ctx.lineWidth=1; ctx.beginPath(); ctx.roundRect(bx, bary, barw, barh, 3); ctx.stroke();
    };
    drawHpBar(L, st.p1.hp, st.p1.maxHp ?? MAX_HP, false);
    drawHpBar(R-barw, st.p2.hp, st.p2.maxHp ?? MAX_HP, true);

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';  ctx.fillStyle = '#999'; ctx.fillText(`${Math.ceil(st.p1.hp)} HP`, L, bary+barh+13);
    ctx.textAlign = 'right'; ctx.fillStyle = '#999'; ctx.fillText(`${Math.ceil(st.p2.hp)} HP`, R, bary+barh+13);

    // Stat rows: value  |  label  |  value
    const rows = [
      { label: 'Knockdowns',
        p1v: `▼ ${st.p1.knockdowns}`, p2v: `▼ ${st.p2.knockdowns}`,
        p1c: st.p1.knockdowns > 0 ? '#ff8800' : '#555',
        p2c: st.p2.knockdowns > 0 ? '#ff8800' : '#555' },
      { label: 'Best Combo',
        p1v: st.p1.maxCombo >= 2 ? `${st.p1.maxCombo} HIT` : '—',
        p2v: st.p2.maxCombo >= 2 ? `${st.p2.maxCombo} HIT` : '—',
        p1c: st.p1.maxCombo >= 6 ? '#ffd700' : st.p1.maxCombo >= 4 ? '#ff4444' : st.p1.maxCombo >= 2 ? '#ff8800' : '#555',
        p2c: st.p2.maxCombo >= 6 ? '#ffd700' : st.p2.maxCombo >= 4 ? '#ff4444' : st.p2.maxCombo >= 2 ? '#ff8800' : '#555' },
      { label: 'Damage Dealt',
        p1v: String(st.p1.dmgDealt), p2v: String(st.p2.dmgDealt),
        p1c: '#ccc', p2c: '#ccc' },
    ];

    let ry = top + 155;
    for (const row of rows) {
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
      ctx.fillText(row.label, CX, ry);
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'left';  ctx.fillStyle = row.p1c; ctx.fillText(row.p1v, L, ry);
      ctx.textAlign = 'right'; ctx.fillStyle = row.p2c; ctx.fillText(row.p2v, R, ry);
      ry += 30;
    }

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, ry+4); ctx.lineTo(R, ry+4); ctx.stroke();
    ry += 20;

    // Round win pips
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    ctx.fillText('ROUND WINS', CX, ry);
    ry += 17;
    for (let i = 0; i < totalRounds; i++) {
      const px = CX - (totalRounds*20)/2 + i*20 + 10;
      ctx.beginPath(); ctx.arc(px, ry, 7, 0, Math.PI*2);
      ctx.fillStyle = i<roundsWon[0] ? '#4488ff' : totalRounds-1-i<roundsWon[1] ? '#ff4444' : '#252530';
      ctx.fill(); ctx.strokeStyle='#444'; ctx.lineWidth=1; ctx.stroke();
    }
    ry += 26;

    // Prompt
    const prompt = (!matchOver && roundEndTimer > 0)
      ? `Next round in ${Math.ceil(roundEndTimer/60)}…`
      : 'Press  SPACE  or tap to continue';
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#666'; ctx.textAlign = 'center';
    ctx.fillText(prompt, CX, ry);
  }

  ctx.restore();
}

function drawGameOver() {
  const needed = Math.ceil(totalRounds / 2);
  let titleText, titleCol;
  if (roundsWon[0] >= needed) {
    titleText = `${window.playerNames.p1.toUpperCase()}  IS  CHAMPION!`;
    titleCol  = '#4488ff';
  } else if (roundsWon[1] >= needed) {
    titleText = `${window.playerNames.p2.toUpperCase()}  IS  CHAMPION!`;
    titleCol  = '#ff4444';
  } else {
    titleText = "IT'S  A  DRAW!";
    titleCol  = '#ffe44d';
  }

  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.save();

  // ── Card ─────────────────────────────────────────────────────────────────
  const CX = W/2, CW = 640, CH = 432, top = H/2 - CH/2 - 10;
  const L = CX - 290, R = CX + 290;
  ctx.fillStyle = 'rgba(12,14,22,0.97)';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(CX-CW/2, top, CW, CH, 14); ctx.fill(); ctx.stroke();

  ctx.textAlign = 'center';

  // Score label / arcade progress
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#555';
  if (isArcade) {
    ctx.fillText(`ARCADE  •  ${ARCADE_OPPONENTS[arcadeIdx].title.toUpperCase()}`, CX, top + 26);
  } else {
    ctx.fillText(`${roundsWon[0]}  —  ${roundsWon[1]}`, CX, top + 26);
  }

  // Champion title
  ctx.font = 'bold 24px sans-serif';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
  ctx.strokeText(titleText, CX, top + 56);
  ctx.fillStyle = titleCol; ctx.fillText(titleText, CX, top + 56);

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, top + 68); ctx.lineTo(R, top + 68); ctx.stroke();

  if (roundStats) {
    const st = roundStats;

    // Column headers
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';  ctx.fillStyle = '#4488ff'; ctx.fillText(window.playerNames.p1, L, top + 88);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ff4444'; ctx.fillText(window.playerNames.p2, R, top + 88);

    // HP bars
    const bary = top + 98, barh = 15, barw = 245;
    const drawHpBar = (bx, val, maxHp, flip) => {
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.roundRect(bx, bary, barw, barh, 3); ctx.fill();
      const fw = Math.max(0, (val / maxHp) * barw);
      if (fw > 0) {
        ctx.fillStyle = `hsl(${(val/maxHp)*120},80%,45%)`;
        ctx.beginPath(); ctx.roundRect(flip ? bx+barw-fw : bx, bary, fw, barh, 3); ctx.fill();
      }
      ctx.strokeStyle = '#fff2'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, bary, barw, barh, 3); ctx.stroke();
    };
    drawHpBar(L, st.p1.hp, st.p1.maxHp ?? MAX_HP, false);
    drawHpBar(R - barw, st.p2.hp, st.p2.maxHp ?? MAX_HP, true);

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';  ctx.fillStyle = '#999'; ctx.fillText(`${Math.ceil(st.p1.hp)} HP`, L, bary + barh + 13);
    ctx.textAlign = 'right'; ctx.fillStyle = '#999'; ctx.fillText(`${Math.ceil(st.p2.hp)} HP`, R, bary + barh + 13);

    // Stat rows
    const rows = [
      { label: 'Knockdowns',
        p1v: `▼ ${st.p1.knockdowns}`, p2v: `▼ ${st.p2.knockdowns}`,
        p1c: st.p1.knockdowns > 0 ? '#ff8800' : '#555',
        p2c: st.p2.knockdowns > 0 ? '#ff8800' : '#555' },
      { label: 'Best Combo',
        p1v: st.p1.maxCombo >= 2 ? `${st.p1.maxCombo} HIT` : '—',
        p2v: st.p2.maxCombo >= 2 ? `${st.p2.maxCombo} HIT` : '—',
        p1c: st.p1.maxCombo >= 6 ? '#ffd700' : st.p1.maxCombo >= 4 ? '#ff4444' : st.p1.maxCombo >= 2 ? '#ff8800' : '#555',
        p2c: st.p2.maxCombo >= 6 ? '#ffd700' : st.p2.maxCombo >= 4 ? '#ff4444' : st.p2.maxCombo >= 2 ? '#ff8800' : '#555' },
      { label: 'Damage Dealt',
        p1v: String(st.p1.dmgDealt), p2v: String(st.p2.dmgDealt),
        p1c: '#ccc', p2c: '#ccc' },
    ];

    let ry = top + 158;
    for (const row of rows) {
      ctx.font = '10px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
      ctx.fillText(row.label, CX, ry);
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'left';  ctx.fillStyle = row.p1c; ctx.fillText(row.p1v, L, ry);
      ctx.textAlign = 'right'; ctx.fillStyle = row.p2c; ctx.fillText(row.p2v, R, ry);
      ry += 30;
    }

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, ry + 4); ctx.lineTo(R, ry + 4); ctx.stroke();
    ry += 20;

    // Round win pips
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    ctx.fillText('ROUND WINS', CX, ry);
    ry += 17;
    for (let i = 0; i < totalRounds; i++) {
      const px = CX - (totalRounds * 20) / 2 + i * 20 + 10;
      ctx.beginPath(); ctx.arc(px, ry, 7, 0, Math.PI * 2);
      ctx.fillStyle = i < roundsWon[0] ? '#4488ff' : totalRounds-1-i < roundsWon[1] ? '#ff4444' : '#252530';
      ctx.fill(); ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.stroke();
    }
    ry += 26;

    // Win streak
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    if (_streakNewBest && winStreak > 1) {
      ctx.fillStyle = '#ffd700';
      ctx.fillText(`🏆 NEW BEST STREAK!  ${winStreak} in a row`, CX, ry);
    } else if (winStreak > 1) {
      ctx.fillStyle = '#ffe44d';
      ctx.fillText(`🔥 Win streak: ${winStreak}  (best: ${bestStreak})`, CX, ry);
    } else if (winStreak === 1) {
      ctx.fillStyle = '#888';
      ctx.fillText(`Win streak: 1  (best: ${bestStreak})`, CX, ry);
    } else if (bestStreak > 0) {
      ctx.fillStyle = '#555';
      ctx.fillText(`Streak lost  (best: ${bestStreak})`, CX, ry);
    }
    ry += 22;

    // Rematch button (online mode)
    if (window.netIsOnline?.()) {
      const rbx = CX - 70, rby = ry, rbw = 140, rbh = 32;
      const rReady = _rematchLocal;
      ctx.fillStyle = rReady ? 'rgba(68,255,136,0.18)' : 'rgba(255,228,77,0.10)';
      ctx.beginPath(); ctx.roundRect(rbx, rby, rbw, rbh, 8); ctx.fill();
      ctx.strokeStyle = rReady ? '#44ff88' : '#ffe44d'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(rbx, rby, rbw, rbh, 8); ctx.stroke();
      ctx.fillStyle = rReady ? '#44ff88' : '#ffe44d';
      ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(rReady ? (_rematchOpp ? '🔄 Starting…' : '⏳ Waiting…') : '🔄 Rematch?', CX, rby + 21);
      ry += 40;
    }

    // Prompt
    ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    if (!window.netIsOnline?.()) {
      const needed = Math.ceil(totalRounds / 2);
      const p1Won = roundsWon[0] >= needed;
      if (isArcade && p1Won) {
        const nextOpp = ARCADE_OPPONENTS[arcadeIdx + 1];
        ctx.fillStyle = '#44dd88';
        ctx.fillText(nextOpp ? 'SPACE  →  Next:  ' + nextOpp.name : 'SPACE  →  Claim your trophy!', CX, ry);
      } else if (isArcade && !p1Won) {
        ctx.fillStyle = '#ff8844';
        ctx.fillText('SPACE  →  Return to menu', CX, ry);
      } else {
        ctx.fillStyle = '#666';
        ctx.fillText('Press  SPACE  or tap to play again', CX, ry);
      }
    }
  } else {
    // Fallback if roundStats not available
    ctx.font = '14px sans-serif'; ctx.fillStyle = '#666'; ctx.textAlign = 'center';
    ctx.fillText('Press  SPACE  or tap to play again', CX, top + CH - 28);
  }

  ctx.restore();
}

function drawArcadeVS() {
  const opp = ARCADE_OPPONENTS[arcadeIdx];
  const p1Char = CHARACTERS[p1CharIdx];
  const p2Char = CHARACTERS[opp.charIdx];
  const secs = Math.max(1, Math.ceil(arcadeVSTimer / 60));

  ctx.fillStyle = '#08020c';
  ctx.fillRect(0, 0, W, H);

  const lg = ctx.createRadialGradient(W*0.24, H/2, 0, W*0.24, H/2, 280);
  lg.addColorStop(0, p1Char.color + '38'); lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W*0.76, H/2, 0, W*0.76, H/2, 280);
  rg.addColorStop(0, p2Char.color + '38'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.textAlign = 'center';
  const diffColor = { easy: '#44dd88', medium: '#ffe44d', hard: '#ff5555' }[opp.difficulty];
  ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#444';
  ctx.fillText('ARCADE  MODE', W/2, 26);
  ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = diffColor;
  ctx.fillText(opp.title.toUpperCase(), W/2, 48);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 56); ctx.lineTo(W, 56); ctx.stroke();

  // P1 side
  ctx.textAlign = 'left';
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = p1Char.color;
  ctx.fillText(window.playerNames.p1 || 'P1', 44, 96);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#555';
  ctx.fillText(p1Char.name + '  •  ' + p1Char.cls, 44, 112);
  _drawCharPreview(W * 0.22, H/2 + 32, p1Char);

  // VS
  ctx.textAlign = 'center';
  ctx.font = 'bold 64px sans-serif';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 8;
  ctx.strokeText('VS', W/2, H/2 + 22);
  ctx.fillStyle = '#ffe44d';
  ctx.fillText('VS', W/2, H/2 + 22);

  // Opponent side
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = p2Char.color;
  ctx.fillText(opp.name, W - 44, 96);
  ctx.font = '11px sans-serif'; ctx.fillStyle = '#555';
  ctx.fillText(opp.difficulty.toUpperCase() + '  •  ' + p2Char.name + '  •  ' + p2Char.cls, W - 44, 112);

  // Mirror P2 character (faces left toward P1)
  ctx.save();
  ctx.translate(W * 0.76 * 2, 0);
  ctx.scale(-1, 1);
  _drawCharPreview(W * 0.76, H/2 + 32, p2Char);
  ctx.restore();

  // Countdown prompt
  ctx.textAlign = 'center';
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#3a3a3a';
  ctx.fillText('Starting in  ' + secs + '...', W/2, H - 18);

  ctx.restore();
}

function drawArcadeOver() {
  const CX = W / 2;
  ctx.fillStyle = '#080004'; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(CX, H / 2, 10, CX, H / 2, 320);
  vg.addColorStop(0, 'rgba(160,0,0,0.22)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  const opp = ARCADE_OPPONENTS[Math.min(arcadeIdx, ARCADE_OPPONENTS.length - 1)];
  ctx.save(); ctx.textAlign = 'center';

  ctx.font = '11px sans-serif'; ctx.fillStyle = '#3a3a3a';
  ctx.fillText('ARCADE MODE', CX, 36);

  ctx.font = 'bold 64px sans-serif';
  ctx.strokeStyle = '#200'; ctx.lineWidth = 10;
  ctx.strokeText('GAME  OVER', CX, H / 2 - 96);
  ctx.fillStyle = '#cc2222';
  ctx.fillText('GAME  OVER', CX, H / 2 - 96);

  ctx.font = '13px sans-serif'; ctx.fillStyle = '#777';
  ctx.fillText('Knocked out by', CX, H / 2 - 54);
  ctx.font = 'bold 19px sans-serif'; ctx.fillStyle = '#ff6644';
  ctx.fillText(opp.name, CX, H / 2 - 32);

  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(CX - 190, H / 2 - 16); ctx.lineTo(CX + 190, H / 2 - 16); ctx.stroke();

  // Progress ladder
  ctx.font = '9px sans-serif'; ctx.fillStyle = '#3a3a3a';
  ctx.fillText('YOUR RUN', CX, H / 2 + 4);
  const n = ARCADE_OPPONENTS.length;
  const stepW = 58, r = 13;
  const lx = CX - ((n - 1) * stepW) / 2;
  for (let i = 0; i < n; i++) {
    const x = lx + i * stepW, y = H / 2 + 32;
    if (i < n - 1) {
      ctx.strokeStyle = i < arcadeIdx ? '#2a5a2a' : '#1e1e1e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + r + 1, y); ctx.lineTo(x + stepW - r - 1, y); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i < arcadeIdx ? '#1a3a1a' : i === arcadeIdx ? '#3a0a0a' : '#121212'; ctx.fill();
    ctx.strokeStyle = i < arcadeIdx ? '#44aa44' : i === arcadeIdx ? '#cc2222' : '#2a2a2a';
    ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = i < arcadeIdx ? '#44cc44' : i === arcadeIdx ? '#ff4444' : '#2a2a2a';
    ctx.fillText(i < arcadeIdx ? '✓' : i === arcadeIdx ? '✗' : String(i + 1), x, y + 4);
    ctx.font = '8px sans-serif'; ctx.fillStyle = i <= arcadeIdx ? '#555' : '#252525';
    ctx.fillText(ARCADE_OPPONENTS[i].name.split(' ').pop(), x, y + r + 11);
  }

  if (roundStats) {
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#444';
    ctx.fillText(`Final fight — ${roundStats.p1.dmgDealt} dmg dealt  ·  ${roundStats.p1.knockdowns} knockdown${roundStats.p1.knockdowns !== 1 ? 's' : ''}`, CX, H / 2 + 72);
  }

  // Buttons
  const btnW = 148, btnH = 36, gap = 16, by = H / 2 + 92;
  const b1x = CX - btnW - gap / 2, b2x = CX + gap / 2;

  ctx.fillStyle = 'rgba(255,90,30,0.12)';
  ctx.beginPath(); ctx.roundRect(b1x, by, btnW, btnH, 8); ctx.fill();
  ctx.strokeStyle = '#cc4422'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(b1x, by, btnW, btnH, 8); ctx.stroke();
  ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ff7755';
  ctx.fillText('R  →  Try Again', b1x + btnW / 2, by + 23);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.beginPath(); ctx.roundRect(b2x, by, btnW, btnH, 8); ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(b2x, by, btnW, btnH, 8); ctx.stroke();
  ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#555';
  ctx.fillText('SPACE  →  Menu', b2x + btnW / 2, by + 23);

  ctx.restore();
}

function drawArcadeComplete() {
  ctx.fillStyle = '#050301'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W/2, H/2 - 20, 10, W/2, H/2 - 20, 300);
  g.addColorStop(0, 'rgba(255,200,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.textAlign = 'center';
  ctx.font = '72px sans-serif';
  ctx.fillText('🏆', W/2, H/2 - 52);
  ctx.font = 'bold 38px sans-serif';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 7;
  ctx.strokeText('ARCADE  CHAMPION!', W/2, H/2 + 10);
  ctx.fillStyle = '#ffe44d';
  ctx.fillText('ARCADE  CHAMPION!', W/2, H/2 + 10);
  ctx.font = '15px sans-serif'; ctx.fillStyle = '#888';
  ctx.fillText('You defeated all ' + ARCADE_OPPONENTS.length + ' opponents!', W/2, H/2 + 40);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#3a3a3a';
  ctx.fillText('Press  SPACE  or tap to return', W/2, H - 28);
  ctx.restore();
}

function drawCountdown() {
  const secs = Math.ceil(countdownTimer / 60);
  const frac = (countdownTimer % 60) / 60;
  const label = secs > 0 ? String(secs) : 'FIGHT!';
  const scale = secs > 0 ? (1.0 + frac * 0.5) : (1.0 + (1 - frac) * 0.4);
  ctx.save();
  ctx.globalAlpha = Math.min(1, frac * 3);
  ctx.font = `bold ${Math.round(110 * scale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 8;
  ctx.strokeText(label, W/2, H/2 + 36);
  ctx.fillStyle = secs > 0 ? '#ffe44d' : '#44ff88';
  ctx.fillText(label, W/2, H/2 + 36);
  ctx.restore();
}

// ── Main draw ─────────────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0,0,W,H);
  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#1a0a20');bg.addColorStop(1,'#0a0a0a');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  for(const s of[W*0.3,W*0.7]){
    const sg=ctx.createRadialGradient(s,0,10,s,200,300);
    sg.addColorStop(0,'rgba(255,240,180,0.07)');sg.addColorStop(1,'rgba(255,240,180,0)');
    ctx.fillStyle=sg;ctx.fillRect(0,0,W,H);
  }

  if(phase==='menu'){drawMenu();drawAchToast();return;}
  if(phase==='stats'){drawStats();drawAchToast();return;}
  if(phase==='achievements'){drawAchievements();drawAchToast();return;}
  if(phase==='charSelect'){drawCharSelect();return;}
  if(phase==='arcadeVS'){drawArcadeVS();return;}
  if(phase==='arcadeOver'){drawArcadeOver();return;}
  if(phase==='arcadeComplete'){drawArcadeComplete();return;}

  if(phase==='countdown'){
    drawCrowd();drawRing();
    const sorted=[p1,p2].sort((a,b)=>a.depth-b.depth);
    drawFighter(sorted[0]);drawFighter(sorted[1]);
    drawHUD();
    drawCountdown();
    return;
  }

  let shakeX=0, shakeY=0;
  if(shakeT>0){
    const decay=shakeT/22;
    shakeX=(Math.random()-0.5)*shakeMag*decay;
    shakeY=(Math.random()-0.5)*shakeMag*decay;
  }
  ctx.save(); ctx.translate(shakeX,shakeY);
  drawCrowd();drawRing();
  const sorted = [p1, p2].sort((a, b) => a.depth - b.depth);
  drawFighter(sorted[0]); drawFighter(sorted[1]);
  drawCombos();
  drawKnockdownCount();
  drawFloaties();
  ctx.restore();

  drawHUD();

  const needed=Math.ceil(totalRounds/2);
  const matchOver=roundsWon[0]>=needed||roundsWon[1]>=needed||(phase==='roundEnd'&&currentRound>=totalRounds);
  if(phase==='roundEnd'){
    if(matchOver) drawGameOver();
    else drawRoundEnd();
  }
  if(phase==='gameOver') drawGameOver();
  drawAchToast();
}

// ── Input for state transitions ───────────────────────────────────────────────
canvas.addEventListener('click', e => {
  const rect=canvas.getBoundingClientRect();
  const sx=(e.clientX-rect.left)*(W/rect.width), sy=(e.clientY-rect.top)*(H/rect.height);
  // Mute / fullscreen buttons (bottom-right) — always clickable
  if (sx >= W-54 && sx <= W-18 && sy >= H-26 && sy <= H-6) { window.BGM?.toggle(); return; }
  if (sx >= W-96 && sx <= W-60 && sy >= H-26 && sy <= H-6) { _toggleFullscreen(); return; }
  if(phase==='charSelect'){
    if (cpuDifficulty !== 'off') {
      // Difficulty row buttons
      const diffLevels = ['easy','medium','hard'];
      const diffBtnW=130, diffBtnH=34, diffGap=14;
      const diffTotalW=diffLevels.length*diffBtnW+(diffLevels.length-1)*diffGap;
      const diffStartX=(W-diffTotalW)/2, diffY=H-58;
      for(let d=0; d<diffLevels.length; d++){
        const bx=diffStartX+d*(diffBtnW+diffGap);
        if(sx>=bx&&sx<=bx+diffBtnW&&sy>=diffY&&sy<=diffY+diffBtnH){
          if(!p1Confirmed){ cpuDifficulty=diffLevels[d]; SFX.click(); }
          return;
        }
      }
    } else {
      // Small C key CPU toggle button (2P mode only)
      const cpuBtnX=W-116, cpuBtnY=H-54, cpuBtnW=108, cpuBtnH=26;
      if(sx>=cpuBtnX&&sx<=cpuBtnX+cpuBtnW&&sy>=cpuBtnY&&sy<=cpuBtnY+cpuBtnH){
        if(!p1Confirmed&&!p2Confirmed){ _cpuCycle(); }
        return;
      }
    }
    const CW=158,GAP=12,cardY=88,CH=285;
    const totalW=CHARACTERS.length*CW+(CHARACTERS.length-1)*GAP;
    const startX=(W-totalW)/2;
    for(let i=0;i<CHARACTERS.length;i++){
      const cx=startX+i*(CW+GAP);
      if(sx>=cx&&sx<=cx+CW&&sy>=cardY&&sy<=cardY+CH){
        if(sx < W/2){
          if(p1CharIdx===i&&!p1Confirmed){ p1Confirmed=true; SFX.bell(); _checkBothConfirmed(); }
          else if(!p1Confirmed){ p1CharIdx=i; SFX.click(); }
        } else if(cpuDifficulty === 'off'){
          if(p2CharIdx===i&&!p2Confirmed){ p2Confirmed=true; SFX.bell(); _checkBothConfirmed(); }
          else if(!p2Confirmed){ p2CharIdx=i; SFX.click(); }
        } else if (!isArcade) {
          // VS AI (non-arcade): right-side clicks navigate the CPU's character
          if(!p1Confirmed){ p2CharIdx=i; SFX.click(); }
        }
        break;
      }
    }
    return;
  }
  if(phase==='stats'){ phase='menu'; return; }
  if(phase==='achievements'){ phase='menu'; return; }
  if(phase==='arcadeComplete'){ isArcade=false; phase='menu'; window.BGM?.setPhase('menu'); return; }
  if(phase==='arcadeOver'){
    const CX=W/2, btnW=148, gap=16, by=H/2+92, btnH=36;
    const b1x=CX-btnW-gap/2;
    if(sx>=b1x&&sx<=b1x+btnW&&sy>=by&&sy<=by+btnH){ startArcade(); return; }
    isArcade=false; phase='menu'; window.BGM?.setPhase('menu'); return;
  }
  if (!window.netHooks.canMenuInput()) return;
  if(phase==='menu'){
    [1,3,5].forEach((r,i)=>{
      const bx=W/2-130+i*110,by=205,bw=90,bh=50;
      if(sx>=bx&&sx<=bx+bw&&sy>=by&&sy<=by+bh){ menuSelected=r; SFX.click(); }
    });
    if(sx>=W/2-100&&sx<=W/2+100&&sy>=290&&sy<=330){ SFX.click(); totalRounds=menuSelected; startGame(); return; }
    if(sx>=W/2-100&&sx<=W/2+100&&sy>=338&&sy<=372){ SFX.click(); startArcade(); return; }
    if(sx>=W/2-100&&sx<=W/2+100&&sy>=380&&sy<=412){ SFX.click(); totalRounds=menuSelected; startVsAI('medium'); return; }
    // STATS button
    if(sx>=W/2-52&&sx<=W/2+52&&sy>=434&&sy<=458){ SFX.click(); phase='stats'; return; }
    return;
  }
  if(phase==='roundEnd'||phase==='gameOver'){
    const needed=Math.ceil(totalRounds/2);
    const matchOver=roundsWon[0]>=needed||roundsWon[1]>=needed||currentRound>=totalRounds;
    if(matchOver||phase==='gameOver'){
      if(isArcade){
        if(roundsWon[0]>=needed){ arcadeIdx++; if(arcadeIdx>=ARCADE_OPPONENTS.length){isArcade=false;phase='arcadeComplete';SFX.victory();}else{_nextArcadeFight();} }
        else{phase='arcadeOver';}
        return;
      }
      // Check if Rematch button was clicked (online only)
      if(window.netIsOnline?.()) {
        const CX=W/2, CH=432, top=H/2-CH/2-10;
        const rbApproxY = top + 370;
        if(sx>=CX-70&&sx<=CX+70&&sy>=rbApproxY-5&&sy<=rbApproxY+38){
          if(!_rematchLocal){ _rematchLocal=true; SFX.click(); window.netHooks.onRematchRequest(); }
          return;
        }
      }
      phase='menu'; window.netHooks.onReturnMenu();
    }
    else startNextRound();
  }
});

function _toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function _cpuCycle() {
  const order = ['off', 'easy', 'medium', 'hard'];
  cpuDifficulty = order[(order.indexOf(cpuDifficulty) + 1) % order.length];
  p2Confirmed = false;
  SFX.click();
}

function _checkBothConfirmed() {
  if (cpuDifficulty !== 'off') p2Confirmed = true;
  if (p1Confirmed && p2Confirmed) {
    if (isArcade) {
      setTimeout(() => { arcadeVSTimer = 180; phase = 'arcadeVS'; SFX.roundWin(); }, 420);
    } else {
      setTimeout(startFight, 420);
    }
  }
}

document.addEventListener('keydown', e=>{
  if(e.key==='m'||e.key==='M'){ window.BGM?.toggle(); return; }
  if(e.key==='F11'){ e.preventDefault(); _toggleFullscreen(); return; }
  if(e.key==='r'||e.key==='R'){ if(phase==='arcadeOver'){ startArcade(); return; } }
  if(e.key==='Escape'){
    if(phase==='stats'||phase==='achievements'){ phase='menu'; return; }
    if(phase==='arcadeOver'||phase==='arcadeComplete'){ isArcade=false; phase='menu'; window.BGM?.setPhase('menu'); return; }
  }
  if(e.key==='Tab'){
    e.preventDefault();
    if(phase==='menu')         { phase='stats';        SFX.click(); return; }
    if(phase==='stats')        { phase='achievements'; SFX.click(); return; }
    if(phase==='achievements') { phase='menu';                      return; }
  }
  if(phase==='stats'||phase==='achievements') return;
  if(phase==='charSelect'){
    const N=CHARACTERS.length;
    if(e.key==='a'||e.key==='A'){ if(!p1Confirmed){p1CharIdx=(p1CharIdx+N-1)%N;SFX.click();} return; }
    if(e.key==='d'||e.key==='D'){ if(!p1Confirmed){p1CharIdx=(p1CharIdx+1)%N;SFX.click();} return; }
    if(e.key==='f'||e.key==='F'){ if(!p1Confirmed){p1Confirmed=true;SFX.bell();_checkBothConfirmed();} return; }
    if(e.key==='c'||e.key==='C'){
      if(!p1Confirmed&&!p2Confirmed){ _cpuCycle(); }
      return;
    }
    if(cpuDifficulty === 'off'){
      if(e.key==='ArrowLeft') { e.preventDefault(); if(!p2Confirmed){p2CharIdx=(p2CharIdx+N-1)%N;SFX.click();} return; }
      if(e.key==='ArrowRight'){ e.preventDefault(); if(!p2Confirmed){p2CharIdx=(p2CharIdx+1)%N;SFX.click();} return; }
      if(e.key==='l'||e.key==='L'){ if(!p2Confirmed){p2Confirmed=true;SFX.bell();_checkBothConfirmed();} return; }
    } else if (!isArcade) {
      // VS AI (non-arcade): ←/→ pick the CPU's character
      if(e.key==='ArrowLeft') { e.preventDefault(); if(!p1Confirmed){p2CharIdx=(p2CharIdx+N-1)%N;SFX.click();} return; }
      if(e.key==='ArrowRight'){ e.preventDefault(); if(!p1Confirmed){p2CharIdx=(p2CharIdx+1)%N;SFX.click();} return; }
    }
    return;
  }
  if(e.key===' '){
    if(phase==='arcadeOver'||phase==='arcadeComplete'){ isArcade=false; phase='menu'; window.BGM?.setPhase('menu'); return; }
    if (!window.netHooks.canMenuInput()) return;
    if(phase==='menu'){ totalRounds=menuSelected; startGame(); return; }
    if(phase==='roundEnd'||phase==='gameOver'){
      const needed=Math.ceil(totalRounds/2);
      const matchOver=roundsWon[0]>=needed||roundsWon[1]>=needed||currentRound>=totalRounds;
      if(matchOver||phase==='gameOver'){
        if(isArcade){
          if(roundsWon[0]>=needed){ arcadeIdx++; if(arcadeIdx>=ARCADE_OPPONENTS.length){isArcade=false;phase='arcadeComplete';SFX.victory();}else{_nextArcadeFight();} }
          else{phase='arcadeOver';}
          return;
        }
        phase='menu'; window.netHooks.onReturnMenu();
      }
      else startNextRound();
    }
  }
});

// ── Player names — overridden by netplay.js after name exchange ───────────────
window.playerNames = { p1: 'P1', p2: 'P2' };
window.netIsOnline = () => false; // overridden by netplay.js

// ── Netplay hooks — overridden by netplay.js; safe no-ops by default ─────────
window.netHooks = {
  canEndRound:      () => true,
  onEndRound:       () => {},
  canStartNext:     () => true,
  onStartNext:      () => {},
  canMenuInput:     () => true,
  onStartGame:      () => {},
  onReturnMenu:     () => {},
  skipUpdate:       () => false,
  onRematchRequest: () => {},  // called when local player requests rematch
};

// Public API for netplay.js to drive game state from received network events
window.Game = {
  get phase()        { return phase; },
  set phase(v)       { phase = v; },
  get totalRounds()  { return totalRounds; },
  set totalRounds(v) { totalRounds = v; },
  startGame(rounds)  { if (rounds !== undefined) totalRounds = rounds; startGame(); },
  startVsAI(diff)    { startVsAI(diff); },
  startNextRound()   { startNextRound(); },
  oppRematch()       { _rematchOpp = true; if (_rematchLocal) { startGame(); } },
  doEndRound(msg, p1Win, p2Win) { _endRound(msg, p1Win, p2Win); },
  getState() {
    if (!p1 || !p2) return null;
    return {
      p1: { ...p1 }, p2: { ...p2 },
      floaties: floaties.map(f => ({ ...f })),
      phase, roundFrame, hitStop, shakeT, shakeMag,
      roundEndMsg, roundEndTimer,
      roundsWon: [...roundsWon],
      currentRound, totalRounds,
      roundStats: roundStats ? { ...roundStats, p1: { ...roundStats.p1 }, p2: { ...roundStats.p2 } } : null,
      p1CharIdx, p2CharIdx,
    };
  },
  applyState(s) {
    if (!p1 || !p2 || !s) return;
    Object.assign(p1, s.p1);
    Object.assign(p2, s.p2);
    floaties = s.floaties ? s.floaties.map(f => ({ ...f })) : [];
    phase = s.phase; roundFrame = s.roundFrame; hitStop = s.hitStop;
    shakeT = s.shakeT; shakeMag = s.shakeMag;
    roundEndMsg = s.roundEndMsg; roundEndTimer = s.roundEndTimer;
    roundsWon = [...s.roundsWon];
    currentRound = s.currentRound; totalRounds = s.totalRounds;
    roundStats = s.roundStats ? { ...s.roundStats, p1: { ...s.roundStats.p1 }, p2: { ...s.roundStats.p2 } } : null;
    if (s.p1CharIdx !== undefined) { p1CharIdx = s.p1CharIdx; p2CharIdx = s.p2CharIdx; }
  },
};

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop(){
  window.netTick?.();
  if (!window.netHooks.skipUpdate()) update();
  draw();
  requestAnimationFrame(loop);
}
loop();
