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

  /* 구장 윤곽 — 그라운드 경계까지의 거리.

     관중석을 홈에서 같은 반지름의 고리로 두르면 과녁판이 된다. 실제 구장은
     홈 뒤에 백네트가 코앞에 붙어 있고 외야는 담장 너머로 멀다. 그 윤곽을
     따라 앉혀야 구단이 주는 좌석배치도처럼 읽힌다.

     0도가 중견수, 180도가 홈 뒤다. 좌우 대칭으로 꺾은선을 그린다. */
  const BOWL = [[0, 330], [45, 272], [90, 152], [135, 88], [180, 58]];

  function bowlAt(a) {
    let k = ((a % 360) + 360) % 360;
    if (k > 180) k = 360 - k;
    for (let i = 1; i < BOWL.length; i++) {
      if (k <= BOWL[i][0]) {
        const p0 = BOWL[i - 1], p1 = BOWL[i];
        return p0[1] + (p1[1] - p0[1]) * (k - p0[0]) / (p1[0] - p0[0]);
      }
    }
    return BOWL[BOWL.length - 1][1];
  }

  /* 구장 윤곽을 따라가는 띠. 안쪽·바깥쪽 반지름이 각도마다 달라지므로
     sectorPath 대신 점을 이어 그린다. */
  function bandPath(cx, cy, d0, d1, a0, a1) {
    let span = a1 - a0;
    if (span <= 0) span += 360;
    const steps = Math.max(2, Math.ceil(span / 3));
    const outer = [], inner = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const b = bowlAt(a);
      outer.push(pt(cx, cy, b + d1, a));
      inner.push(pt(cx, cy, b + d0, a));
    }
    const s2 = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
    return 'M' + s2(outer[0]) + outer.slice(1).map((p) => ' L' + s2(p)).join('') +
      ' L' + s2(inner[inner.length - 1]) +
      inner.slice().reverse().slice(1).map((p) => ' L' + s2(p)).join('') + ' Z';
  }

  function bandCentroid(cx, cy, d0, d1, a0, a1) {
    let span = a1 - a0;
    if (span <= 0) span += 360;
    const a = a0 + span / 2;
    return pt(cx, cy, bowlAt(a) + (d0 + d1) / 2, a);
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

  /* 그라운드.

     전에는 금빛 원을 깔고 다이아몬드 윤곽만 얹었다. 예쁘긴 한데 구단이 주는
     좌석배치도와 닮은 구석이 없어서, 어디가 1루이고 어디가 외야인지 모양으로
     읽히지 않았다. 위에서 내려다본 야구장을 제대로 그린다 —
     외야 잔디, 내야 흙, 베이스 사이 잔디, 파울라인, 베이스, 마운드. */
  function drawField(g, map) {
    const { x: cx, y: cy } = map.home;
    const wall = map.field.wallRadius;
    const base = map.field.baseRadius;

    const poly = (pts, attrs) => g.appendChild(el('polygon', Object.assign({
      points: pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    }, attrs)));

    // 외야 잔디 — 홈에서 담장까지 부채꼴. 파울라인 바깥은 그라운드가 아니다.
    const fan = [pt(cx, cy, 0, 0)];
    for (let a = -45; a <= 45; a += 2) fan.push(pt(cx, cy, bowlAt(a), a));
    poly(fan, { fill: '#2e7a4d' });

    // 담장 앞 워닝트랙
    const wt = [];
    for (let a = -45; a <= 45; a += 2) wt.push(pt(cx, cy, bowlAt(a), a));
    for (let a = 45; a >= -45; a -= 2) wt.push(pt(cx, cy, bowlAt(a) - 14, a));
    poly(wt, { fill: '#a97b51', opacity: '0.9' });

    /* 내야 흙. 실제로는 홈에서 일정 거리까지가 흙이고 그 경계가 호를 그린다.
       그 안쪽에 다시 베이스 사이 잔디가 있다. */
    const dirt = [pt(cx, cy, 0, 0)];
    for (let a = -48; a <= 48; a += 2) dirt.push(pt(cx, cy, base, a));
    poly(dirt, { fill: '#b98a5a' });

    // 베이스 다이아몬드 안쪽 잔디
    const D = base * 0.62;
    const first = pt(cx, cy, D, 45), second = pt(cx, cy, D * 1.34, 0), third = pt(cx, cy, D, -45);
    const homeP = pt(cx, cy, 0, 0);
    const inset = 0.80;
    const ig = [
      pt(cx, cy, D * 0.30, 0),
      [homeP[0] + (first[0] - homeP[0]) * inset, homeP[1] + (first[1] - homeP[1]) * inset],
      [second[0] * inset + homeP[0] * (1 - inset), second[1] * inset + homeP[1] * (1 - inset)],
      [homeP[0] + (third[0] - homeP[0]) * inset, homeP[1] + (third[1] - homeP[1]) * inset]
    ];
    // 다이아몬드 안쪽 잔디는 네 꼭짓점을 조금씩 당긴 마름모다.
    poly([
      [homeP[0], homeP[1] - (homeP[1] - second[1]) * 0.10],
      [first[0] - (first[0] - homeP[0]) * 0.16, first[1] - (first[1] - homeP[1]) * 0.16],
      [second[0], second[1] + (homeP[1] - second[1]) * 0.10],
      [third[0] - (third[0] - homeP[0]) * 0.16, third[1] - (third[1] - homeP[1]) * 0.16]
    ], { fill: '#2e7a4d' });

    // 파울라인
    [[-45, '3루'], [45, '1루']].forEach(([a]) => {
      const e = pt(cx, cy, bowlAt(a), a);
      g.appendChild(el('line', {
        x1: cx, y1: cy, x2: e[0].toFixed(1), y2: e[1].toFixed(1),
        stroke: '#ffffff', 'stroke-width': '2', opacity: '0.85'
      }));
    });

    // 베이스와 마운드
    [first, second, third].forEach((b) => {
      g.appendChild(el('rect', {
        x: (b[0] - 5).toFixed(1), y: (b[1] - 5).toFixed(1), width: '10', height: '10',
        fill: '#ffffff', transform: 'rotate(45 ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + ')'
      }));
    });
    const mound = pt(cx, cy, D * 0.72, 0);
    g.appendChild(el('circle', {
      cx: mound[0].toFixed(1), cy: mound[1].toFixed(1), r: '11',
      fill: '#b98a5a', stroke: '#c9a077', 'stroke-width': '1'
    }));
    // 홈플레이트
    g.appendChild(el('circle', { cx: cx, cy: cy, r: '5', fill: '#ffffff' }));

    // 방향 글자 — 배치도를 볼 때 제일 먼저 찾는 것이 1루·3루다.
    const tag = (r, a, t, size) => {
      const p = pt(cx, cy, r, a);
      const e = el('text', {
        x: p[0].toFixed(1), y: p[1].toFixed(1), 'text-anchor': 'middle',
        'dominant-baseline': 'central', fill: '#ffffff', opacity: '0.8',
        'font-size': String(size), 'font-weight': '800', 'pointer-events': 'none'
      });
      e.textContent = t;
      g.appendChild(e);
    };
    tag(bowlAt(0) * 0.62, 0, '외야', 22);
    tag(base * 1.35, 36, '1루', 15);
    tag(base * 1.35, -36, '3루', 15);
  }

  /* ---------- 구역 ---------- */
  const STYLE = {
    verified:     { fill: '#1d3460', op: 0.92, dash: '' },
    corroborated: { fill: '#1d3460', op: 0.62, dash: '6 4' },
    unplaced:     { fill: '#5d6a85', op: 0.32, dash: '4 5' }
  };

  /* 명당은 응원하는 쪽에 따라 다르다. 광주는 3루가 홈이라, 원정 팬에게
     3루 응원석은 명당이 아니라 피해야 할 자리다. */
  /* 아홉 구역 중 여섯에 메달을 달았더니 "어디가 명당인지" 알 수가 없었다.
     전부가 명당이면 아무 데도 명당이 아니다. 이제 1·2·3위만 표시하고
     나머지는 흐리게 둔다. */
  const MEDALS = ['🥇', '🥈', '🥉'];

  function isMyeongdang(z, fanSide) {
    if (!z.myeongdang) return false;
    if (!z.side || z.side === 'neutral') return true;
    return z.side === fanSide;
  }

  /* 구역을 블록 칸으로 나눠 그린다.

     전에는 구역 하나를 통짜 띠로 칠했다. 그래서 과녁판처럼 보였고, 구단이
     주는 좌석배치도와 닮은 데가 없었다. 실제 배치도는 118·119·120…이 저마다
     칸으로 나뉘어 있고, 그 칸을 보고 표를 고른다.

     블록 번호를 아는 구역은 그 수만큼 나누고 번호를 적는다. 모르는 구역도
     칸으로는 나눈다 — 번호 없이 두더라도 "여러 블록이 늘어선 곳"이라는 것은
     사실이고, 통짜 띠보다 실제에 가깝다. 없는 번호를 지어내지는 않는다. */
  function drawZones(g, map, onPick, fanSide, ranks) {
    const { x: cx, y: cy } = map.home;

    map.zones.forEach((z) => {
      const rank = ranks && ranks[z.id];
      // 순위 밖 구역은 흐리게 — 1·2·3위가 한눈에 들어와야 한다.
      const dim = (ranks && Object.keys(ranks).length && !rank) ? 0.45 : 1;
      const fill = z.fill || '#2d4470';

      let span = z.a1 - z.a0;
      if (span <= 0) span += 360;

      const d0 = z.d0 != null ? z.d0 : 8;
      const d1 = z.d1 != null ? z.d1 : 60;
      const blocks = z.blocks || null;
      // 번호를 모르면 칸 크기가 비슷해 보이도록 각도로 나눈다.
      const n = blocks ? blocks.length : Math.max(2, Math.round(span / 13));
      const gap = Math.min(1.2, span / n * 0.12);      // 칸 사이 틈

      const cell = (i) => {
        const a0 = z.a0 + (span * i) / n + gap / 2;
        const a1 = z.a0 + (span * (i + 1)) / n - gap / 2;
        return { a0, a1 };
      };

      const pick = (ev) => { ev.preventDefault(); ev.stopPropagation(); onPick(z); };

      for (let i = 0; i < n; i++) {
        const { a0, a1 } = cell(i);
        const path = el('path', {
          d: bandPath(cx, cy, d0, d1, a0, a1),
          fill: fill, 'fill-opacity': String(dim),
          stroke: '#0d1a2e', 'stroke-width': '1.2',
          'data-zone': z.id, tabindex: i === 0 ? '0' : '-1',
          role: 'button', style: 'cursor:pointer',
          'aria-label': z.name + (blocks ? ' ' + blocks[i] + '블록' : '') +
            (z.side === 'home' ? ' 홈 응원석' : z.side === 'away' ? ' 원정 응원석' : '')
        });
        path.addEventListener('click', pick);
        path.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') pick(ev);
        });
        g.appendChild(path);

        // 블록 번호. 칸이 좁으면 글자가 넘치므로 칸 크기를 보고 정한다.
        if (blocks) {
          // 번호는 띠 안쪽에, 등급 이름은 바깥쪽에 — 서로 비켜 앉는다.
          const nd = d0 + (d1 - d0) * 0.30;
          const c = bandCentroid(cx, cy, nd, nd, a0, a1);
          const rr = bowlAt((a0 + a1) / 2) + nd;
          const w = (a1 - a0) * Math.PI / 180 * rr;                    // 칸의 호 길이
          const fs = Math.max(9, Math.min(15, Math.min(w * 0.42, (d1 - d0) * 0.3)));
          if (fs >= 9) {
            const t = el('text', {
              x: c[0].toFixed(1), y: c[1].toFixed(1), 'text-anchor': 'middle',
              'dominant-baseline': 'central', fill: z.ink || '#fff',
              'font-size': fs.toFixed(1), 'font-weight': '700',
              'pointer-events': 'none', opacity: String(0.92 * dim)
            });
            t.textContent = blocks[i];
            g.appendChild(t);
          }
        }
      }

      /* 구역 이름은 칸 위에 얹는다. 배치도에서 등급 이름은 블록 번호보다
         크게, 띠 전체에 걸쳐 적혀 있다. */
      const band = d1 - d0;
      const size = Math.max(13, Math.min(21, band * 0.40));
      const label = z.mapLabel || z.name;
      /* 블록 번호가 있는 구역은 이름을 띠 바깥쪽으로 밀어 번호와 비켜 앉힌다.
         가운데에 두면 굵은 이름이 번호를 덮어버려서, 정작 배치도에서 제일
         쓸모 있는 것이 안 보인다. 띠 밖으로 완전히 빼면 화면을 벗어난다. */
      const ld = blocks ? d0 + (d1 - d0) * 0.82 : (d0 + d1) / 2;
      const c = bandCentroid(cx, cy, ld, ld, z.a0, z.a1);

      const t = el('text', {
        x: c[0].toFixed(1), y: c[1].toFixed(1), 'text-anchor': 'middle',
        'dominant-baseline': 'middle', fill: '#ffffff',
        'font-size': size.toFixed(0), 'font-weight': '800', 'pointer-events': 'none',
        stroke: '#0d1a2e', 'stroke-width': '3.5', 'paint-order': 'stroke',
        opacity: String(dim)
      });
      t.textContent = label;
      g.appendChild(t);

      // 명당은 배지가 아니라 핀으로 세운다.
      if (rank && rank <= 3) {
        // 한글은 글자 하나가 글꼴 크기와 거의 같은 폭을 차지한다.
        const half = label.length * size * 0.5 * 0.98;
        const px = c[0] - half - size * 0.95;
        const pin = el('g', { 'pointer-events': 'none', filter: 'url(#kbo-glow)' });
        pin.appendChild(el('circle', {
          cx: px.toFixed(1), cy: c[1].toFixed(1), r: (size * 0.64).toFixed(1),
          fill: rank === 1 ? '#ffd27a' : rank === 2 ? '#dde4ef' : '#e2a874'
        }));
        const m = el('text', {
          x: px.toFixed(1), y: c[1].toFixed(1),
          'text-anchor': 'middle', 'dominant-baseline': 'central',
          'font-size': (size * 0.74).toFixed(1)
        });
        m.textContent = MEDALS[rank - 1];
        pin.appendChild(m);
        g.appendChild(pin);
      }
    });
  }

  function drawFacilities(g, map, onPick) {
    (map.facilities || []).forEach((f) => {
      const pin = el('g', {
        style: 'cursor:pointer', 'data-facility': f.id,
        tabindex: '0', role: 'button', 'aria-label': f.name + ' 안내 보기'
      });
      pin.appendChild(el('circle', {
        cx: f.x, cy: f.y, r: '19', fill: '#ffffff', opacity: '0.94',
        stroke: '#1d3460', 'stroke-width': '1.5'
      }));
      const mark = el('text', {
        x: f.x, y: f.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': '21', 'pointer-events': 'none'
      });
      mark.textContent = f.emoji || '📍';
      pin.appendChild(mark);

      const fire = (ev) => { ev.preventDefault(); ev.stopPropagation(); onPick(f); };
      pin.addEventListener('click', fire);
      pin.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') fire(ev);
      });
      g.appendChild(pin);
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

    /* 손가락을 대자마자 포인터를 붙잡으면 안 된다.

       setPointerCapture를 누르는 즉시 걸었더니, 그 뒤의 click 이벤트가 원래
       눌린 구역이 아니라 svg로 전달됐다. 구역 폴리곤과 시설 핀에 달아둔 click
       리스너가 아예 불리지 않아서, 지도를 눌러도 아무 일도 안 일어났다.

       끌기가 실제로 시작된 뒤에 붙잡는다. 손가락이 6px 넘게 움직이면 그때부터
       끌기로 보고, 그 전까지는 그냥 탭이다. */
    const DRAG = 6;
    let dragging = false, down = null;

    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, e);
      if (pointers.size === 1) {
        down = { cx: e.clientX, cy: e.clientY, id: e.pointerId };
        last = null;
      }
      if (pointers.size === 2) {
        // 손가락 두 개는 곧장 확대·축소다. 탭일 리 없으니 바로 붙잡는다.
        beginDrag(e);
        const [a, b] = [...pointers.values()];
        startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        startW = view.w;
      }
    });

    function beginDrag(e) {
      if (dragging) return;
      dragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 이미 놓친 포인터 */ }
    }

    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      const r = svg.getBoundingClientRect();

      // 문턱을 넘기 전에는 아무것도 하지 않는다 — 손가락은 늘 조금씩 흔들린다.
      if (pointers.size === 1 && !dragging) {
        if (!down) return;
        if (Math.hypot(e.clientX - down.cx, e.clientY - down.cy) < DRAG) return;
        beginDrag(e);
        last = { cx: down.cx, cy: down.cy };
      }

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
      if (!pointers.size) {
        last = null; down = null; dragging = false;
      }
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
    drawZones(gZones, map, handlers.onZone, opts && opts.fanSide, opts && opts.ranks);
    drawFacilities(gFac, map, handlers.onFacility || function () {});
    svg.appendChild(gField); svg.appendChild(gRing);
    svg.appendChild(gZones); svg.appendChild(gFac);
    container.appendChild(svg);
    return wirePanZoom(svg, box);
  }

  window.KboSeatMap = { render, STYLE, isMyeongdang };
})();
