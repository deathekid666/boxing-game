// netplay.js — PeerJS state-sync netplay (host authoritative, guest renders host state)

(function () {
  'use strict';

  const PREFIX = 'boxgame-';
  const CHARS  = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function genCode(len) {
    len = len || 5;
    let s = '';
    for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
    return s;
  }

  // ── Runtime state ────────────────────────────────────────────────────────────
  let peer = null, conn = null;
  let mode   = 'offline';  // 'offline' | 'hosting' | 'connecting' | 'connected'
  let mySlot = null;       // 'p1' (host) | 'p2' (guest)
  let myName = '';
  let oppName = '';
  let lastRoomCode = '';   // remembered for reconnect

  // Buffers updated by incoming messages; consumed in netTick each frame.
  let latestHostState = null;
  let pendingGuestInput = { left:false,right:false,duck:false,punch:false,kick:false,super:false,dash:0 };

  // ── Ping / RTT ───────────────────────────────────────────────────────────────
  let _rtt = -1;           // ms, -1 = unknown
  let _pingInterval = null;
  window.netRTT = () => _rtt;

  function startPing() {
    stopPing();
    _pingInterval = setInterval(() => {
      if (conn && mode === 'connected') conn.send({ type:'ping', ts: Date.now() });
    }, 1000);
  }
  function stopPing() {
    if (_pingInterval) { clearInterval(_pingInterval); _pingInterval = null; }
    _rtt = -1;
  }

  // ── Reconnect state ──────────────────────────────────────────────────────────
  let _reconnectTimer  = null;
  let _reconnectSecsLeft = 0;
  const RECONNECT_TIMEOUT = 15;

  function startReconnect(reason) {
    _reconnectSecsLeft = RECONNECT_TIMEOUT;
    showReconnectOverlay(reason, _reconnectSecsLeft);
    if (_reconnectTimer) clearInterval(_reconnectTimer);
    _reconnectTimer = setInterval(() => {
      _reconnectSecsLeft--;
      updateReconnectCountdown(_reconnectSecsLeft);
      if (_reconnectSecsLeft <= 0) {
        clearInterval(_reconnectTimer); _reconnectTimer = null;
        failReconnect();
      } else if (mySlot === 'p2' && lastRoomCode) {
        // Guest: attempt re-connection every ~3s
        if (_reconnectSecsLeft % 3 === 0) tryGuestReconnect();
      }
      // Host just waits — peer is still alive and listening
    }, 1000);
  }

  function tryGuestReconnect() {
    if (mode === 'connected') return;
    try {
      const c = peer ? peer.connect(PREFIX + lastRoomCode, { reliable: true, serialization: 'json' }) : null;
      if (!c) return;
      c.on('open', () => {
        clearInterval(_reconnectTimer); _reconnectTimer = null;
        setupConn(c);
        hideReconnectOverlay();
      });
      c.on('error', () => {}); // silently ignore failed attempts
    } catch (_) {}
  }

  function failReconnect() {
    hideReconnectOverlay();
    showDisconnectOverlay('Could not reconnect after ' + RECONNECT_TIMEOUT + 's.');
    // Award win to the connected player (only record for P1 locally)
    if (mySlot === 'p1') {
      const p1Name = (window.playerNames?.p1 || '').trim();
      if (p1Name && p1Name !== 'P1') {
        window.Leaderboard?.recordMatchResult({
          playerName: p1Name, won: true, kos: 0, bestCombo: 0, damage: 0,
          opponent: (window.playerNames?.p2 || '').trim() || null,
        });
      }
    }
  }

  // ── Matchmaking state ────────────────────────────────────────────────────────
  let _mmPollInterval = null;
  let _mmTimeoutTimer = null;
  let _mmSecsLeft = 0;
  const MM_TIMEOUT = 30;
  let _mmRoomCode = '';

  function startMatchmaking() {
    _mmRoomCode = genCode();
    _mmSecsLeft = MM_TIMEOUT;
    showScreen('matchmaking');
    setMMStatus('Searching for opponent… (' + _mmSecsLeft + 's)');

    // Ensure we have auth before entering queue
    const enterAndPoll = () => {
      window.Leaderboard?.enterQueue({ playerName: myName, roomCode: _mmRoomCode })
        .then(() => {
          _mmPollInterval = setInterval(pollMatchmaking, 2000);
          _mmTimeoutTimer = setInterval(() => {
            _mmSecsLeft--;
            setMMStatus('Searching for opponent… (' + _mmSecsLeft + 's)');
            if (_mmSecsLeft <= 0) cancelMatchmaking('No opponent found — try again.');
          }, 1000);
        });
    };

    if (window.Leaderboard?.uid) { enterAndPoll(); }
    else {
      setMMStatus('Connecting to server…');
      setTimeout(() => {
        if (window.Leaderboard?.uid) enterAndPoll();
        else setMMStatus('⚠ Server unavailable. Try Host/Join instead.');
      }, 2000);
    }
  }

  function pollMatchmaking() {
    window.Leaderboard?.pollForMatch().then(match => {
      if (!match) return;
      clearMM();
      if (match.isHost) {
        // I am host — create PeerJS host with my pre-generated room code
        mySlot = 'p1';
        window.localPlayer = 'p1';
        window.playerNames.p1 = myName;
        oppName = match.opponentName;
        window.playerNames.p2 = oppName;
        setStatus('Found opponent: <strong>' + esc(match.opponentName) + '</strong> — connecting…');
        showScreen('hosting');
        setRoomCode(_mmRoomCode);
        hostGameWithCode(_mmRoomCode);
      } else {
        // I am guest — connect to opponent's room code
        mySlot = 'p2';
        window.localPlayer = 'p2';
        window.playerNames.p2 = myName;
        oppName = match.opponentName;
        setStatus('Found opponent: <strong>' + esc(match.opponentName) + '</strong> — connecting…');
        showScreen('connecting');
        joinGame(match.roomCode);
      }
      // Leave queue after matching
      window.Leaderboard?.leaveQueue();
    });
  }

  function clearMM() {
    if (_mmPollInterval) { clearInterval(_mmPollInterval); _mmPollInterval = null; }
    if (_mmTimeoutTimer) { clearInterval(_mmTimeoutTimer); _mmTimeoutTimer = null; }
  }

  function cancelMatchmaking(msg) {
    clearMM();
    window.Leaderboard?.leaveQueue();
    showScreen('mode');
    if (msg) setStatus(msg);
  }

  // ── Netplay hooks ────────────────────────────────────────────────────────────
  window.netHooks.skipUpdate   = () => mySlot === 'p2' && mode === 'connected';
  window.netHooks.canEndRound  = () => mySlot !== 'p2';
  window.netHooks.canStartNext = () => mySlot !== 'p2';
  window.netHooks.canMenuInput = () => mySlot !== 'p2';

  window.netHooks.onEndRound = (msg, p1Win, p2Win) => {
    if (mySlot === 'p1' && conn) conn.send({ type:'roundEnd', msg, p1Win, p2Win });
  };
  window.netHooks.onStartNext = () => {
    if (mySlot === 'p1' && conn) conn.send({ type:'nextRound' });
  };
  window.netHooks.onStartGame = () => {
    if (mySlot === 'p1' && conn) conn.send({ type:'startGame', totalRounds: window.Game.totalRounds });
  };
  window.netHooks.onReturnMenu = () => {
    if (mySlot === 'p1' && conn) conn.send({ type:'returnMenu' });
  };
  window.netHooks.onRematchRequest = () => {
    if (conn) conn.send({ type:'rematchRequest' });
  };

  window.netIsOnline = () => mode === 'connected';

  // ── Per-frame tick (called at top of game loop) ──────────────────────────────
  window.netTick = function () {
    if (mode !== 'connected' || !conn) return;
    const ph = window.Game?.phase;

    if (mySlot === 'p1') {
      const gi = pendingGuestInput;
      inputState.p2.left  = gi.left;
      inputState.p2.right = gi.right;
      inputState.p2.duck  = gi.duck;
      inputState.p2.punch = gi.punch;
      inputState.p2.kick  = gi.kick;
      inputState.p2.super = gi.super;
      if (gi.dash !== 0) { inputState.p2.dash = gi.dash; pendingGuestInput.dash = 0; }

      if (ph === 'fight' || ph === 'roundEnd') {
        const s = window.Game.getState();
        if (s) conn.send({ type:'state', state:s });
      }
    } else {
      if (latestHostState) {
        window.Game.applyState(latestHostState);
        latestHostState = null;
      }
      const inp = inputState.p2;
      conn.send({ type:'input', state:{
        left:inp.left, right:inp.right, duck:inp.duck,
        punch:inp.punch, kick:inp.kick, super:inp.super, dash:inp.dash
      }});
    }
  };

  // ── Incoming message handler ─────────────────────────────────────────────────
  function handleData(msg) {
    switch (msg.type) {
      case 'hello':
        oppName = msg.name || (mySlot === 'p1' ? 'Guest' : 'Host');
        window.playerNames[mySlot === 'p1' ? 'p2' : 'p1'] = oppName;
        setStatus('Connected — vs <strong>' + esc(oppName) + '</strong>');
        updateConnectedInfo();
        break;

      case 'input':
        if (msg.state) {
          pendingGuestInput.left  = !!msg.state.left;
          pendingGuestInput.right = !!msg.state.right;
          pendingGuestInput.duck  = !!msg.state.duck;
          pendingGuestInput.punch = !!msg.state.punch;
          pendingGuestInput.kick  = !!msg.state.kick;
          pendingGuestInput.super = !!msg.state.super;
          if (msg.state.dash) pendingGuestInput.dash = msg.state.dash;
        }
        break;

      case 'state':
        latestHostState = msg.state;
        break;

      case 'startGame':
        window.Game.startGame(msg.totalRounds);
        break;

      case 'roundEnd':
        window.Game.doEndRound(msg.msg, msg.p1Win, msg.p2Win);
        break;

      case 'nextRound':
        window.Game.startNextRound();
        break;

      case 'returnMenu':
        window.Game.phase = 'menu';
        hideReconnectOverlay();
        hideDisconnectOverlay();
        break;

      case 'rematchRequest':
        window.Game.oppRematch();
        break;

      case 'ping':
        if (conn) conn.send({ type:'pong', ts: msg.ts });
        break;

      case 'pong':
        _rtt = Date.now() - msg.ts;
        updatePingDisplay();
        break;
    }
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────────
  function setupConn(c) {
    conn = c;

    conn.on('open', () => {
      mode = 'connected';
      conn.send({ type:'hello', name:myName });
      window.playerNames[mySlot] = myName;
      setStatus(mySlot === 'p1'
        ? 'Opponent connected — choose rounds and START'
        : 'Connected — waiting for host to start…');
      showScreen('connected');
      updateConnectedInfo();
      startPing();
    });

    conn.on('data', handleData);

    conn.on('close', () => { onDisconnect('Opponent disconnected.'); });

    conn.on('error', e => {
      const msg = (e && e.message) || String(e);
      if (mode === 'connecting') {
        setError('⚠ ' + msg + ' — check the code and try again.');
        showScreen('join');
        cleanupGuest();
      } else {
        onDisconnect('Connection error: ' + msg);
      }
    });
  }

  function onDisconnect(reason) {
    const wasInFight = window.Game?.phase === 'fight' || window.Game?.phase === 'roundEnd';
    conn = null;
    stopPing();
    pendingGuestInput = { left:false,right:false,duck:false,punch:false,kick:false,super:false,dash:0 };
    latestHostState = null;

    if (wasInFight) {
      startReconnect(reason);
    } else {
      if (window.Game) window.Game.phase = 'menu';
    }

    if (mySlot === 'p1') {
      mode = 'hosting';
      setStatus('Opponent disconnected — room still open.');
      if (!wasInFight) showScreen('hosting');
    } else {
      if (!wasInFight) {
        cleanupGuest();
        setStatus(reason || 'Disconnected.');
        showScreen('mode');
      }
      // If in fight, keep peer alive for reconnect attempt
    }
  }

  function cleanupGuest() {
    if (peer) { try { peer.destroy(); } catch(_) {} peer = null; }
    conn = null;
    mode = 'offline';
    mySlot = null;
    window.localPlayer = window.isTouch ? 'p1' : 'both';
    pendingGuestInput = { left:false,right:false,duck:false,punch:false,kick:false,super:false,dash:0 };
    latestHostState = null;
    stopPing();
    oppName = '';
    window.playerNames.p1 = 'P1';
    window.playerNames.p2 = 'P2';
  }

  function fullTeardown() {
    clearMM();
    if (conn) { try { conn.close(); } catch(_) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch(_) {} peer = null; }
    mode = 'offline'; mySlot = null;
    window.localPlayer = window.isTouch ? 'p1' : 'both';
    pendingGuestInput = { left:false,right:false,duck:false,punch:false,kick:false,super:false,dash:0 };
    latestHostState = null;
    stopPing();
    oppName = '';
    window.playerNames.p1 = myName || 'P1';
    window.playerNames.p2 = 'P2';
  }

  // ── Host ─────────────────────────────────────────────────────────────────────
  function hostGameWithCode(code) {
    lastRoomCode = code;
    peer = new Peer(PREFIX + code, { debug: 0 });

    peer.on('open', () => {
      mode = 'hosting';
      setStatus('Waiting for opponent…');
    });

    peer.on('connection', c => {
      if (conn) { c.close(); return; }
      mode = 'connecting';
      // If reconnecting: handle as reconnect
      if (_reconnectTimer) {
        clearInterval(_reconnectTimer); _reconnectTimer = null;
        hideReconnectOverlay();
      }
      setupConn(c);
    });

    peer.on('error', e => {
      const msg = (e && e.message) || String(e);
      setStatus('⚠ ' + msg);
      if (mode === 'offline' || mode === 'hosting') showScreen('mode');
    });
  }

  function hostGame() {
    fullTeardown();
    mySlot = 'p1';
    window.localPlayer = 'p1';
    window.playerNames.p1 = myName;

    const code = genCode();
    showScreen('hosting');
    setRoomCode(code);
    setStatus('Creating room…');
    hostGameWithCode(code);
  }

  // ── Join ─────────────────────────────────────────────────────────────────────
  function joinGame(code) {
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    lastRoomCode = cleaned;

    if (!peer || mode === 'offline') {
      // Fresh join (not a reconnect)
      fullTeardown();
      mySlot = 'p2';
      window.localPlayer = 'p2';
      window.playerNames.p2 = myName;
      mode = 'connecting';
      showScreen('connecting');
      setStatus('Connecting to room ' + cleaned + '…');
      setError('');
    }

    if (!peer) peer = new Peer({ debug: 0 });

    let joinTimeout = null;

    peer.on('open', () => {
      const c = peer.connect(PREFIX + cleaned, { reliable: true, serialization: 'json' });

      joinTimeout = setTimeout(() => {
        if (mode !== 'connected') {
          setError('⚠ Room not found or timed out. Check the code.');
          showScreen('join');
          cleanupGuest();
        }
      }, 9000);

      c.on('open', () => { clearTimeout(joinTimeout); joinTimeout = null; });
      setupConn(c);
    });

    if (peer.id) {
      // peer already open (reconnect case)
      const c = peer.connect(PREFIX + cleaned, { reliable: true, serialization: 'json' });
      joinTimeout = setTimeout(() => {
        if (mode !== 'connected') cleanupGuest();
      }, 5000);
      c.on('open', () => { clearTimeout(joinTimeout); joinTimeout = null; });
      setupConn(c);
    }

    peer.on('error', e => {
      clearTimeout(joinTimeout);
      const msg = (e && e.message) || String(e);
      setError('⚠ ' + msg + ' — check the code.');
      showScreen('join');
      cleanupGuest();
    });
  }

  // ── Reconnect overlay ─────────────────────────────────────────────────────────
  function buildReconnectOverlay() {
    const el = document.createElement('div');
    el.id = 'net-reconnecting';
    Object.assign(el.style, {
      display: 'none', position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.82)', zIndex: '501',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '14px',
    });
    el.innerHTML =
      '<div style="font-size:44px">📶</div>' +
      '<div style="color:#fff;font-size:20px;font-weight:bold;font-family:sans-serif">Reconnecting…</div>' +
      '<div id="net-recon-reason" style="color:#aaa;font-size:13px;font-family:sans-serif"></div>' +
      '<div id="net-recon-count" style="color:#ffe44d;font-size:28px;font-weight:bold;font-family:monospace">15</div>' +
      '<button id="net-recon-give-up" style="margin-top:6px;padding:10px 24px;border:none;border-radius:10px;background:#333;color:#aaa;font-size:13px;cursor:pointer">Give up</button>';
    document.body.appendChild(el);
    document.getElementById('net-recon-give-up').addEventListener('click', () => {
      if (_reconnectTimer) { clearInterval(_reconnectTimer); _reconnectTimer = null; }
      hideReconnectOverlay();
      showDisconnectOverlay('Disconnected.');
    });
  }

  function showReconnectOverlay(reason, secs) {
    const el = document.getElementById('net-reconnecting');
    if (!el) return;
    el.style.display = 'flex';
    const r = document.getElementById('net-recon-reason');
    if (r) r.textContent = reason || '';
    updateReconnectCountdown(secs);
  }

  function updateReconnectCountdown(secs) {
    const c = document.getElementById('net-recon-count');
    if (c) c.textContent = String(Math.max(0, secs));
  }

  function hideReconnectOverlay() {
    const el = document.getElementById('net-reconnecting');
    if (el) el.style.display = 'none';
  }

  // ── Disconnect overlay ────────────────────────────────────────────────────────
  function buildDisconnectOverlay() {
    const el = document.createElement('div');
    el.id = 'net-disconnected';
    Object.assign(el.style, {
      display: 'none', position: 'fixed', inset: '0',
      background: 'rgba(0,0,0,0.82)', zIndex: '500',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '14px',
    });
    el.innerHTML =
      '<div style="font-size:44px">❌</div>' +
      '<div style="color:#fff;font-size:22px;font-weight:bold;font-family:sans-serif">Connection Lost</div>' +
      '<div id="net-disc-reason" style="color:#aaa;font-size:14px;font-family:sans-serif"></div>' +
      '<button id="net-disc-menu" style="margin-top:10px;padding:12px 30px;border:none;border-radius:10px;background:#ffe44d;color:#111;font-size:15px;font-weight:bold;cursor:pointer">Return to Menu</button>';
    document.body.appendChild(el);
    document.getElementById('net-disc-menu').addEventListener('click', () => {
      hideDisconnectOverlay();
      if (window.Game) window.Game.phase = 'menu';
      fullTeardown();
      showScreen('mode');
    });
  }

  function showDisconnectOverlay(reason) {
    const el = document.getElementById('net-disconnected');
    if (el) {
      el.style.display = 'flex';
      const r = document.getElementById('net-disc-reason');
      if (r) r.textContent = reason || '';
    }
  }

  function hideDisconnectOverlay() {
    const el = document.getElementById('net-disconnected');
    if (el) el.style.display = 'none';
  }

  // ── Panel UI ─────────────────────────────────────────────────────────────────
  let panel, statusEl, errorEl, codeValueEl, joinInputEl, connInfoEl, mmStatusEl, pingEl;
  let currentScreen = 'name';

  function buildPanel() {
    buildReconnectOverlay();
    buildDisconnectOverlay();

    panel = document.createElement('div');
    panel.id = 'netplay-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '10px', right: '10px', zIndex: '400',
      background: 'rgba(6,6,18,0.94)', border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: '14px', padding: '14px 16px', color: '#ccc',
      fontFamily: 'sans-serif', fontSize: '13px', width: '220px',
      userSelect: 'none', display: 'none', boxSizing: 'border-box',
    });

    panel.innerHTML =
      '<div style="font-weight:bold;color:#ffe44d;font-size:13px;margin-bottom:12px;letter-spacing:.3px">🌐 Online Play</div>' +

      // ── name screen ──
      '<div class="np-screen" id="np-name">' +
        '<div style="font-size:11px;color:#888;margin-bottom:5px">Your name</div>' +
        '<input id="np-name-input" maxlength="16" placeholder="Enter name…" style="' + iCSS() + '">' +
        '<button id="np-name-ok" style="' + bCSS('#ffe44d','#111') + '">Continue →</button>' +
      '</div>' +

      // ── mode screen ──
      '<div class="np-screen" id="np-mode" style="display:none">' +
        '<div id="np-player-tag" style="font-size:11px;color:#666;margin-bottom:10px;text-align:center"></div>' +
        '<button id="np-quick-btn" style="' + bCSS('#22aa44','#fff') + '">⚡ Quick Match</button>' +
        '<div style="margin:7px 0;text-align:center;color:#383848;font-size:11px">— or manual —</div>' +
        '<button id="np-host-btn" style="' + bCSS('#ffe44d','#111') + '">🎮 Host Game</button>' +
        '<div style="margin:4px 0;text-align:center;color:#383848;font-size:11px">—</div>' +
        '<button id="np-join-btn" style="' + bCSS('#3a6ecc','#fff') + '">🔗 Join Game</button>' +
        '<div style="margin:4px 0;text-align:center;color:#383848;font-size:11px">—</div>' +
        '<button id="np-ai-btn" style="' + bCSS('#1a3a1a','#44bb66') + '">🤖 Practice vs AI</button>' +
      '</div>' +

      // ── matchmaking screen ──
      '<div class="np-screen" id="np-matchmaking" style="display:none">' +
        '<div style="text-align:center;padding:8px 0">' +
          '<div style="font-size:28px;animation:spin 1.5s linear infinite">⚡</div>' +
          '<div id="np-mm-status" style="font-size:11px;color:#aaa;margin-top:8px;line-height:1.5"></div>' +
        '</div>' +
        '<button id="np-mm-cancel" style="' + bCSS('#18182a','#666') + '">✕ Cancel</button>' +
      '</div>' +

      // ── AI difficulty screen ──
      '<div class="np-screen" id="np-ai" style="display:none">' +
        '<div style="font-size:11px;color:#888;margin-bottom:8px;text-align:center">Select difficulty</div>' +
        '<button id="np-ai-easy" style="' + bCSS('#1a2e1a','#88ee88') + '">🟢 Easy</button>' +
        '<button id="np-ai-med" style="' + bCSS('#2a2a0a','#eeee44') + '">🟡 Medium</button>' +
        '<button id="np-ai-hard" style="' + bCSS('#2e1a1a','#ee5544') + '">🔴 Hard</button>' +
        '<button id="np-ai-back" style="' + bCSS('#18182a','#555') + '">← Back</button>' +
      '</div>' +

      // ── hosting screen ──
      '<div class="np-screen" id="np-hosting" style="display:none">' +
        '<div style="text-align:center;margin-bottom:8px">' +
          '<div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Room Code</div>' +
          '<div id="np-code-val" style="font-size:30px;font-weight:bold;letter-spacing:8px;color:#ffe44d;font-family:monospace;padding:4px 0"></div>' +
          '<button id="np-copy-btn" style="' + bCSS('rgba(255,228,77,0.12)','#ffe44d') + '">📋 Copy code</button>' +
        '</div>' +
        '<button id="np-cancel-host" style="' + bCSS('#18182a','#666') + '">✕ Cancel</button>' +
      '</div>' +

      // ── join screen ──
      '<div class="np-screen" id="np-join" style="display:none">' +
        '<div style="font-size:11px;color:#888;margin-bottom:5px">Room code</div>' +
        '<input id="np-join-input" maxlength="8" placeholder="e.g. AB3K7" style="' + iCSS() + 'text-transform:uppercase;letter-spacing:4px;font-size:15px;font-weight:bold;text-align:center">' +
        '<button id="np-join-ok" style="' + bCSS('#3a6ecc','#fff') + '">Connect →</button>' +
        '<div id="np-join-err" style="color:#ff7777;font-size:11px;min-height:14px;margin-top:4px;line-height:1.4"></div>' +
        '<button id="np-back-join" style="' + bCSS('#18182a','#555') + '">← Back</button>' +
      '</div>' +

      // ── connecting screen ──
      '<div class="np-screen" id="np-connecting" style="display:none">' +
        '<div style="color:#aaa;font-size:12px;text-align:center;padding:8px 0">Connecting…</div>' +
      '</div>' +

      // ── connected screen ──
      '<div class="np-screen" id="np-connected" style="display:none">' +
        '<div id="np-conn-info" style="font-size:12px;color:#88ee88;margin-bottom:6px;line-height:1.5"></div>' +
        '<div id="np-ping-info" style="font-size:11px;color:#666;margin-bottom:6px"></div>' +
        '<button id="np-disconnect" style="' + bCSS('#18182a','#666') + '">Disconnect</button>' +
      '</div>' +

      // ── shared status line ──
      '<div id="np-status" style="color:#888;font-size:11px;line-height:1.5;margin-top:8px;min-height:14px"></div>';

    document.body.appendChild(panel);

    statusEl    = panel.querySelector('#np-status');
    codeValueEl = panel.querySelector('#np-code-val');
    joinInputEl = panel.querySelector('#np-join-input');
    connInfoEl  = panel.querySelector('#np-conn-info');
    pingEl      = panel.querySelector('#np-ping-info');
    errorEl     = panel.querySelector('#np-join-err');
    mmStatusEl  = panel.querySelector('#np-mm-status');

    // ── Wire buttons ─────────────────────────────────────────────────────────
    const nameInput = panel.querySelector('#np-name-input');
    panel.querySelector('#np-name-ok').addEventListener('click', () => {
      const n = nameInput.value.trim();
      if (!n) { nameInput.style.outline = '1px solid #ff5555'; return; }
      nameInput.style.outline = '';
      myName = n;
      panel.querySelector('#np-player-tag').textContent = 'Playing as: ' + n;
      window.Leaderboard?.initPlayer(n);
      showScreen('mode');
    });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') panel.querySelector('#np-name-ok').click(); });

    panel.querySelector('#np-quick-btn').addEventListener('click', startMatchmaking);
    panel.querySelector('#np-mm-cancel').addEventListener('click', () => cancelMatchmaking(''));
    panel.querySelector('#np-host-btn').addEventListener('click', hostGame);
    panel.querySelector('#np-join-btn').addEventListener('click', () => showScreen('join'));
    panel.querySelector('#np-ai-btn').addEventListener('click', () => showScreen('ai'));

    panel.querySelector('#np-ai-easy').addEventListener('click', () => { panel.style.display='none'; window.Game.startVsAI('easy'); });
    panel.querySelector('#np-ai-med').addEventListener('click',  () => { panel.style.display='none'; window.Game.startVsAI('medium'); });
    panel.querySelector('#np-ai-hard').addEventListener('click', () => { panel.style.display='none'; window.Game.startVsAI('hard'); });
    panel.querySelector('#np-ai-back').addEventListener('click', () => showScreen('mode'));

    panel.querySelector('#np-copy-btn').addEventListener('click', () => {
      const code = codeValueEl?.textContent.trim();
      if (!code) return;
      const btn = panel.querySelector('#np-copy-btn');
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy code'; }, 2000);
      }).catch(() => { btn.textContent = code; });
    });

    panel.querySelector('#np-cancel-host').addEventListener('click', () => {
      fullTeardown();
      showScreen('mode');
      setStatus('');
    });

    panel.querySelector('#np-join-ok').addEventListener('click', () => {
      const code = joinInputEl.value.trim().toUpperCase();
      if (!code) return;
      setError('');
      const cleaned = code;
      fullTeardown();
      mySlot = 'p2';
      window.localPlayer = 'p2';
      window.playerNames.p2 = myName;
      mode = 'connecting';
      showScreen('connecting');
      setStatus('Connecting to room ' + cleaned + '…');
      joinGame(cleaned);
    });
    joinInputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') panel.querySelector('#np-join-ok').click();
    });
    panel.querySelector('#np-back-join').addEventListener('click', () => {
      showScreen('mode');
      setError('');
    });

    panel.querySelector('#np-disconnect').addEventListener('click', () => {
      fullTeardown();
      if (window.Game) window.Game.phase = 'menu';
      showScreen(myName ? 'mode' : 'name');
      setStatus('Disconnected.');
    });

    // Show panel only when game is in menu phase
    (function tick() {
      panel.style.display = (window.Game?.phase === 'menu') ? 'block' : 'none';
      requestAnimationFrame(tick);
    })();
  }

  // ── UI helpers ────────────────────────────────────────────────────────────────
  function showScreen(name) {
    currentScreen = name;
    panel.querySelectorAll('.np-screen').forEach(el => { el.style.display = 'none'; });
    const target = panel.querySelector('#np-' + name);
    if (target) target.style.display = 'block';
  }

  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  function setError(html)  { if (errorEl)  errorEl.innerHTML  = html; }
  function setRoomCode(code) { if (codeValueEl) codeValueEl.textContent = code; }
  function setMMStatus(txt) { if (mmStatusEl) mmStatusEl.textContent = txt; }

  function updatePingDisplay() {
    if (!pingEl) return;
    if (_rtt < 0) { pingEl.textContent = ''; return; }
    const col = _rtt < 80 ? '#44ee66' : _rtt < 150 ? '#eeee44' : '#ee4444';
    const dot = _rtt < 80 ? '🟢' : _rtt < 150 ? '🟡' : '🔴';
    pingEl.innerHTML = dot + ' <span style="color:' + col + '">' + _rtt + ' ms</span>';
    // Poor connection warning
    if (_rtt > 300) {
      if (!pingEl._warnShown) {
        pingEl._warnShown = true;
        pingEl._warnTimeout = setTimeout(() => { pingEl._warnShown = false; }, 3000);
      }
    }
  }

  function updateConnectedInfo() {
    if (!connInfoEl) return;
    const opp = oppName || '…';
    connInfoEl.innerHTML = mySlot === 'p1'
      ? 'vs <strong>' + esc(opp) + '</strong><br>You are 🟦 Blue (P1)'
      : 'vs <strong>' + esc(opp) + '</strong><br>You are 🟥 Red (P2)';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function bCSS(bg, color) {
    return 'display:block;width:100%;padding:7px 0;margin-top:7px;border:none;border-radius:8px;background:' + bg + ';color:' + color + ';font-size:12px;font-weight:bold;cursor:pointer;letter-spacing:.2px;';
  }

  function iCSS() {
    return 'display:block;width:100%;padding:6px 9px;border-radius:7px;border:1px solid #2a2a3e;background:#0d0d1a;color:#fff;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:4px;';
  }

  buildPanel();
})();
