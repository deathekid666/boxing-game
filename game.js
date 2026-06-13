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
  superCharge(){ tone(80,700,0.45,'sawtooth',0.2); tone(80,700,0.45,'square',0.12); },
  superHit()   { tone(500,40,0.5,'sawtooth',0.35); tone(50,30,0.6,'square',0.3,0.05); noiseBurst(0.3,0.4,0,1200); setTimeout(()=>tone(220,110,0.3,'square',0.2),120); },
  shieldBlock(){ tone(600,1200,0.1,'triangle',0.2); tone(1200,600,0.12,'triangle',0.15,0.08); },
  shieldBreak(){ tone(300,50,0.3,'square',0.25); noiseBurst(0.15,0.25,0,800); },
  stagger()    { tone(400,150,0.3,'sawtooth',0.15); },
  ko()         { const n=[330,294,262,220]; n.forEach((f,i)=>setTimeout(()=>tone(f,f*0.92,i===n.length-1?0.6:0.28,'sawtooth',0.25),i*260)); },
  bell()       { tone(900,880,0.5,'square',0.2); tone(900,880,0.5,'triangle',0.15,0.02); },
  victory()    { [262,330,392,523,659].forEach((f,i)=>setTimeout(()=>tone(f,f,0.22,'square',0.2),i*110)); },
  click()      { tone(700,1100,0.07,'triangle',0.15); },
  dodge()      { tone(500,200,0.12,'sine',0.15); }
};

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_HP      = 250;
const MAX_SHIELD  = 80;
const SHIELD_REGEN_DELAY = 120;
const SHIELD_REGEN_RATE  = 0.35;
const KICK_CD  = 72;
const SUPER_CD = 480;
const PUNCH_CD = 18;
const DASH_SPEED = 11;
const DASH_FRAMES = 10;
const DASH_CD = 45;
const ROUND_TIME = 60 * 60;
const MIN_GAP = 64;
const PUNCH_REACH = 145;
const KICK_REACH  = 140;
const SUPER_REACH = 190;
const RING_BACK_Y  = 270;
const RING_FRONT_Y = 430;
const RING_BACK_S  = 0.65;
const RING_FRONT_S = 1.0;
const RY_SPEED     = 0.012;
const JUMP_VZ      = -12;
const GRAVITY      = 0.7;
const JUMP_CD      = 30;

function ryToScreenY(ry) { return RING_BACK_Y + ry * (RING_FRONT_Y - RING_BACK_Y); }
function ryToScale(ry)   { return RING_BACK_S + ry * (RING_FRONT_S - RING_BACK_S); }
function fighterScreenY(p) { return ryToScreenY(p.ry) - (p.jz || 0); }

// ── Game state ───────────────────────────────────────────────────────────────
let phase = 'menu';
let totalRounds = 3;
let currentRound = 1;
let roundsWon = [0, 0];
let p1, p2, floaties;
let roundEndMsg = '';
let roundEndTimer = 0;
let roundFrame = 0;
let hitStop = 0;
let shakeT = 0;
let shakeMag = 0;

// ── Fighter factory ──────────────────────────────────────────────────────────
function mkFighter(x, color, dir) {
  return {
    x, y: 315, color, dir, ry: 0.5, jz: 0, jvz: 0, jumpCd: 0,
    hp: MAX_HP, shield: MAX_SHIELD,
    shieldTimer: 0, vx: 0,
    punching: false, punchT: 0, punchCd: 0,
    kicking: false, kickT: 0, kickCd: 0,
    supering: false, superT: 0, superCd: 0,
    wobble: 0, hit: 0, superFlash: 0,
    dashT: 0, dashCd: 0, dashDir: 0,
    ducking: false
  };
}

function spawnFighters() {
  p1 = mkFighter(190, '#4488ff',  1);
  p2 = mkFighter(630, '#ff4444', -1);
  floaties = [];
  roundFrame = 0;
  resetDoubleTap(); // clear stale dash signals and tap history (defined in input.js)
}

function startGame() {
  currentRound = 1;
  roundsWon = [0, 0];
  spawnFighters();
  phase = 'fight';
  SFX.bell();
  window.netHooks.onStartGame();
}

function startNextRound() {
  currentRound++;
  spawnFighters();
  phase = 'fight';
  SFX.bell();
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
  let d = dmg;
  const hadShield = defender.shield > 0;
  if (defender.shield > 0) {
    const absorb = Math.min(defender.shield, d * 0.7);
    defender.shield = Math.max(0, defender.shield - absorb);
    d -= absorb;
  }
  defender.hp    = Math.max(0, defender.hp - d);
  defender.wobble = type==='super' ? 35 : 20;
  defender.hit    = type==='super' ? 18 : 12;
  defender.vx     = attacker.dir * (type==='super' ? 8 : 4);
  defender.shieldTimer = SHIELD_REGEN_DELAY;
  addFloat(defender.x, fighterScreenY(defender)-100, attacker.color, type, d, isTip);

  hitStop  = type==='super' ? 14 : (isTip ? 8 : 5);
  shakeMag = type==='super' ? 14 : (isTip ? 7 : 4);
  shakeT   = type==='super' ? 22 : 12;

  if (type==='super') SFX.superHit();
  else if (type==='kick') SFX.kick();
  else SFX.punch();

  if (hadShield && defender.shield===0) setTimeout(()=>SFX.shieldBreak(), 80);
  else if (hadShield) setTimeout(()=>SFX.shieldBlock(), 30);
  if (defender.hp <= 0) setTimeout(()=>SFX.ko(), 150);
}

// ── Collision checks ──────────────────────────────────────────────────────────
function tipDamage(fistLen, maxReach, baseDmg, tipDmg) {
  const ext = Math.max(0, (fistLen-22) / (maxReach-22));
  return baseDmg + (tipDmg-baseDmg)*ext + Math.random()*6;
}

function checkPunch(a, d) {
  if (!a.punching) return;
  const t = Math.sin(a.punchT * Math.PI);
  if (t < 0.45) return;
  const as = ryToScale(a.ry), ds = ryToScale(d.ry);
  const rawLen = 22 + t*(PUNCH_REACH-22);
  const clampedLen = Math.min(rawLen, (Math.abs(d.x-a.x)-10) / as);
  if (clampedLen < 0) return;
  const asy = fighterScreenY(a), dsy = fighterScreenY(d);
  const scLen = clampedLen * as;
  const fx = a.x + a.dir*scLen, fy = asy - 35*as;
  if (Math.hypot(fx-d.x, fy-(dsy-35*ds)) < Math.max(28, 35*ds)) {
    if (d.ducking) {
      a.punching=false; a.punchT=0; a.punchCd=PUNCH_CD;
      addFloat(d.x, dsy-90, '#88ff88', 'dodge', 0, false); SFX.dodge(); return;
    }
    const isTip = (scLen-22)/(PUNCH_REACH-22) > 0.85;
    applyHit(a, d, tipDamage(scLen, PUNCH_REACH, 8, 22), 'punch', isTip);
    a.punching=false; a.punchT=0; a.punchCd=PUNCH_CD;
  }
}
function checkKick(a, d) {
  if (!a.kicking) return;
  const t = Math.sin(a.kickT * Math.PI);
  if (t < 0.4) return;
  const as = ryToScale(a.ry), ds = ryToScale(d.ry);
  const rawLen = 30 + t*(KICK_REACH-30);
  const clampedLen = Math.min(rawLen, (Math.abs(d.x-a.x)-10) / as);
  if (clampedLen < 0) return;
  const asy = fighterScreenY(a), dsy = fighterScreenY(d);
  const scLen = clampedLen * as;
  const lx = a.x + a.dir*scLen, ly = asy - 10*as + t*20*as;
  if (Math.hypot(lx-d.x, ly-(dsy-20*ds)) < Math.max(32, 42*ds)) {
    if (d.jz > 30) {
      a.kicking=false; a.kickT=0;
      addFloat(d.x, dsy-90, '#88ff88', 'dodge', 0, false); SFX.dodge(); return;
    }
    const isTip = (scLen-30)/(KICK_REACH-30) > 0.85;
    applyHit(a, d, tipDamage(scLen, KICK_REACH, 16, 38), 'kick', isTip);
    a.kicking=false; a.kickT=0;
  }
}
function checkSuper(a, d) {
  if (!a.supering) return;
  const t = Math.sin(a.superT * Math.PI);
  if (t < 0.35) return;
  const as = ryToScale(a.ry), ds = ryToScale(d.ry);
  const rawLen = 22 + t*(SUPER_REACH-22);
  const clampedLen = Math.min(rawLen, (Math.abs(d.x-a.x)-10) / as);
  if (clampedLen < 0) return;
  const asy = fighterScreenY(a), dsy = fighterScreenY(d);
  const scLen = clampedLen * as;
  const fx = a.x + a.dir*scLen, fy = asy - 35*as;
  if (Math.hypot(fx-d.x, fy-(dsy-35*ds)) < Math.max(40, 52*ds)) {
    if (d.ducking) {
      a.supering=false; a.superT=0;
      addFloat(d.x, dsy-90, '#88ff88', 'dodge', 0, false); SFX.dodge(); return;
    }
    const isTip = (scLen-22)/(SUPER_REACH-22) > 0.85;
    applyHit(a, d, tipDamage(scLen, SUPER_REACH, 55, 120), 'super', isTip);
    a.supering=false; a.superT=0;
  }
}

// ── Update ────────────────────────────────────────────────────────────────────
function update() {
  if (phase==='menu') return;

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

  if (hitStop > 0) { hitStop--; return; }
  if (shakeT > 0) shakeT--;

  const spd = 3.5;
  const canAct = p => !p.punching && !p.kicking && !p.supering;

  // dash trigger — consume the one-shot dash signal from inputState
  if (inputState.p1.dash !== 0 && p1.dashCd<=0 && p1.dashT<=0 && canAct(p1)) {
    p1.dashT=DASH_FRAMES; p1.dashDir=inputState.p1.dash; p1.dashCd=DASH_CD; SFX.click();
  }
  if (inputState.p2.dash !== 0 && p2.dashCd<=0 && p2.dashT<=0 && canAct(p2)) {
    p2.dashT=DASH_FRAMES; p2.dashDir=inputState.p2.dash; p2.dashCd=DASH_CD; SFX.click();
  }
  inputState.p1.dash = 0;
  inputState.p2.dash = 0;

  // movement
  if (p1.dashT>0) { p1.vx=p1.dashDir*DASH_SPEED; p1.dashT--; }
  else if (inputState.p1.left) p1.vx=-spd; else if (inputState.p1.right) p1.vx=spd; else p1.vx*=0.7;

  if (p2.dashT>0) { p2.vx=p2.dashDir*DASH_SPEED; p2.dashT--; }
  else if (inputState.p2.left) p2.vx=-spd; else if (inputState.p2.right) p2.vx=spd; else p2.vx*=0.7;

  p1.x = Math.max(70, Math.min(W-70, p1.x+p1.vx));
  p2.x = Math.max(70, Math.min(W-70, p2.x+p2.vx));

  // Depth movement — W/ArrowUp moves toward back of ring
  if (!p1.punching && !p1.kicking && !p1.supering && p1.dashT<=0) {
    if (inputState.p1.up) p1.ry = Math.max(0, p1.ry - RY_SPEED);
    else p1.ry = Math.min(1, p1.ry + RY_SPEED * 0.5);
  }
  if (!p2.punching && !p2.kicking && !p2.supering && p2.dashT<=0) {
    if (inputState.p2.up) p2.ry = Math.max(0, p2.ry - RY_SPEED);
    else p2.ry = Math.min(1, p2.ry + RY_SPEED * 0.5);
  }

  // Jump physics
  for (const p of [p1, p2]) {
    if (p.jz > 0 || p.jvz < 0) {
      p.jvz += GRAVITY;
      p.jz = Math.max(0, p.jz - p.jvz);
      if (p.jz === 0 && p.jvz >= 0) { p.jvz = 0; p.jumpCd = JUMP_CD; }
    }
    if (p.jumpCd > 0) p.jumpCd--;
  }

  // Jump trigger (one-shot consumed here)
  if (inputState.p1.jump && p1.jz === 0 && p1.jumpCd <= 0 && canAct(p1)) { p1.jvz = JUMP_VZ; }
  if (inputState.p2.jump && p2.jz === 0 && p2.jumpCd <= 0 && canAct(p2)) { p2.jvz = JUMP_VZ; }
  inputState.p1.jump = false;
  inputState.p2.jump = false;

  // 2D Euclidean collision — push apart along line between fighters in (x, screen-y)
  const _colDx  = p2.x - p1.x;
  const _colDsy = ryToScreenY(p2.ry) - ryToScreenY(p1.ry);
  const _colDist = Math.hypot(_colDx, _colDsy);
  if (_colDist < MIN_GAP) {
    const overlap = MIN_GAP - _colDist;
    // When dist≈0 (exact overlap), push horizontally so there's a defined direction
    const nx = _colDist > 0.5 ? _colDx / _colDist : 1;
    const ny = _colDist > 0.5 ? _colDsy / _colDist : 0;
    const pushX  = nx * overlap / 2;
    const pushRY = (ny * overlap / 2) / (RING_FRONT_Y - RING_BACK_Y);
    p1.x  = Math.max(70, Math.min(W-70, p1.x  - pushX));
    p2.x  = Math.max(70, Math.min(W-70, p2.x  + pushX));
    p1.ry = Math.max(0, Math.min(1, p1.ry - pushRY));
    p2.ry = Math.max(0, Math.min(1, p2.ry + pushRY));
  }

  p1.dir = p2.x>p1.x ?  1 : -1;
  p2.dir = p1.x<p2.x ? -1 :  1;

  // ducking
  const canDuck = p => !p.punching && !p.kicking && !p.supering && p.dashT<=0;
  p1.ducking = inputState.p1.duck ? canDuck(p1) : false;
  p2.ducking = inputState.p2.duck ? canDuck(p2) : false;

  // attacks
  const noAction = p => !p.punching && !p.kicking && !p.supering && p.punchCd<=0 && p.dashT<=0;
  if (inputState.p1.punch && noAction(p1))                          { p1.punching=true; p1.punchT=0; }
  if (inputState.p2.punch && noAction(p2))                          { p2.punching=true; p2.punchT=0; }
  if (inputState.p1.kick  && noAction(p1) && p1.kickCd<=0)         { p1.kicking=true;  p1.kickT=0;  p1.kickCd=KICK_CD; }
  if (inputState.p2.kick  && noAction(p2) && p2.kickCd<=0)         { p2.kicking=true;  p2.kickT=0;  p2.kickCd=KICK_CD; }
  if (inputState.p1.super && noAction(p1) && p1.superCd<=0)        { p1.supering=true; p1.superT=0; p1.superCd=SUPER_CD; p1.superFlash=30; SFX.superCharge(); }
  if (inputState.p2.super && noAction(p2) && p2.superCd<=0)        { p2.supering=true; p2.superT=0; p2.superCd=SUPER_CD; p2.superFlash=30; SFX.superCharge(); }

  // advance timers
  if (p1.punching) { p1.punchT+=0.07; if (p1.punchT>=1) { p1.punching=false; p1.punchT=0; p1.punchCd=PUNCH_CD; } }
  if (p2.punching) { p2.punchT+=0.07; if (p2.punchT>=1) { p2.punching=false; p2.punchT=0; p2.punchCd=PUNCH_CD; } }
  if (p1.kicking)  { p1.kickT+=0.055; if (p1.kickT>=1)  { p1.kicking=false;  p1.kickT=0; } }
  if (p2.kicking)  { p2.kickT+=0.055; if (p2.kickT>=1)  { p2.kicking=false;  p2.kickT=0; } }
  if (p1.supering) { p1.superT+=0.04; if (p1.superT>=1) { p1.supering=false; p1.superT=0; } }
  if (p2.supering) { p2.superT+=0.04; if (p2.superT>=1) { p2.supering=false; p2.superT=0; } }
  for (const p of [p1,p2]) {
    if (p.kickCd>0)    p.kickCd--;
    if (p.superCd>0)   p.superCd--;
    if (p.punchCd>0)   p.punchCd--;
    if (p.dashCd>0)    p.dashCd--;
    if (p.superFlash>0) p.superFlash--;
    if (p.wobble>0)    p.wobble--;
    if (p.hit>0)       p.hit--;
    if (p.shieldTimer>0) p.shieldTimer--;
    else if (p.shield<MAX_SHIELD) p.shield=Math.min(MAX_SHIELD, p.shield+SHIELD_REGEN_RATE);
  }

  checkPunch(p1,p2); checkPunch(p2,p1);
  checkKick(p1,p2);  checkKick(p2,p1);
  checkSuper(p1,p2); checkSuper(p2,p1);

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
  if (roundsWon[0]>=needed || roundsWon[1]>=needed || currentRound>=totalRounds) {
    roundEndTimer = 999;
    phase = 'roundEnd';
    setTimeout(()=>SFX.victory(), 700);
  } else {
    phase = 'roundEnd';
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
  const s    = ryToScale(p.ry);
  const sy   = fighterScreenY(p);
  const wobX = Math.sin(p.wobble*0.5)*10;
  const hitFlash = p.hit>0 && Math.floor(p.hit)%2===0;
  ctx.save();
  ctx.translate(p.x+wobX, sy);
  ctx.scale(s, s);
  if (p.ducking) { ctx.translate(0,18); ctx.scale(1,0.72); }
  const col  = hitFlash ? '#fff' : (p.superFlash>0 ? '#ffff44' : p.color);
  const dark = p.color==='#4488ff' ? '#1144aa' : '#aa1111';

  if (p.superFlash>0) {
    ctx.save(); ctx.globalAlpha=(p.superFlash/30)*0.45;
    ctx.beginPath(); ctx.arc(0,-30,55,0,Math.PI*2); ctx.fillStyle='#ffff00'; ctx.fill();
    ctx.restore();
  }
  if (p.shield>0) {
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
  let armLen=22;
  if (p.punching) { const raw=22+Math.sin(p.punchT*Math.PI)*(PUNCH_REACH-22); armLen=Math.max(22,Math.min(raw,fighterGap-10)); }
  if (p.supering) { const raw=22+Math.sin(p.superT*Math.PI)*(SUPER_REACH-22); armLen=Math.max(22,Math.min(raw,fighterGap-10)); }
  const fx=p.dir*armLen, armY=-35;
  ctx.beginPath(); ctx.moveTo(p.dir*12,armY);
  ctx.bezierCurveTo(p.dir*(armLen*0.3),armY-15, p.dir*(armLen*0.7),armY+10, fx,armY);
  ctx.strokeStyle=col; ctx.lineWidth=12; ctx.lineCap='round'; ctx.stroke();
  ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
  const fist=p.supering?24:16;
  let punchExt=0;
  if (p.punching) punchExt=(armLen-22)/(PUNCH_REACH-22);
  if (p.supering) punchExt=(armLen-22)/(SUPER_REACH-22);
  if ((p.punching||p.supering)&&punchExt>0.8) {
    ctx.save(); ctx.globalAlpha=0.5+Math.sin(Date.now()/40)*0.3;
    ctx.beginPath(); ctx.arc(fx,armY,fist+8,0,Math.PI*2);
    ctx.fillStyle='#ff4400'; ctx.fill(); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(fx,armY,fist,0,Math.PI*2);
  ctx.fillStyle=(p.supering&&p.superT>0)?'#ffff44':col; ctx.fill();
  ctx.strokeStyle=dark; ctx.lineWidth=2; ctx.stroke();
  for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(fx+p.dir*(4+i*3),armY-8);ctx.lineTo(fx+p.dir*(4+i*3),armY+8);ctx.strokeStyle=dark;ctx.lineWidth=1.5;ctx.stroke();}
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
  if(p.hp<MAX_HP*0.5){ctx.fillStyle='#88ccff';ctx.beginPath();ctx.ellipse(p.dir*18,-70+Math.sin(Date.now()/200)*3,3,5,0.3,0,Math.PI*2);ctx.fill();}
  ctx.restore();
}

function drawBar(x,y,w,h,val,max,c1,c2){
  ctx.fillStyle='#222';ctx.beginPath();ctx.roundRect(x,y,w,h,5);ctx.fill();
  const fw=(val/max)*w;
  if(fw>0){const g=ctx.createLinearGradient(x,0,x+w,0);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x,y,fw,h,5);ctx.fill();}
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
  drawBar(18,14,bw,20,p1.hp,MAX_HP,`hsl(${(p1.hp/MAX_HP)*120},80%,45%)`,`hsl(${(p1.hp/MAX_HP)*120},90%,60%)`);
  drawBar(18,38,bw,10,p1.shield,MAX_SHIELD,'#44aaff','#88ddff');
  ctx.fillStyle='#fff';ctx.font='bold 12px sans-serif';ctx.textAlign='left';
  ctx.fillText(`${window.playerNames.p1}  ${Math.ceil(p1.hp)}`,26,27);
  drawCdBtn(18,52,'KICK',p1.kickCd,KICK_CD,'#ffaa00');
  drawCdBtn(65,52,'SUPER',p1.superCd,SUPER_CD,'#ff44ff');
  drawCdBtn(112,52,'DASH',p1.dashCd,DASH_CD,'#00ddff');
  drawBar(W-18-bw,14,bw,20,p2.hp,MAX_HP,`hsl(${(p2.hp/MAX_HP)*120},90%,60%)`,`hsl(${(p2.hp/MAX_HP)*120},80%,45%)`);
  drawBar(W-18-bw,38,bw,10,p2.shield,MAX_SHIELD,'#88ddff','#44aaff');
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
  for(let i=0;i<totalRounds;i++){
    const cx=W/2-(totalRounds*18)/2+i*18+9;
    ctx.beginPath();ctx.arc(cx,50,7,0,Math.PI*2);
    ctx.fillStyle=i<roundsWon[0]?'#4488ff':(totalRounds-1-i<roundsWon[1]?'#ff4444':'#333');
    ctx.fill();ctx.strokeStyle='#666';ctx.lineWidth=1;ctx.stroke();
  }
  ctx.textAlign='left';
}

function drawFloaties(){
  for(const f of floaties){
    ctx.save();ctx.globalAlpha=Math.max(0,1-f.t/55);
    ctx.fillStyle=f.col;ctx.strokeStyle='#000';ctx.lineWidth=3;
    ctx.font=`bold ${f.size-f.t*0.1}px sans-serif`;ctx.textAlign='center';
    ctx.strokeText(f.txt,f.x,f.y);ctx.fillText(f.txt,f.x,f.y);
    ctx.restore();
  }
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
  ctx.fillStyle='#ffe44d';ctx.beginPath();ctx.roundRect(W/2-100,310,200,55,12);ctx.fill();
  ctx.fillStyle='#111';ctx.font='bold 22px sans-serif';ctx.textAlign='center';
  ctx.fillText('START FIGHT',W/2,344);
  ctx.font='13px sans-serif';ctx.fillStyle='#555';
  ctx.fillText('click the buttons above to select',W/2,395);
  ctx.restore();
}

function drawRoundEnd(){
  ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(0,0,W,H);
  ctx.save();ctx.textAlign='center';
  ctx.font='bold 44px sans-serif';ctx.strokeStyle='#000';ctx.lineWidth=6;
  ctx.strokeText(roundEndMsg,W/2,H/2-20);ctx.fillStyle='#ffe44d';ctx.fillText(roundEndMsg,W/2,H/2-20);
  const needed=Math.ceil(totalRounds/2);
  const matchOver=roundsWon[0]>=needed||roundsWon[1]>=needed||currentRound>=totalRounds;
  ctx.font='20px sans-serif';ctx.strokeStyle='#000';ctx.lineWidth=3;
  const s = (!matchOver && roundEndTimer>0)
    ? `Next round in ${Math.ceil(roundEndTimer/60)}…`
    : 'Press SPACE or click to continue';
  ctx.strokeText(s,W/2,H/2+35);ctx.fillStyle='#fff';ctx.fillText(s,W/2,H/2+35);
  ctx.restore();
}

function drawGameOver(){
  ctx.fillStyle='rgba(0,0,0,0.78)';ctx.fillRect(0,0,W,H);
  ctx.save();ctx.textAlign='center';
  const needed=Math.ceil(totalRounds/2);
  let title,sub;
  if(roundsWon[0]>=needed){title=`🟦 ${window.playerNames.p1.toUpperCase()} IS CHAMPION!`;sub=`${roundsWon[0]} — ${roundsWon[1]}`;}
  else if(roundsWon[1]>=needed){title=`🟥 ${window.playerNames.p2.toUpperCase()} IS CHAMPION!`;sub=`${roundsWon[0]} — ${roundsWon[1]}`;}
  else{title="IT'S A DRAW!";sub=`${roundsWon[0]} — ${roundsWon[1]}`;}
  ctx.font='bold 42px sans-serif';ctx.strokeStyle='#000';ctx.lineWidth=7;
  ctx.strokeText(title,W/2,H/2-30);ctx.fillStyle='#ffe44d';ctx.fillText(title,W/2,H/2-30);
  ctx.font='bold 32px sans-serif';ctx.strokeStyle='#000';ctx.lineWidth=5;
  ctx.strokeText(sub,W/2,H/2+20);ctx.fillStyle='#fff';ctx.fillText(sub,W/2,H/2+20);
  ctx.font='18px sans-serif';ctx.lineWidth=3;
  ctx.strokeText('Press SPACE or click to play again',W/2,H/2+68);
  ctx.fillStyle='#aaa';ctx.fillText('Press SPACE or click to play again',W/2,H/2+68);
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

  if(phase==='menu'){drawMenu();return;}

  let shakeX=0, shakeY=0;
  if(shakeT>0){
    const decay=shakeT/22;
    shakeX=(Math.random()-0.5)*shakeMag*decay;
    shakeY=(Math.random()-0.5)*shakeMag*decay;
  }
  ctx.save(); ctx.translate(shakeX,shakeY);
  drawCrowd();drawRing();
  const sorted = [p1, p2].sort((a, b) => a.ry - b.ry);
  drawFighter(sorted[0]); drawFighter(sorted[1]);
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
}

// ── Input for state transitions ───────────────────────────────────────────────
canvas.addEventListener('click', e => {
  if (!window.netHooks.canMenuInput()) return;
  const rect=canvas.getBoundingClientRect();
  const sx=(e.clientX-rect.left)*(W/rect.width), sy=(e.clientY-rect.top)*(H/rect.height);
  if(phase==='menu'){
    [1,3,5].forEach((r,i)=>{
      const bx=W/2-130+i*110,by=205,bw=90,bh=50;
      if(sx>=bx&&sx<=bx+bw&&sy>=by&&sy<=by+bh){ menuSelected=r; SFX.click(); }
    });
    if(sx>=W/2-100&&sx<=W/2+100&&sy>=310&&sy<=365){ SFX.click(); totalRounds=menuSelected; startGame(); }
    return;
  }
  if(phase==='roundEnd'||phase==='gameOver'){
    const needed=Math.ceil(totalRounds/2);
    const matchOver=roundsWon[0]>=needed||roundsWon[1]>=needed||currentRound>=totalRounds;
    if(matchOver||phase==='gameOver'){ phase='menu'; window.netHooks.onReturnMenu(); }
    else startNextRound();
  }
});

document.addEventListener('keydown', e=>{
  if(e.key===' '){
    if (!window.netHooks.canMenuInput()) return;
    if(phase==='menu'){ totalRounds=menuSelected; startGame(); return; }
    if(phase==='roundEnd'||phase==='gameOver'){
      const needed=Math.ceil(totalRounds/2);
      const matchOver=roundsWon[0]>=needed||roundsWon[1]>=needed||currentRound>=totalRounds;
      if(matchOver||phase==='gameOver'){ phase='menu'; window.netHooks.onReturnMenu(); }
      else startNextRound();
    }
  }
});

// ── Player names — overridden by netplay.js after name exchange ───────────────
window.playerNames = { p1: 'P1', p2: 'P2' };

// ── Netplay hooks — overridden by netplay.js; safe no-ops by default ─────────
window.netHooks = {
  canEndRound:  () => true,   // guest returns false to suppress local KO detection
  onEndRound:   () => {},     // host sends round-end event to guest
  canStartNext: () => true,   // guest returns false to suppress auto-advance
  onStartNext:  () => {},     // host sends next-round event to guest
  canMenuInput: () => true,   // guest returns false so only host controls menus
  onStartGame:  () => {},     // host sends game-start event to guest
  onReturnMenu: () => {},     // host sends return-to-menu event to guest
  skipUpdate:   () => false,  // guest returns true so host state drives simulation
};

// Public API for netplay.js to drive game state from received network events
window.Game = {
  get phase()        { return phase; },
  set phase(v)       { phase = v; },
  get totalRounds()  { return totalRounds; },
  set totalRounds(v) { totalRounds = v; },
  startGame(rounds)  { if (rounds !== undefined) totalRounds = rounds; startGame(); },
  startNextRound()   { startNextRound(); },
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
