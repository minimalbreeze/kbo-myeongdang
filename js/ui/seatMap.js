/* 전체화면 좌석 지도.
   이 서비스의 첫 화면은 목록이 아니라 지도다 — 지도를 보면서 자리를 발견한다.

   신뢰도를 색이 아니라 "선명도 + 배지"로 드러낸다(불꽃축제 명당지도와 같은 방식).
     verified     확인됨        선명
     corroborated 여러 곳에서 일치  약간 흐림 + 점선
     unplaced     위치 미확인     많이 흐림 + 점선
   확인되지 않은 것을 확인된 것처럼 보이게 하지 않는다. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const rad = (d) => (d - 0) * Math.PI / 180;

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  }

  /* 위에서 내려다본 평면도 하나만 그린다.
     기울여 보는 입체도 만들어 봤는데, 세로가 눌려 홈 뒤 구역 글자가 서로 붙고
     보기에도 나아지지 않아 걷어냈다. 자리에서 실제로 어떻게 보이는지는
     구역을 눌렀을 때 나오는 "이 자리에서 보기"(seatView.js)가 맡는다. */

  // angle 0 = 위(중견수), 시계방향. SVG는 y가 아래로 자라므로 cos에 음수를 쓴다.
  function pt(cx, cy, r, a) {
    return [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))];
  }

  /* 부채꼴 띠(annulus sector) 하나를 path로 만든다. a1이 a0보다 작으면 0도를 넘어가는 구간이다. */
  function sectorPath(cx, cy, r0, r1, a0, a1) {
    let span = a1 - a0;
    if (span <= 0) span += 360;
    const steps = Math.max(2, Math.ceil(span / 6));
    const outer = [], inner = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      outer.push(pt(cx, cy, r1, a));
      inner.push(pt(cx, cy, r0, a));
    }
    inner.reverse();
    const d = outer.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') +
              ' ' + inner.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z';
    return d;
  }

  function centroid(cx, cy, r0, r1, a0, a1) {
    let span = a1 - a0;
    if (span <= 0) span += 360;
    return pt(cx, cy, (r0 + r1) / 2, a0 + span / 2);
  }

  /* ---------- 경기장(맥락용 그림) ---------- */
  /* 빛 연출.
     한강 불꽃축제 명당지도는 까만 지도 위에서 불꽃이 터지고 그 주위로 빛의 고리가
     퍼진다. 한눈에 "모두가 보려는 그것"이 어디인지, 내가 얼마나 가까운지가 읽힌다.
     야구장에서 그 자리는 그라운드다. 그래서 그라운드를 빛나게 하고, 홈플레이트에서
     거리 고리를 퍼뜨린다. */
  function drawDefs(svg) {
    const defs = el('defs', {});

    const burst = el('radialGradient', { id: 'kbo-burst' });
    [['0%', '#fff6d8', '0.85'], ['35%', '#ffd27a', '0.34'],
     ['70%', '#7fd6a8', '0.10'], ['100%', '#7fd6a8', '0']].forEach(([o, c, op]) => {
      burst.appendChild(el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op }));
    });
    defs.appendChild(burst);

    const f = el('filter', { id: 'kbo-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
    f.appendChild(el('feGaussianBlur', { stdDeviation: '5', result: 'b' }));
    const merge = el('feMerge', {});
    merge.appendChild(el('feMergeNode', { in: 'b' }));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    f.appendChild(merge);
    defs.appendChild(f);

    svg.appendChild(defs);
  }

  /* 홈플레이트에서 퍼지는 거리 고리. 불꽃축제 지도의 관람 반경 원과 같은 역할이다 —
     "여기서 얼마나 가까운 자리인가"를 눈으로 재게 해준다.
     실측 거리가 아니므로 미터를 적지 않는다. 안쪽·중간·바깥이라고만 말한다. */
  const RINGS = [190, 275, 360];

  function drawRings(g, map) {
    const { x: cx, y: cy } = map.home;
    RINGS.forEach((r, i) => {
      const pts = [];
      for (let a = 0; a < 360; a += 4) pts.push(pt(cx, cy, r, a));
      g.appendChild(el('path', {
        d: pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z',
        fill: 'none', stroke: '#8fe0bb', 'stroke-width': '1',
        'stroke-dasharray': '2 8', opacity: String(0.34 - i * 0.06),
        'pointer-events': 'none'
      }));
    });
  }

  function drawField(g, map) {
    const { x: cx, y: cy } = map.home;
    const wall = map.field.wallRadius;
    const base = map.field.baseRadius;

    // 외야 잔디: 파울라인(±45도) 안쪽만
    const [lx, ly] = pt(cx, cy, wall, -45);
    const [rx, ry] = pt(cx, cy, wall, 45);
    // 그라운드에서 퍼지는 빛. 이 화면에서 가장 밝은 곳이 "모두가 보려는 그것"이어야 한다.
    const glowR = wall * 1.15;
    const gpts = [];
    for (let a = 0; a < 360; a += 6) gpts.push(pt(cx, cy, glowR, a));
    g.appendChild(el('path', {
      d: gpts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z',
      fill: 'url(#kbo-burst)', 'pointer-events': 'none'
    }));

    // 기울여 볼 때 외야 잔디는 타원으로 눌린다. 호를 직접 그리는 대신
    // 점을 이어 그려야 눌린 모양이 맞는다.
    const arc = [];
    for (let a = -45; a <= 45; a += 3) arc.push(pt(cx, cy, wall, a));
    const home = pt(cx, cy, 0, 0);
    g.appendChild(el('path', {
      d: 'M' + home[0].toFixed(1) + ' ' + home[1].toFixed(1) + ' ' +
         arc.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z',
      fill: '#2f7d4f', opacity: '0.30'
    }));

    // 내야 흙
    g.appendChild(el('path', {
      d: sectorPath(cx, cy, 0, base, -45, 45),
      fill: '#b98a5a', opacity: '0.45'
    }));

    // 베이스 다이아몬드
    const d1 = pt(cx, cy, base * 0.72, -45), d2 = pt(cx, cy, base * 0.72, 0), d3 = pt(cx, cy, base * 0.72, 45);
    g.appendChild(el('polygon', {
      points: [home, d1, d2, d3].map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
      fill: 'none', stroke: '#ffffff', 'stroke-width': '2.5', opacity: '0.75'
    }));

    const label = el('text', {
      x: cx, y: pt(cx, cy, wall * 0.55, 0)[1], 'text-anchor': 'middle',
      fill: '#ffffff', opacity: '0.55', 'font-size': '22', 'font-weight': '700'
    });
    label.textContent = '외야';
    g.appendChild(label);
  }

  /* ---------- 구역 ---------- */
  const STYLE = {
    verified:     { fill: '#1d3460', op: 0.92, dash: '' },
    corroborated: { fill: '#1d3460', op: 0.62, dash: '6 4' },
    unplaced:     { fill: '#5d6a85', op: 0.32, dash: '4 5' }
  };

  /* 명당은 응원하는 쪽에 따라 다르다. 광주는 3루가 홈이라, 원정 팬에게
     3루 응원석은 명당이 아니라 피해야 할 자리다. */
  function isMyeongdang(z, fanSide) {
    if (!z.myeongdang) return false;
    if (!z.side || z.side === 'neutral') return true;
    return z.side === fanSide;
  }

  function drawZones(g, map, onPick, fanSide) {
    const { x: cx, y: cy } = map.home;
    map.zones.forEach((z) => {
      const st = STYLE[z.verified ? 'verified' : (z.confidence || 'unplaced')] || STYLE.unplaced;
      const path = el('path', {
        d: sectorPath(cx, cy, z.r0, z.r1, z.a0, z.a1),
        fill: st.fill, 'fill-opacity': st.op,
        stroke: '#ffffff', 'stroke-width': '2', 'stroke-dasharray': st.dash,
        'data-zone': z.id, tabindex: '0', role: 'button',
        'aria-label': z.name + (z.verified ? ' (확인됨)' : ' (확인 중)') +
          (z.side === 'home' ? ' 홈 응원석' : z.side === 'away' ? ' 원정 응원석' : ''),
        style: 'cursor:pointer'
      });
      const pick = (ev) => { ev.preventDefault(); ev.stopPropagation(); onPick(z); };
      path.addEventListener('click', pick);
      path.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') pick(ev);
      });
      g.appendChild(path);

      // 띠가 얇은 구역에서 글자가 넘치지 않도록 두께에 맞춰 크기를 정한다.
      const band = z.r1 - z.r0;
      const size = Math.max(13, Math.min(22, band * 0.42));
      const c = centroid(cx, cy, z.r0, z.r1, z.a0, z.a1);
      const t = el('text', {
        x: c[0].toFixed(1), y: c[1].toFixed(1), 'text-anchor': 'middle',
        'dominant-baseline': 'middle', fill: '#ffffff',
        'font-size': size.toFixed(0), 'font-weight': '800', 'pointer-events': 'none',
        opacity: z.verified ? '1' : '0.9'
      });
      // 명당은 지도에서 바로 눈에 띄어야 한다 — 이 앱의 이름이 명당지도다.
      t.textContent = z.mapLabel || z.name;
      g.appendChild(t);

      // 명당은 배지가 아니라 핀으로 세운다. 불꽃축제 지도에서 명당이 핀으로
      // 꽂혀 있듯이, 이 화면에서도 "여기다" 하고 가리키는 것이 있어야 한다.
      if (isMyeongdang(z, fanSide)) {
        // 글자 폭을 재지 않고도 겹치지 않게, 라벨 길이에서 대략의 폭을 잡아
        // 그 왼쪽에 세운다. 위에 두면 바로 윗 띠와 겹친다.
        const label = z.mapLabel || z.name;
        // 한글은 글자 하나가 글꼴 크기와 거의 같은 폭을 차지한다.
        // 0.62로 잡았더니 핀이 글자를 덮었다.
        const half = label.length * size * 0.5 * 0.98;
        const px = c[0] - half - size * 0.72;
        const pin = el('g', { 'pointer-events': 'none', filter: 'url(#kbo-glow)' });
        pin.appendChild(el('circle', {
          cx: px.toFixed(1), cy: c[1].toFixed(1), r: (size * 0.52).toFixed(1),
          fill: '#ffd27a', opacity: '0.95'
        }));
        const m = el('text', {
          x: px.toFixed(1), y: c[1].toFixed(1),
          'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': (size * 0.62).toFixed(1)
        });
        m.textContent = '🏅';
        pin.appendChild(m);
        g.appendChild(pin);
      }

      // 두꺼운 띠에만 보조 배지를 넣는다. 얇은 곳은 범례와 시트가 대신 알려준다.
      if (!z.verified && band > 70) {
        const badge = el('text', {
          x: c[0].toFixed(1), y: (c[1] + size + 4).toFixed(1), 'text-anchor': 'middle',
          'dominant-baseline': 'middle', fill: '#ffffff', 'font-size': '12.5',
          'pointer-events': 'none', opacity: '0.75'
        });
        badge.textContent = '확인 중';
        g.appendChild(badge);
      }
    });
  }

  function drawFacilities(g, map, onPick) {
    (map.facilities || []).forEach((f) => {
      const mark = el('text', {
        x: f.x, y: f.y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': '26', style: 'cursor:pointer', 'data-facility': f.id,
        tabindex: '0', role: 'button', 'aria-label': f.name
      });
      mark.textContent = f.emoji || '📍';
      mark.addEventListener('click', (ev) => { ev.stopPropagation(); onPick(f); });
      g.appendChild(mark);
    });
  }

  /* ---------- 확대·이동 ---------- */
  function wirePanZoom(svg, box) {
    const view = { x: box[0], y: box[1], w: box[2], h: box[3] };
    const min = box[2] * 0.35, max = box[2] * 1.4;
    const apply = () => svg.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));

    const pointers = new Map();
    let last = null, startDist = 0, startW = 0;

    const toSvg = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: view.x + ((e.clientX - r.left) / r.width) * view.w,
               y: view.y + ((e.clientY - r.top) / r.height) * view.h };
    };

    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, e);
      svg.setPointerCapture(e.pointerId);
      if (pointers.size === 1) last = { cx: e.clientX, cy: e.clientY };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        startW = view.w;
      }
    });

    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      const r = svg.getBoundingClientRect();

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!startDist) return;
        const w = Math.max(min, Math.min(max, startW * (startDist / dist)));
        const k = w / view.w;
        view.x += (view.w - w) / 2; view.y += (view.h - view.h * k) / 2;
        view.w = w; view.h = view.h * k;
        apply();
        return;
      }
      if (!last) return;
      view.x -= ((e.clientX - last.cx) / r.width) * view.w;
      view.y -= ((e.clientY - last.cy) / r.height) * view.h;
      last = { cx: e.clientX, cy: e.clientY };
      apply();
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) startDist = 0;
      if (!pointers.size) last = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toSvg(e);
      const k = e.deltaY > 0 ? 1.12 : 0.89;
      const w = Math.max(min, Math.min(max, view.w * k));
      const ratio = w / view.w;
      view.x = p.x - (p.x - view.x) * ratio;
      view.y = p.y - (p.y - view.y) * ratio;
      view.w = w; view.h *= ratio;
      apply();
    }, { passive: false });

    return { reset() { view.x = box[0]; view.y = box[1]; view.w = box[2]; view.h = box[3]; apply(); } };
  }

  function render(container, map, handlers, opts) {
    container.innerHTML = '';
    const box = map.viewBox.split(/\s+/).map(Number);
    const svg = el('svg', {
      viewBox: map.viewBox, width: '100%', height: '100%',
      style: 'touch-action:none;display:block', role: 'img',
      'aria-label': '좌석 지도. 구역을 눌러 자세히 보세요.'
    });
    drawDefs(svg);
    const gField = el('g', {}), gRing = el('g', {}), gZones = el('g', {}), gFac = el('g', {});
    drawField(gField, map);
    drawRings(gRing, map);
    drawZones(gZones, map, handlers.onZone, opts && opts.fanSide);
    drawFacilities(gFac, map, handlers.onFacility || function () {});
    svg.appendChild(gField); svg.appendChild(gRing);
    svg.appendChild(gZones); svg.appendChild(gFac);
    container.appendChild(svg);
    return wirePanZoom(svg, box);
  }

  window.KboSeatMap = { render, STYLE, isMyeongdang };
})();
