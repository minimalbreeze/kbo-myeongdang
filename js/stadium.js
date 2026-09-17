/* 구장 화면 — 지도가 곧 제품이다.
   URL: stadium.html?id=gwangju[&zone=k9][&prefs=focus,cheer]
   공유 링크를 열면 같은 구역 시트가 그대로 열려야 한다(지시서 34·74번). */
(function () {
  const R = window.KboRender;
  const CFG = window.KBO_CONFIG;
  const q = new URLSearchParams(location.search);

  let stadium = null, mapData = null, seatData = { sections: [], seatTypes: [] }, controller = null;
  let placeData = { foods: [], shops: [], facilities: [] };
  let openedZone = null;   // 시트가 지금 보여주는 구역 (버튼 위임에서 쓴다)
  let openedView = null;   // 그 구역의 시야 컨트롤러 (공유 카드가 각도를 물어본다)

  /* 응원하는 쪽. 광주는 3루가 홈(KIA), 1루가 원정이다. 구장마다 다르므로
     데이터의 side를 보고 판단한다. 원정 팬에게 홈 응원석은 명당이 아니다. */
  /* 지도에 1·2·3위를 매길 기준. 홈에서 취향을 고르고 왔으면 그걸 쓰고,
     아니면 종합(경기 집중·응원·가성비)으로 본다. */
  const DEFAULT_PREFS = ['focus', 'cheer', 'value'];
  let ranks = {};
  let redrawMap = null;   // 취향 칩에서 지도를 다시 그리려면 필요하다

  function computeRanks() {
    const prefs = prefIds().length ? prefIds() : DEFAULT_PREFS;
    const list = (seatData.sections || []).filter((sec) =>
      !sec.side || sec.side === 'neutral' || sec.side === fanSide);
    ranks = {};
    window.KboRecommend.rank(list, prefs, 3).forEach((r, i) => {
      ranks[r.section.section] = i + 1;
    });
    return prefs;
  }

  const SIDE_KEY = 'kbo:fanSide';
  let fanSide = 'home';
  const SIDE_LABEL = { home: '홈 응원석', away: '원정 응원석', neutral: '' };

  const sheet = () => document.getElementById('sheet');
  const body = () => document.getElementById('sheet-body');

  function openSheet(html, zone) {
    openedZone = zone || null;
    body().innerHTML = html;
    sheet().dataset.open = 'true';
    sheet().scrollTop = 0;
  }
  function closeSheet() {
    sheet().dataset.open = 'false';
    const u = new URL(location.href);
    u.searchParams.delete('zone');
    history.replaceState(null, '', u.toString());
  }

  const CONFIDENCE = {
    verified:     { badge: '✅ 확인됨',            cls: 'badge-ok' },
    corroborated: { badge: '🟡 확인 중',           cls: 'badge-warn' },
    unplaced:     { badge: '⚪ 위치 미확인',        cls: '' }
  };

  /* ---------- 지도의 시설 핀 ----------
     아이콘만 찍어두고 이름만 보여주면 지도에 점을 찍은 것에 지나지 않는다.
     누르면 그 자리에서 알아야 할 것이 전부 나와야 한다 — 굿즈샵이면 위치와
     무엇을 사면 좋은지까지. */
  function openPlace(f) {
    const all = placeData.foods.concat(placeData.shops, placeData.facilities);
    const d = all.find((x) => x.storeId === f.id || x.id === f.id) || {};

    let html = '<h2>' + (f.emoji ? f.emoji + ' ' : '') + R.esc(f.name) + '</h2>';
    const where = d.location || d.floor || f.kind;
    if (where) html += '<p class="place-where-big">' + R.esc(where) + '</p>';

    if (d.brands && d.brands.length) {
      html += '<div class="place-menu">' + d.brands.map((b) =>
        '<span>' + R.esc(b) + '</span>').join('') + '</div>';
    } else if (d.menu && d.menu.length) {
      html += '<div class="place-menu">' + d.menu.map((mm) =>
        '<span>' + R.esc(mm) + '</span>').join('') + '</div>';
    }

    if (d.description) html += '<p>' + R.esc(d.description) + '</p>';

    // 시설 안내는 여러 줄로 들어온다
    if (d.detail && d.detail.length) {
      html += '<ul class="detail">' + d.detail.map((x) =>
        '<li>' + R.esc(x) + '</li>').join('') + '</ul>';
    }

    // 굿즈샵의 "무엇을 살까"
    if (d.picks && d.picks.length) {
      html += '<h3 style="margin-top:16px">이런 걸 많이 삽니다</h3>';
      html += '<ul class="detail">' + d.picks.map((x) =>
        '<li>' + R.esc(x) + '</li>').join('') + '</ul>';
    }

    if (d.tip) html += '<p class="guide-tip">' + R.esc(d.tip) + '</p>';

    if (d.links && d.links.length) {
      html += '<p>' + d.links.map((l) =>
        '<a class="btn btn-ghost btn-block" href="' + R.esc(l.url) +
        '" target="_blank" rel="noopener">' + R.esc(l.name) + ' ›</a>').join('') + '</p>';
    }
    if (d.note) html += '<p class="meta">' + R.esc(d.note) + '</p>';

    if (!d.description && !d.detail && !d.brands && !d.menu) {
      html += R.emptyBox('이 시설은 아직 정리된 내용이 없습니다.');
    }
    openSheet(html);
    window.KboAnalytics.track('place_view', { stadium: stadium.id, place: f.id });
  }

  /* ---------- 이 구역 어디에 앉을까 ----------
     "K8석은 명당입니다"로 끝내면 아무 말도 안 한 것과 같다. 여섯 블록이 다
     같지 않고, 같은 블록 안에서도 열에 따라 완전히 다른 자리다.
     블록 단위 추천과 열 단위 추천을 구역 설명 끝에 붙인다. */
  function seatPicks(section) {
    const picks = (section && section.pickSeats) || [];
    const rows = (seatData.rowGuide && seatData.rowGuide.picks) || [];
    if (!picks.length && !rows.length) return '';

    let h = '<h3 style="margin-top:18px">🎯 이 구역 어디에 앉을까</h3>';

    if (picks.length) {
      h += '<ul class="picks">' + picks.map((p) =>
        '<li><span class="pick-head"><b>' + R.esc(p.label) + '</b>' +
        '<span class="pick-no">' + p.blocks.map(R.esc).join(' · ') + '</span></span>' +
        '<span class="pick-why">' + R.esc(p.why) + '</span></li>').join('') + '</ul>';
    }

    if (rows.length) {
      h += '<p class="pick-sub">열은 어느 블록이든 같습니다</p>';
      h += '<ul class="picks picks-row">' + rows.map((r) =>
        '<li><span class="pick-head"><b>' + R.esc(r.label) + '</b>' +
        '<span class="pick-no">' + R.esc(r.rows) + '</span></span>' +
        '<span class="pick-why">' + R.esc(r.detail) + '</span></li>').join('') + '</ul>';
    }
    return h;
  }

  /* ---------- 이 자리에서 가는 길 ----------
     자리만 알려주고 끝내면 반쪽이다. 어디로 들어가서 무엇을 먹는지까지가
     "야구장 가기 전에 미리 본다"는 말의 나머지 절반이다. */
  function zoneGuide(section) {
    const g = section && section.guide;
    if (!g) return '';
    let h = '';
    if (g.food) {
      h += '<h3 style="margin-top:18px">🍤 이 자리 먹거리</h3>';
      h += '<div class="guide-card">' +
        '<p class="guide-where">' + R.esc(g.food.where) + '</p>' +
        '<p class="guide-pick"><b>' + R.esc(g.food.pick) + '</b></p>' +
        (g.food.tip ? '<p class="guide-tip">' + R.esc(g.food.tip) + '</p>' : '') +
        '</div>';
    }
    if (g.gate) {
      h += '<h3 style="margin-top:18px">🚪 가까운 출입구</h3>';
      h += '<div class="guide-card"><p class="guide-where">' + R.esc(g.gate.where) + '</p>' +
        (g.gate.tip ? '<p class="guide-tip">' + R.esc(g.gate.tip) + '</p>' : '') + '</div>';
    }
    return h;
  }

  /* ---------- 구역 시트 ---------- */
  function openZone(zone) {
    const key = zone.verified ? 'verified' : (zone.confidence || 'unplaced');
    const c = CONFIDENCE[key];
    const section = seatData.sections.find((s) => s.section === zone.id || s.zoneId === zone.id);

    const MY_LABEL = {
      focus: '경기 집중', cheer: '응원', family: '가족',
      couple: '커플', photo: '사진', value: '가성비'
    };

    let html = '<h2>' + R.esc(zone.name) + '</h2><p>';
    const myRank = ranks[zone.id];
    const side = (section && section.side) || zone.side || 'neutral';
    const mine = side === 'neutral' || side === fanSide;
    if (myRank) {
      html += '<span class="badge badge-my">' + ['🥇', '🥈', '🥉'][myRank - 1] +
        ' 명당 ' + myRank + '위</span> ';
    } else if (section && section.myeongdang && mine) {
      const forWhat = (section.myeongdangFor || []).map((k) => MY_LABEL[k]).filter(Boolean).join('·');
      html += '<span class="badge">🏅 ' + R.esc(forWhat || '추천') + ' 자리</span> ';
    }
    if (SIDE_LABEL[side]) {
      html += '<span class="badge ' + (mine ? 'badge-ok' : 'badge-bad') + '">' +
        (side === 'home' ? '🏠 ' : '✈️ ') + R.esc(SIDE_LABEL[side]) +
        (mine ? '' : ' · 상대 쪽') + '</span> ';
    }
    html += '<span class="badge ' + c.cls + '">' + R.esc(c.badge) + '</span></p>';

    if (section && section.blocks && section.blocks.length) {
      html += '<p class="blocks">블록 ' + section.blocks.map((b) =>
        '<b>' + R.esc(b) + '</b>').join(' · ') + '</p>';
      if (section.blocksNote) html += '<p class="meta">' + R.esc(section.blocksNote) + '</p>';
    }
    if (section && section.basis) html += '<p class="basis">' + R.esc(section.basis) + '</p>';

    /* 구역 하나를 통째로 "명당"이라고 하면 아무 말도 안 한 것과 같다.
       구역 안에서 어느 블록, 어느 열에 앉아야 하는지까지 내려간다. */
    html += seatPicks(section);

    // 평가 — 있으면 별점, 없으면 준비 중
    html += '<h3 style="margin-top:16px">좌석 평가</h3>';
    if (section) {
      if (section.description) html += '<p>' + R.esc(section.description) + '</p>';
      html += '<ul class="scores">' + seatData.scoreFields.map((f) => {
        const v = section[f.key];
        return '<li><span>' + f.emoji + ' ' + R.esc(f.label) + '</span><span>' +
          (typeof v === 'number' ? R.stars(v)
            : '<span class="empty-inline">후기에 언급 없음</span>') + '</span></li>';
      }).join('') + '</ul>';
    } else {
      html += R.emptyBox('이 구역의 평가가 아직 없습니다.');
    }

    // 시야 — 실제 사진이 있으면 그것이 먼저다. 없으면 기하 개략도를 보여준다.
    html += '<h3 style="margin-top:16px">👀 이 자리에서 보기</h3>';
    if (section && section.viewImage) {
      html += '<img src="' + R.esc(section.viewImage) + '" alt="' + R.esc(zone.name) +
        ' 시야 사진" loading="lazy" style="width:100%;border-radius:12px" />';
      if (section.viewSource) html += '<p class="meta">촬영: ' + R.esc(section.viewSource) + '</p>';
    } else {
      html += '<div id="seat-view"></div>' +
        '<p class="view-hint">손가락으로 끌어서 둘러보세요 ↔</p>' +
        '<p class="meta">이 그림은 <b>사진이 아니라 기하 개략도</b>입니다. ' +
        '베이스 간격·마운드 거리·수비 위치는 야구의 규격이지만, 이 구장의 실제 외야 거리와 ' +
        '스탠드 높이는 실측이 아닙니다.</p>';
    }

    // 가격
    html += '<h3 style="margin-top:16px">💰 가격</h3>';
    html += (section && section.price)
      ? '<p><b>' + R.textOr(section.price) + '</b></p>'
      : R.emptyBox('최신 가격 확인 필요');

    html += zoneGuide(section);

    html += '<div class="sheet-actions">' +
      '<button class="btn btn-primary btn-block" type="button" data-act="share">' +
      '🔗 이 자리 공유</button></div>';

    /* 틀린 내용을 바로잡는 통로는 남겨 둔다. 다만 화면 앞에 내세우지 않는다 —
       이 앱은 제보를 모으는 곳이 아니라 흩어진 정보를 정리해 알려주는 곳이다. */
    html += '<p class="fix-line"><button type="button" data-act="report">' +
      '이 구역 정보가 사실과 다른가요?</button></p>';

    openSheet(html, zone);

    const u = new URL(location.href);
    u.searchParams.set('zone', zone.id);
    history.replaceState(null, '', u.toString());

    openedZone = zone;

    // 시야 개략도는 시트가 DOM에 올라간 뒤에 붙인다(폭을 재야 한다).
    const host = body().querySelector('#seat-view');
    openedView = null;
    if (host && window.KboSeatView) {
      try { openedView = window.KboSeatView.mount(host, zone, { width: host.clientWidth || 340 }); }
      catch (e) { host.innerHTML = ''; }
    }

    window.KboAnalytics.track('seat_view', { stadium: stadium.id, zone: zone.id });
  }

  /* ---------- 맞춤 추천 ----------
     홈에서 고른 취향(?prefs=focus,cheer)으로 순위를 매겨 보여준다.
     지도 우선으로 다시 만들면서 이걸 읽는 쪽이 사라져 있었다. */
  function prefIds() {
    return (q.get('prefs') || '').split(',').filter(Boolean);
  }

  function openRecommend() {
    const prefs = prefIds();
    const labels = prefs
      .map((id) => (window.KboRecommend.PREFS.find((p) => p.id === id) || {}).label)
      .filter(Boolean);

    let html = '<h2>🎯 나에게 맞는 자리</h2>';
    html += '<p style="margin:0 0 10px;color:var(--dim);font-size:14.5px">' +
      '무엇이 가장 중요하세요? 고르면 지도의 1·2·3위가 바뀝니다.</p>';
    html += '<div class="chips" id="rec-prefs">' + window.KboRecommend.PREFS.map((p) =>
      '<button class="chip" type="button" data-pick="' + p.id + '" aria-pressed="' +
      (prefs.includes(p.id) ? 'true' : 'false') + '">' + p.emoji + ' ' + R.esc(p.label) +
      '</button>').join('') + '</div>';
    html += '<p class="meta">' + R.esc(labels.length ? labels.join(' · ') + ' 기준' : '종합 기준') + '</p>';

    const use = prefs.length ? prefs : DEFAULT_PREFS;
    const pool = (seatData.sections || []).filter((sec) =>
      !sec.side || sec.side === 'neutral' || sec.side === fanSide);
    const ranked = window.KboRecommend.rank(pool, use);
    if (!ranked.length) {
      html += R.emptyBox('아직 이 구장에는 점수가 매겨진 구역이 없습니다.');
    } else {
      html += ranked.map((r, i) => {
        const sec = r.section;
        return '<button class="rank rank-btn" type="button" data-zone-id="' + R.esc(sec.section) + '">' +
          '<span class="medal">' + ['🥇', '🥈', '🥉'][i] + '</span>' +
          '<span class="rank-body"><b>' + R.esc(sec.seatName || sec.section) + '</b>' +
          '<span class="badge">명당 점수 ' + r.score + '</span>' +
          (sec.description ? '<span class="rank-desc">' + R.esc(sec.description) + '</span>' : '') +
          '</span></button>';
      }).join('');
      html += '<p class="meta">누르면 그 구역을 자세히 볼 수 있습니다.</p>';
      // 1위 점수가 낮으면 "이게 최선"이 아니라 "아직 모른다"는 뜻이다. 그렇게 말한다.
      if (ranked[0].score < 50) {
        html += '<p class="disclaimer">이 취향에 대해서는 아직 모아둔 후기가 적습니다. ' +
          '순위는 참고만 하시고, 직접 가보신 뒤 제보해주시면 다음 사람에게 도움이 됩니다.</p>';
      }
    }
    html += '<p class="disclaimer">' + R.esc(CFG.scoreDisclaimer) + '</p>';
    openSheet(html);
  }

  /* ---------- 제보 ----------
     불꽃축제 지도는 사용자 제보로 데이터를 채웠다. 우리도 같은 길을 가되,
     서버 없이 오늘 동작하는 방법으로 시작한다(js/ui/report.js). */
  function openReport(zone) {
    const ctx = {
      stadiumId: stadium.id,
      stadiumName: stadium.name,
      zone: zone || null,
      zones: (mapData && mapData.zones) || []
    };
    openSheet(window.KboReport.render(ctx));
    window.KboReport.wire(body(), ctx);
  }

  /* ---------- 오늘의 직관(경기 + 날씨 + 구장 정보) ---------- */
  async function openBriefing() {
    openSheet('<h2>오늘의 직관</h2><div class="empty">불러오는 중…</div>');
    const officialLink = '<a href="' + R.esc(CFG.officialStatusUrl) +
      '" target="_blank" rel="noopener">공식 일정·경기 상태 확인하기 ›</a>';

    let html = '<h2>오늘의 직관</h2>';

    // 경기 — 날씨로 취소를 추론하지 않는다.
    let game = null;
    try {
      const [g, codes] = await Promise.all([
        window.KboGames.nextAt(stadium.id), window.KboGames.statusCodes()
      ]);
      game = g;
      html += '<h3>⚾ 경기</h3>';
      if (game) {
        const st = window.KboGames.statusOf(game, codes);
        html += '<p><b>' + R.textOr(game.awayName) + ' vs ' + R.textOr(game.homeName) + '</b><br>' +
          R.textOr(game.date) + ' ' + R.textOr(game.time) + '</p>' +
          '<p><span class="badge">' + R.esc(st.emoji) + ' ' + R.esc(st.label) + '</span></p>';
      } else {
        html += R.emptyBox('등록된 경기 정보가 아직 없습니다.');
      }
      html += '<p class="meta">' + officialLink + '</p>';
    } catch (e) {
      html += '<h3>⚾ 경기</h3>' + R.emptyBox('경기 정보를 불러오지 못했습니다.');
    }

    // 날씨
    html += '<h3 style="margin-top:18px">🌤️ 직관 날씨</h3>';
    try {
      const w = await window.KboWeather.forStadium(stadium);
      const gameAt = game && game.date && game.time ? game.date + 'T' + game.time : null;
      const near = window.KboWeather.aroundGameTime(w, gameAt);
      const hours = near.length ? near : w.hourly.slice(0, 6);
      html += '<div class="weather-now"><span class="emoji">' + R.esc(w.emoji) + '</span>' +
        '<div><div class="temp">' + R.textOr(w.temperature, '℃') + '</div>' +
        '<div class="cond">' + R.esc(w.condition) + ' · 체감 ' + R.textOr(w.feelsLike, '℃') +
        ' · 바람 ' + R.textOr(w.wind, 'm/s') + '</div></div></div>' +
        '<div class="index-score">' + R.esc(w.index.emoji) + ' <b>직관지수 ' + w.index.score +
        '</b> <span class="cond">' + R.esc(w.index.line) + '</span></div>' +
        '<p class="meta" style="margin:12px 0 0">' +
          R.esc(near.length ? '경기 시간 전후 예보' : '앞으로의 예보') + '</p>' +
        '<div class="hourly">' + hours.map((h) =>
          '<div><div class="h">' + R.esc(String(h.time).slice(11, 16)) + '</div>' +
          '<div class="t">' + R.textOr(h.temperature != null ? Math.round(h.temperature) : null, '℃') + '</div>' +
          '<div class="p">💧' + R.textOr(h.rainProbability, '%') + '</div></div>').join('') + '</div>' +
        '<p class="disclaimer">' + R.esc(CFG.weatherDisclaimer) + '</p>';
      window.KboAnalytics.track('weather_view', { stadium: stadium.id });
    } catch (e) {
      html += R.emptyBox('현재 날씨 정보를 불러오지 못했습니다.');
    }

    // 구장 안의 것들
    const blocks = [
      ['🍗 먹거리', await safe(() => window.KboData.foods(stadium.id)), 'food_view', (x) => x.storeName],
      ['🧢 굿즈샵', await safe(() => window.KboData.shops(stadium.id)), 'shop_view', (x) => x.name],
      ['🚻 편의시설', await safe(() => window.KboData.facilities(stadium.id)), 'facility_view', (x) => x.name]
    ];
    blocks.forEach(([title, items, ev, pick]) => {
      html += '<h3 style="margin-top:18px">' + title + '</h3>';
      if (items && items.length) {
        html += items.map((x) =>
          '<div class="place">' +
          '<div class="place-top"><b>' + R.textOr(pick(x)) + '</b>' +
          '<span class="place-where">' + R.textOr(x.location) + '</span></div>' +
          (x.menu && x.menu.length
            ? '<div class="place-menu">' + x.menu.map((mm) =>
                '<span>' + R.esc(mm) + '</span>').join('') + '</div>' : '') +
          (x.description ? '<p class="place-desc">' + R.esc(x.description) + '</p>' : '') +
          '</div>').join('');
        window.KboAnalytics.track(ev, { stadium: stadium.id });
      } else {
        html += R.emptyBox('정보 준비 중');
      }
    });

    // 이벤트 존
    const evs = await safe(() => window.KboData.events(stadium.id));
    html += '<h3 style="margin-top:18px">🎪 이벤트 존</h3>';
    html += (evs && evs.length)
      ? evs.map((e) => '<div class="place"><div class="place-top"><b>' + R.textOr(e.name) + '</b>' +
          '<span class="place-where">' + R.textOr(e.location) + '</span></div>' +
          (e.description ? '<p class="place-desc">' + R.esc(e.description) + '</p>' : '') +
          '</div>').join('') + '<p class="meta">행사는 시즌·경기마다 바뀝니다.</p>'
      : R.emptyBox('이벤트 존 정보 준비 중');

    // 교통
    const t = await safe(() => window.KboData.transport(stadium.id));
    html += '<h3 style="margin-top:18px">🚇 교통</h3>';
    html += [['🚇 지하철', t && t.subway], ['🚌 버스', t && t.bus],
             ['🅿️ 주차', t && t.parking && t.parking.note],
             ['🚶 출입구', t && t.entrance]]
      .map((r) => '<div class="place"><div class="place-top"><b>' + R.esc(r[0]) + '</b></div>' +
        '<p class="place-desc">' + R.textOr(r[1]) + '</p></div>').join('');
    if (t && t.tips) html += '<p class="basis">' + R.esc(t.tips) + '</p>';
    html += R.meta(t && t.updatedAt, t && t.sources);
    html += '<p class="meta">검증되지 않은 정보는 표시하지 않습니다.</p>';

    // 구장 기본정보
    html += '<h3 style="margin-top:18px">🏟️ 구장 정보</h3><ul class="scores">' +
      [['주소', stadium.address], ['개장', stadium.openedYear],
       ['좌석 수', stadium.verified.capacity ? stadium.capacity : null]]
        .map((r) => '<li><span>' + r[0] + '</span><span>' + R.textOr(r[1]) + '</span></li>').join('') +
      '</ul>' + R.meta(stadium.updatedAt, stadium.sources);

    // 예매 — 확인된 링크가 있을 때만 버튼이 산다.
    html += '<div class="sheet-actions">';
    html += (stadium.ticket && stadium.ticket.url)
      ? '<a class="btn btn-primary" href="' + R.esc(stadium.ticket.url) +
        '" target="_blank" rel="noopener" data-ticket="1">🎟️ 예매하기</a>'
      : '<button class="btn btn-ghost" type="button" disabled>공식 예매 정보 준비 중</button>';
    html += '</div>';

    openSheet(html);
    const tk = body().querySelector('[data-ticket]');
    if (tk) tk.addEventListener('click', () =>
      window.KboAnalytics.track('ticket_click', { stadium: stadium.id }));
  }

  async function safe(fn) { try { return await fn(); } catch (e) { return null; } }

  /* ---------- 헤더 날씨 칩 ---------- */
  async function fillWeatherChip() {
    const chip = document.getElementById('wx-chip');
    try {
      const w = await window.KboWeather.forStadium(stadium);
      chip.textContent = w.emoji + ' ' + (w.temperature != null ? w.temperature + '℃' : '') +
        ' · 직관지수 ' + w.index.score;
    } catch (e) {
      chip.textContent = '오늘의 직관 ›';
    }
  }

  (async function init() {
    const id = q.get('id');
    stadium = await safe(() => window.KboData.stadium(id));

    if (!stadium) {
      document.getElementById('stadium-name').textContent = '구장을 찾을 수 없습니다';
      openSheet('<h2>구장을 찾을 수 없습니다</h2>' +
        R.emptyBox('구장 정보를 불러오지 못했습니다.') +
        '<p><a class="btn btn-block" href="./">홈으로</a></p>');
      return;
    }

    document.title = stadium.name + ' 좌석 지도 | 시야·평가·가격 — KBO 명당지도';
    document.getElementById('stadium-name').textContent = stadium.name;
    window.KboAnalytics.track('stadium_view', { stadium: stadium.id });

    seatData = (await safe(() => window.KboData.seats(stadium.id))) || seatData;
    /* 지도의 시설 핀은 누르는 즉시 내용이 나와야 한다. 그때 가서 받아오면
       빈 시트가 먼저 뜬다. 지도를 그리기 전에 같이 받아 둔다. */
    placeData = {
      foods: (await safe(() => window.KboData.foods(stadium.id))) || [],
      shops: (await safe(() => window.KboData.shops(stadium.id))) || [],
      facilities: (await safe(() => window.KboData.facilities(stadium.id))) || []
    };
    mapData = await safe(() => window.KboData.load('map/' + stadium.id + '.json'));

    const host = document.getElementById('seat-map');
    try { fanSide = localStorage.getItem(SIDE_KEY) === 'away' ? 'away' : 'home'; } catch (e) {}

    function drawMap() {
      redrawMap = drawMap;
      computeRanks();
      controller = window.KboSeatMap.render(host, mapData, {
        onZone: openZone,
        onFacility: openPlace
      }, { fanSide: fanSide, ranks: ranks });
      const basis = prefIds().length
        ? prefIds().map((id) => (window.KboRecommend.PREFS.find((p) => p.id === id) || {}).label)
            .filter(Boolean).join(' · ')
        : '종합';
      const bar = document.getElementById('rank-bar');
      bar.innerHTML = '🥇 <b>' + R.esc(basis) + '</b> 기준 명당 1·2·3위 ' +
        '<button type="button" id="rank-change">바꾸기</button>';
      bar.hidden = false;
      document.getElementById('rank-change').addEventListener('click', openRecommend);

      const b = document.getElementById('side-btn');
      b.textContent = fanSide === 'away' ? '✈️ 원정 팬' : '🏠 홈 팬';
      b.title = '누르면 ' + (fanSide === 'away' ? '홈' : '원정') + ' 팬 기준으로 바뀝니다';
    }

    if (mapData) {
      drawMap();
      document.getElementById('side-btn').addEventListener('click', () => {
        fanSide = fanSide === 'away' ? 'home' : 'away';
        try { localStorage.setItem(SIDE_KEY, fanSide); } catch (e) {}
        drawMap();
        window.KboShare.toast(fanSide === 'away' ? '원정 팬 기준으로 봅니다 ✈️' : '홈 팬 기준으로 봅니다 🏠');
      });
      // 개략도라는 사실은 범례 안에 둔다 — 화면 위에 떠다니는 글이 하나 줄어든다.
      if (mapData.schematic) {
        const note = document.createElement('div');
        note.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #e7ecf4;color:#5d6a85';
        note.textContent = '구역 배치 개략도입니다.';
        document.getElementById('legend').appendChild(note);
      }
    } else {
      host.innerHTML = '<div style="color:#cdd8ea;display:grid;place-items:center;height:100%;padding:24px;text-align:center">' +
        '좌석 지도 준비 중입니다.</div>';
    }

    document.getElementById('sheet-close').addEventListener('click', closeSheet);

    // 키보드로도 시트를 닫을 수 있어야 한다. 지금까지는 ✕ 버튼밖에 없었다.
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && sheet().dataset.open === 'true') closeSheet();
    });

    // 추천 목록에서 구역으로 건너뛰기
    body().addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-zone-id]');
      if (!b || !mapData) return;
      const zone = mapData.zones.find((z) => z.id === b.dataset.zoneId);
      if (zone) openZone(zone);
    });

    /* 취향 칩. 누르면 순위 기준이 바뀌고 지도의 1·2·3위가 즉시 다시 매겨진다.
       기준은 URL에 남겨서, 그 링크를 받은 친구도 같은 순위를 본다. */
    body().addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pick]');
      if (!b) return;
      const picked = prefIds();
      const i = picked.indexOf(b.dataset.pick);
      if (i >= 0) picked.splice(i, 1); else picked.push(b.dataset.pick);
      if (picked.length) q.set('prefs', picked.join(',')); else q.delete('prefs');
      history.replaceState(null, '', location.pathname + '?' + q.toString());
      if (redrawMap) redrawMap();
      openRecommend();
      window.KboAnalytics.track('seat_recommend', { stadium: stadium.id, prefs: picked.join(',') });
    });

    // 시트 안 버튼은 위임으로 한 번만 연결한다.
    // (시트를 열 때마다 붙이면 리스너가 쌓여 공유가 여러 번 실행된다)
    body().addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b || !openedZone) return;
      if (b.dataset.act === 'share') {
        const zone = openedZone;
        const text = CFG.shareCopy.seat(stadium.name, zone.name);
        const url = location.href;
        if (window.KboShareCard && window.KboSeatView) {
          const angle = openedView ? openedView.angle() : { yaw: 0, pitch: 0 };
          const sec = seatData.sections.find((x) => x.section === zone.id || x.zoneId === zone.id);
          window.KboShare.shareImage(
            () => window.KboShareCard.build({
              stadiumName: stadium.name, zone: zone, section: sec,
              rank: ranks[zone.id], side: (sec && sec.side) || zone.side,
              yaw: angle.yaw, pitch: angle.pitch
            }),
            'kbo-myeongdang-' + zone.id + '.png', text, url);
        } else {
          window.KboShare.share(text, url);
        }
        window.KboAnalytics.track('seat_share', { stadium: stadium.id, zone: openedZone.id });
      } else {
        openReport(openedZone);
      }
    });
    document.getElementById('reset-btn').addEventListener('click', () => controller && controller.reset());
    document.getElementById('rec-btn').addEventListener('click', openRecommend);
    document.getElementById('wx-chip').addEventListener('click', openBriefing);

    fillWeatherChip();

    // 공유 링크로 들어온 경우 그 구역을 바로 연다.
    const z = q.get('zone');
    if (z && mapData) {
      const zone = mapData.zones.find((x) => x.id === z);
      if (zone) openZone(zone);
    } else if (prefIds().length) {
      // 홈에서 취향을 고르고 왔으면 추천부터 보여준다.
      openRecommend();
      window.KboAnalytics.track('seat_recommend', { stadium: stadium.id, prefs: prefIds().join(',') });
    }
  })();
})();
