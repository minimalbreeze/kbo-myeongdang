/* 경기 서비스.
   가장 중요한 규칙: 날씨로 경기 취소를 추론하지 않는다(지시서 13번).
   status가 없거나 모르면 'unknown'이고, 화면은 공식 발표 링크를 함께 보여준다. */
(function () {
  function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 일정을 어디서 가져오는가.
     config.gamesProxyUrl이 채워져 있으면 그쪽을 먼저 본다. 실패하면 조용히
     번들된 파일로 내려간다 — 중계기가 죽었다고 화면까지 죽으면 안 된다. */
  let cache = null;

  async function source() {
    if (cache) return cache;
    const url = (window.KBO_CONFIG.gamesProxyUrl || '').trim();
    if (url) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          if (d && Array.isArray(d.games)) { cache = d; return cache; }
        }
      } catch (e) { /* 번들된 파일로 내려간다 */ }
    }
    cache = await window.KboData.games();
    return cache;
  }

  async function all() { return (await source()).games || []; }

  async function statusCodes() { return (await source()).statusCodes; }

  function statusOf(game, codes) {
    const key = (game && game.status) || 'unknown';
    return codes[key] || codes.unknown;
  }

  async function todays() {
    const today = ymd(new Date());
    return (await all()).filter((g) => g.date === today);
  }

  async function forStadium(stadiumId, limit) {
    const today = ymd(new Date());
    const list = (await all())
      .filter((g) => g.stadiumId === stadiumId && g.date >= today)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return limit ? list.slice(0, limit) : list;
  }

  async function nextAt(stadiumId) {
    return (await forStadium(stadiumId, 1))[0] || null;
  }

  window.KboGames = { all, todays, forStadium, nextAt, statusCodes, statusOf, ymd };
})();
