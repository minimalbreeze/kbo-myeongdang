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

  /* 보는 방식
       flat  위에서 내려다본 평면도
       tilt  기울여 본 입체. 위에서 찍어 누른 뒤(세로를 납작하게) 좌석 띠에
             높이를 준다. 바깥 띠일수록 높다 — 실제 스탠드가 그렇게 생겼다.

     라이브러리를 쓰지 않는다. 같은 데이터(각도·반지름)를 다르게 투영할 뿐이라
     구역 누르기·확대·이동이 전부 그대로 동작한다. */
  let MODE = 'flat';
  const TILT = 0.74;    // 세로를 얼마나 납작하게 누를지 (기울여 보는 정도)
  const LIFT = 0.30;    // 스탠드가 올라가는 비율
  const GROUND = 112;   // 이 반지름까지는 바닥이다. 그 바깥부터 관중석이 솟는다.

  /* TILT와 LIFT를 같은 값으로 두면 안 된다.
     홈 뒤(각도 180°)에서 y는 cy + r*TILT - (r-GROUND)*LIFT 가 되는데,
     두 값이 같으면 r이 통째로 상쇄돼 모든 띠가 같은 높이에 겹친다.
     실제로 챔피언석·K9석·테이블석이 한 줄에 포개져 글자가 뭉갰다.
     LIFT를 작게 두면 앞쪽은 촘촘해지고 뒤쪽은 벌어진다 — 그릇을 앞위에서
     내려다볼 때 보이는 모습이다. */

  /* 그릇 모양이 나오려면 안쪽은 바닥에 붙고 바깥 테두리만 올라가야 한다.
     처음에는 반지름에 그냥 비례해 들어 올렸더니 필드까지 같이 떠서
     전체가 "납작해지기만" 했다. 지금은 GROUND 바깥쪽만, 그것도 바닥에서
     멀어진 만큼만 올린다. */
  function lift(r) {
    return MODE === 'tilt' ? Math.max(0, r - GROUND) * LIFT : 0;
  }

  // angle 0 = 위(중견수), 시계방향. SVG는 y가 아래로 자라므로 cos에 음수를 쓴다.
  // ground를 true로 주면 높이를 주지 않는다(그라운드에 그리는 것들).
  function pt(cx, cy, r, a, ground) {
    const x = cx + r * Math.sin(rad(a));
    const y = cy - r * Math.cos(rad(a));
    if (MODE === 'flat') return [x, y];
    return [x, cy + (y - cy) * TILT - (ground ? 0 : lift(r))];
  }

  /* 부채꼴 띠(annulus sector) 하나를 path로 만든다. a1이 a0보다 작으면 0도를 넘어가는 구간이다. */
  function sectorPath(cx, cy, r0, r1, a0, a1, ground) {
    let span = a1 - a0;
    if (span <= 0) span += 360;
    const steps = Math.max(2, Math.ceil(span / 6));
    const outer = [], inner = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      outer.push(pt(cx, cy, r1, a, ground));
      inner.push(pt(cx, cy, r0, a, ground));
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
  function drawField(g, map) {
    const { x: cx, y: cy } = map.home;
    const wall = map.field.wallRadius;
    const base = map.field.baseRadius;

    // 외야 잔디: 파울라인(±45도) 안쪽만
    const [lx, ly] = pt(cx, cy, wall, -45, true);
    const [rx, ry] = pt(cx, cy, wall, 45, true);
    // 기울여 볼 때 외야 잔디는 타원으로 눌린다. 호를 직접 그리는 대신
    // 점을 이어 그려야 눌린 모양이 맞는다.
    const arc = [];
    for (let a = -45; a <= 45; a += 3) arc.push(pt(cx, cy, wall, a, true));
    const home = pt(cx, cy, 0, 0, true);
    g.appendChild(el('path', {
      d: 'M' + home[0].toFixed(1) + ' ' + home[1].toFixed(1) + ' ' +
         arc.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z',
      fill: '#2f7d4f', opacity: '0.30'
    }));

    // 내야 흙
    g.appendChild(el('path', {
      d: sectorPath(cx, cy, 0, base, -45, 45, true),
      fill: '#b98a5a', opacity: '0.45'
    }));

    // 베이스 다이아몬드
    const d1 = pt(cx, cy, base * 0.72, -45, true), d2 = pt(cx, cy, base * 0.72, 0, true), d3 = pt(cx, cy, base * 0.72, 45, true);
    g.appendChild(el('polygon', {
      points: [home, d1, d2, d3].map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '),
      fill: 'none', stroke: '#ffffff', 'stroke-width': '2.5', opacity: '0.75'
    }));

    const label = el('text', {
      x: cx, y: pt(cx, cy, wall * 0.55, 0, true)[1], 'text-anchor': 'middle',
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

  /* 입체일 때 구역의 "옆면". 안쪽 호(r0)를 바닥, 바깥 호(r1)를 천장으로 두면
     둘 사이가 비어 보이므로, 앞쪽 모서리를 아래로 내려 벽을 채운다. */
  function sideWall(cx, cy, r0, r1, a0, a1) {
    let span = a1 - a0;
    if (span <= 0) span += 360;
    const steps = Math.max(2, Math.ceil(span / 6));
    const top = [], bottom = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const p = pt(cx, cy, r0, a);              // 띠의 안쪽 모서리(들어 올려진 높이)
      top.push(p);
      bottom.push(pt(cx, cy, r0, a, true));     // 같은 자리의 그라운드 높이
    }
    bottom.reverse();
    return top.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') +
           ' ' + bottom.map((p) => 'L' + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z';
  }

  function drawZones(g, map, onPick) {
    const { x: cx, y: cy } = map.home;
    // 입체에서는 먼 쪽(홈 뒤)부터 그려야 가까운 쪽이 위에 온다.
    const zones = MODE === 'flat' ? map.zones : map.zones.slice().sort((a, b) => {
      const mid = (z) => { let sp = z.a1 - z.a0; if (sp <= 0) sp += 360; return (z.a0 + sp / 2) % 360; };
      const depth = (z) => Math.cos(rad(mid(z)));   // 중견수 쪽이 멀다
      return depth(b) - depth(a);
    });
    zones.forEach((z) => {
      const st = STYLE[z.verified ? 'verified' : (z.confidence || 'unplaced')] || STYLE.unplaced;
      if (MODE === 'tilt') {
        // 띠의 "앞면". 배경과 같은 색으로 뒀더니 두께가 안 보여서 평면과
        // 다를 바가 없었다. 윗면보다 밝게 칠해야 단이 솟은 것으로 읽힌다.
        g.appendChild(el('path', {
          d: sideWall(cx, cy, z.r0, z.r1, z.a0, z.a1),
          fill: z.verified ? '#33507f' : '#2a3f66',
          'fill-opacity': String(Math.max(0.35, st.op)),
          stroke: '#0b1526', 'stroke-width': '1', 'pointer-events': 'none'
        }));
      }
      const path = el('path', {
        d: sectorPath(cx, cy, z.r0, z.r1, z.a0, z.a1),
        fill: st.fill, 'fill-opacity': st.op,
        stroke: '#ffffff', 'stroke-width': '2', 'stroke-dasharray': st.dash,
        'data-zone': z.id, tabindex: '0', role: 'button',
        'aria-label': z.name + (z.verified ? ' (확인됨)' : ' (확인 중)'),
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
      const size = MODE === 'tilt'
        ? Math.max(11, Math.min(17, band * 0.30))
        : Math.max(13, Math.min(22, band * 0.42));
      const c = centroid(cx, cy, z.r0, z.r1, z.a0, z.a1);
      const t = el('text', {
        x: c[0].toFixed(1), y: c[1].toFixed(1), 'text-anchor': 'middle',
        'dominant-baseline': 'middle', fill: '#ffffff',
        'font-size': size.toFixed(0), 'font-weight': '800', 'pointer-events': 'none',
        opacity: z.verified ? '1' : '0.9'
      });
      // 명당은 지도에서 바로 눈에 띄어야 한다 — 이 앱의 이름이 명당지도다.
      t.textContent = (z.myeongdang ? '🏅 ' : '') + (z.mapLabel || z.name);
      g.appendChild(t);

      // 두꺼운 띠에만 보조 배지를 넣는다. 얇은 곳은 범례와 시트가 대신 알려준다.
      if (!z.verified && band > 70 && MODE === 'flat') {
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

  function render(container, map, handlers, mode) {
    MODE = mode === 'tilt' ? 'tilt' : 'flat';
    container.innerHTML = '';
    let box = map.viewBox.split(/\s+/).map(Number);
    if (MODE === 'tilt') {
      // 실제로 그려진 것의 세로 범위를 재서 뷰박스를 맞춘다.
      // 눈대중으로 잡았더니 위가 잘리거나 아래가 남았다.
      const cy = map.home.y, cx = map.home.x;
      let top = Infinity, bot = -Infinity;
      const touch = (y) => { if (y < top) top = y; if (y > bot) bot = y; };
      (map.zones || []).forEach((z) => {
        for (const a of [z.a0, z.a1, (z.a0 + z.a1) / 2, 0, 90, 180, 270]) {
          touch(pt(cx, cy, z.r1, a)[1]);
          touch(pt(cx, cy, z.r0, a, true)[1]);
        }
      });
      touch(pt(cx, cy, map.field.wallRadius, 0, true)[1]);
      const pad = 40;
      box = [box[0], top - pad, box[2], (bot - top) + pad * 2];
    }
    const svg = el('svg', {
      viewBox: map.viewBox, width: '100%', height: '100%',
      style: 'touch-action:none;display:block', role: 'img',
      'aria-label': '좌석 지도. 구역을 눌러 자세히 보세요.'
    });
    const gField = el('g', {}), gZones = el('g', {}), gFac = el('g', {});
    drawField(gField, map);
    drawZones(gZones, map, handlers.onZone);
    drawFacilities(gFac, map, handlers.onFacility || function () {});
    svg.appendChild(gField); svg.appendChild(gZones); svg.appendChild(gFac);
    container.appendChild(svg);
    return wirePanZoom(svg, box);
  }

  window.KboSeatMap = { render, STYLE };
})();
