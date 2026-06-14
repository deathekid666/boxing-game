(function () {
  'use strict';

  const SB_URL = 'https://ntwfxljpgudfqgdyoblk.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50d2Z4bGpwZ3VkZnFnZHlvYmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjEyNTYsImV4cCI6MjA5NzAzNzI1Nn0.g8YJ3CxfmKW6CuPt7Zt7WE_bGYRNl7WAzTbIzIjDgaM';

  const BASE_HEADERS = {
    'apikey': SB_KEY,
    'Content-Type': 'application/json',
  };

  // ── Auth state ───────────────────────────────────────────────────────────────
  let _uid = null;
  let _accessToken = null;
  let _authReady = false;
  const _authCallbacks = [];

  function _authHeaders() {
    return { ...BASE_HEADERS, 'Authorization': 'Bearer ' + (_accessToken || SB_KEY) };
  }

  function _storeSession(uid, access, refresh, expiresIn) {
    _uid = uid;
    _accessToken = access;
    localStorage.setItem('sb_uid',     uid);
    localStorage.setItem('sb_access',  access);
    localStorage.setItem('sb_refresh', refresh);
    localStorage.setItem('sb_expires', String(Math.floor(Date.now() / 1000) + expiresIn));
  }

  async function _initAuth() {
    const storedUid     = localStorage.getItem('sb_uid');
    const storedAccess  = localStorage.getItem('sb_access');
    const storedRefresh = localStorage.getItem('sb_refresh');
    const storedExpires = parseInt(localStorage.getItem('sb_expires') || '0', 10);

    if (storedUid && storedRefresh) {
      // Token still valid with 60s buffer
      if (storedAccess && (Date.now() / 1000) < storedExpires - 60) {
        _uid = storedUid;
        _accessToken = storedAccess;
        return;
      }
      // Try refresh
      try {
        const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: BASE_HEADERS,
          body: JSON.stringify({ refresh_token: storedRefresh }),
        });
        if (r.ok) {
          const d = await r.json();
          _storeSession(d.user.id, d.access_token, d.refresh_token, d.expires_in);
          return;
        }
      } catch (_) {}
    }

    // Sign in anonymously
    try {
      const r = await fetch(SB_URL + '/auth/v1/signup', {
        method: 'POST',
        headers: BASE_HEADERS,
        body: JSON.stringify({ data: {} }),
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      _storeSession(d.user.id, d.access_token, d.refresh_token, d.expires_in);
    } catch (e) {
      console.warn('[Auth] anonymous sign-in failed:', e.message);
    }
  }

  async function _post(path, body, extra) {
    const r = await fetch(SB_URL + path, {
      method: 'POST',
      headers: { ..._authHeaders(), ...extra },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : null;
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.Leaderboard = {
    get uid() { return _uid; },
    get ready() { return _authReady; },

    async initPlayer(displayName) {
      if (!_uid) return;
      const name = (displayName || '').trim().slice(0, 32);
      if (!name) return;
      try {
        await _post('/rest/v1/players',
          { uid: _uid, display_name: name, updated_at: new Date().toISOString() },
          { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
        );
      } catch (e) {
        console.warn('[Leaderboard] initPlayer failed:', e.message);
      }
    },

    async recordMatchResult({ playerName, won, kos, bestCombo, damage, opponent }) {
      if (!_uid) return;
      const name = (playerName || '').trim().slice(0, 32);
      if (!name) return;
      try {
        await _post('/rest/v1/matches',
          {
            player_uid:   _uid,
            player_name:  name,
            opponent_name: opponent || null,
            won:          !!won,
            kos:          kos       || 0,
            best_combo:   bestCombo || 0,
            damage_dealt: damage    || 0,
          },
          { 'Prefer': 'return=minimal' }
        );
      } catch (e) {
        console.warn('[Leaderboard] recordMatchResult failed:', e.message);
      }
    },

    async getLeaderboard(limit) {
      try {
        return await _post('/rest/v1/rpc/get_leaderboard_v2', { lim: limit || 20 });
      } catch (e) {
        console.warn('[Leaderboard] getLeaderboard failed:', e.message);
        return null;
      }
    },

    async getPlayerStats() {
      if (!_uid) return null;
      try {
        const rows = await _post('/rest/v1/rpc/get_player_stats', { p_uid: _uid });
        return Array.isArray(rows) ? rows[0] || null : rows;
      } catch (e) {
        console.warn('[Leaderboard] getPlayerStats failed:', e.message);
        return null;
      }
    },

    // ── Matchmaking ──────────────────────────────────────────────────────────
    async enterQueue({ playerName, roomCode }) {
      if (!_uid) return null;
      try {
        // Clean up stale entries first
        await fetch(SB_URL + '/rest/v1/rpc/cleanup_queue', {
          method: 'POST', headers: { ..._authHeaders(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({}),
        }).catch(() => {});
        // Remove any previous entry for this uid
        await this.leaveQueue();
        // Insert fresh entry
        await _post('/rest/v1/matchmaking_queue',
          { player_uid: _uid, player_name: (playerName || '').slice(0, 32), room_code: roomCode, status: 'waiting' },
          { 'Prefer': 'return=minimal' }
        );
        return { uid: _uid, roomCode };
      } catch (e) {
        console.warn('[Matchmaking] enterQueue failed:', e.message);
        return null;
      }
    },

    async leaveQueue() {
      if (!_uid) return;
      try {
        await fetch(SB_URL + '/rest/v1/matchmaking_queue?player_uid=eq.' + _uid, {
          method: 'DELETE',
          headers: { ..._authHeaders(), 'Prefer': 'return=minimal' },
        });
      } catch (e) {
        console.warn('[Matchmaking] leaveQueue failed:', e.message);
      }
    },

    // Returns { isHost, roomCode, opponentName } or null if no match yet
    async pollForMatch(myCreatedAt) {
      if (!_uid) return null;
      try {
        const r = await fetch(
          SB_URL + '/rest/v1/matchmaking_queue?status=eq.waiting&order=created_at.asc&limit=5',
          { method: 'GET', headers: _authHeaders() }
        );
        if (!r.ok) return null;
        const rows = await r.json();
        // Find an opponent (not self)
        const opponent = rows.find(row => row.player_uid !== _uid);
        if (!opponent) return null;
        // Earlier timestamp = host
        const myEntry = rows.find(row => row.player_uid === _uid);
        if (!myEntry) return null;
        const iAmHost = new Date(myEntry.created_at) <= new Date(opponent.created_at);
        return {
          isHost: iAmHost,
          roomCode: iAmHost ? myEntry.room_code : opponent.room_code,
          opponentName: opponent.player_name || 'Opponent',
        };
      } catch (e) {
        console.warn('[Matchmaking] pollForMatch failed:', e.message);
        return null;
      }
    },

    // Legacy aliases kept for any existing callers
    async submit(args)     { return this.recordMatchResult(args); },
    async fetchTop(limit)  { return this.getLeaderboard(limit); },
  };

  // Auto-init on load; fire callbacks when done
  _initAuth().finally(() => {
    _authReady = true;
    _authCallbacks.forEach(fn => fn());
  });
})();
