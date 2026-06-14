(function () {
  'use strict';

  const SB_URL = 'https://ntwfxljpgudfqgdyoblk.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50d2Z4bGpwZ3VkZnFnZHlvYmxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NjEyNTYsImV4cCI6MjA5NzAzNzI1Nn0.g8YJ3CxfmKW6CuPt7Zt7WE_bGYRNl7WAzTbIzIjDgaM';

  const BASE_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
  };

  async function sbPost(path, body, extraHeaders) {
    const r = await fetch(SB_URL + path, {
      method: 'POST',
      headers: { ...BASE_HEADERS, ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? r.json() : null;
  }

  window.Leaderboard = {
    async submit({ playerName, won, kos, bestCombo, damage, opponent }) {
      const name = (playerName || '').trim().slice(0, 32);
      if (!name) return;
      try {
        await sbPost('/rest/v1/leaderboard', {
          player_name:  name,
          won:          !!won,
          kos:          kos      || 0,
          best_combo:   bestCombo || 0,
          damage_dealt: damage    || 0,
          opponent:     opponent  || null,
        }, { 'Prefer': 'return=minimal' });
      } catch (e) {
        console.warn('[Leaderboard] submit failed:', e.message);
      }
    },

    async fetchTop(limit) {
      try {
        return await sbPost('/rest/v1/rpc/get_leaderboard', { lim: limit || 20 });
      } catch (e) {
        console.warn('[Leaderboard] fetch failed:', e.message);
        return null;
      }
    },
  };
})();
