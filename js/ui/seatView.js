/* 이 자리에서 보기.
   좌석 지도가 "어디에 앉을까"라면, 이 화면은 "거기 앉으면 뭐가 보이나"다.
   그라운드에 선수를 세워두고, 손가락으로 돌려가며 둘러볼 수 있게 한다.

   분명히 해둘 것
     이건 사진이 아니라 기하 계산으로 그린 개략도다. 야구장의 표준 배치
     (베이스 27.43m 간격, 마운드 18.44m)와 각 수비 위치는 종목의 규격이라
     지어낸 값이 아니지만, 이 구장의 실제 외야 거리·스탠드 높이는 실측이 없다.
     그래서 화면에 "개략도"라고 적고, 실제 시야 사진이 생기면 그쪽을 우선한다.

   라이브러리를 쓰지 않는다. 원근 투영은 나눗셈 한 번이면 된다. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a) => {
    const x = document.createElementNS(NS, n);
    Object.keys(a || {}).forEach((k) => x.setAttribute(k, a[k]));
    return x;
  };
  const rad = (d) => d * Math.PI / 180;

  // ---------- 그라운드 (미터, 홈플레이트가 원점, +z가 중견수 방향) ----------
  const BASE = 27.43;            // 루간 거리
  const D = BASE / Math.SQRT2;   // 1·3루의 x, z 성분
  const MOUND = 18.44;
  const BASES = { home: [0, 0], first: [D, D], second: [0, D * 2], third: [-D, D] };

  // 표준 수비 위치. 야구의 규격이지 우리가 정한 값이 아니다.
  const PLAYERS = [
    { name: '투수',   pos: [0, MOUND] },
    { name: '포수',   pos: [0, -1.6] },
    { name: '1루수',  pos: [21, 30] },
    { name: '2루수',  pos: [9, 45] },
    { name: '유격수', pos: [-9, 45] },
    { name: '3루수',  pos: [-21, 30] },
    { name: '좌익수', pos: [-44, 80] },
    { name: '중견수', pos: [0, 92] },
    { name: '우익수', pos: [44, 80] },
    { name: '타자',   pos: [-1.2, 0.4], batter: true }
  ];

  const WALL = { corner: 99, center: 121 };   // 개략값. 실측이 생기면 데이터로 뺀다.
  const wallAt = (a) => WALL.center + (WALL.corner - WALL.center) * (Math.abs(a) / 45);

  /* 지도 좌표(각도·반지름)를 좌석의 실제 위치로 옮긴다.

     반지름에 그냥 비례를 곱하면 안 된다. 지도는 개략도라 관중석이 필드에 비해
     크게 그려져 있어서, 그대로 환산하면 홈 뒤 자리가 50m 넘게 멀어지고 그라운드가
     점처럼 작아졌다. 관중석 반지름 구간을 실제 좌석 거리 구간에 맞춰 편다. */
  const STAND_MIN = 112, STAND_MAX = 414;
  const NEAR_M = 18, FAR_M = 135, HIGH_M = 28;

  function seatFromZone(zone) {
    let span = zone.a1 - zone.a0;
    if (span <= 0) span += 360;
    const a = (zone.a0 + span / 2) % 360;
    const r = (zone.r0 + zone.r1) / 2;
    const t = Math.max(0, Math.min(1, (r - STAND_MIN) / (STAND_MAX - STAND_MIN)));
    const meters = NEAR_M + t * (FAR_M - NEAR_M);
    return {
      x: meters * Math.sin(rad(a)),     // 각도 0 = 중견수 방향
      z: meters * Math.cos(rad(a)),
      y: 4 + t * HIGH_M,
      bearing: a
    };
  }

  /* ---------- 카메라 ----------
     좌석에 두고 기본으로 내야 가운데를 본다. yaw/pitch로 둘러본다.
     원근 나눗셈 전에 잘라내기를 해야 하므로 투영을 두 단계로 나눈다. */
  const NEAR = 0.5;

  function makeCamera(seat, yaw, pitch, W, H) {
    const target = [0, 1, 34];
    const base = Math.atan2(target[0] - seat.x, target[2] - seat.z);
    const ay = base + rad(yaw);
    const ax = rad(pitch) - Math.atan2(seat.y - target[1],
      Math.hypot(target[0] - seat.x, target[2] - seat.z));

    const cosY = Math.cos(ay), sinY = Math.sin(ay);
    const cosX = Math.cos(ax), sinX = Math.sin(ax);
    const f = W * 0.80;

    function toCam(p) {
      const dx = p[0] - seat.x, dy = p[1] - seat.y, dz = p[2] - seat.z;
      const rx = dx * cosY - dz * sinY;
      let rz = dx * sinY + dz * cosY;
      const ry = dy * cosX - rz * sinX;
      rz = dy * sinX + rz * cosX;
      return [rx, ry, rz];
    }
    const toScreen = (c) => [W / 2 + f * c[0] / c[2], H / 2 - f * c[1] / c[2], c[2]];
    return { toCam, toScreen };
  }

  /* 근평면 잘라내기.
     처음에는 꼭짓점 하나라도 카메라 뒤에 있으면 도형을 통째로 버렸다. 그랬더니
     옆자리나 외야에서는 홈플레이트가 시야 밖이라 잔디가 아예 사라졌다.
     버리는 대신 근평면에서 잘라 나머지를 그린다(Sutherland–Hodgman). */
  function clipNear(cams) {
    const out = [];
    for (let i = 0; i < cams.length; i++) {
      const a = cams[i], b = cams[(i + 1) % cams.length];
      const ain = a[2] > NEAR, bin = b[2] > NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
      }
    }
    return out;
  }

  function worldPoly(cam, world, attrs) {
    const clipped = clipNear(world.map(cam.toCam));
    if (clipped.length < 3) return null;
    return el('polygon', Object.assign({
      points: clipped.map(cam.toScreen).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    }, attrs));
  }

  function worldLine(cam, a, b, attrs) {
    let ca = cam.toCam(a), cb = cam.toCam(b);
    if (ca[2] <= NEAR && cb[2] <= NEAR) return null;
    if (ca[2] <= NEAR || cb[2] <= NEAR) {
      const t = (NEAR - ca[2]) / (cb[2] - ca[2]);
      const mid = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, NEAR];
      if (ca[2] <= NEAR) ca = mid; else cb = mid;
    }
    const sa = cam.toScreen(ca), sb = cam.toScreen(cb);
    return el('line', Object.assign({
      x1: sa[0].toFixed(1), y1: sa[1].toFixed(1), x2: sb[0].toFixed(1), y2: sb[1].toFixed(1)
    }, attrs));
  }

  /* ---------- 그리기 ----------
     사진을 쓸 수 없으니(남의 사진은 저작권이 있다) 계산해서 그린다.
     대신 도형만 덩그러니 두지 않고, 잔디 결·워닝트랙·담장 패드·파울폴·
     관중 실루엣까지 넣어 실제 구장처럼 보이게 한다.
     그래도 사진이 아니라는 사실은 화면에 그대로 적는다. */

  function defs(svg, id) {
    const d = el('defs', {});
    const sky = el('linearGradient', { id: id + '-sky', x1: '0', y1: '0', x2: '0', y2: '1' });
    [['0%', '#0a1730'], ['55%', '#14284a'], ['100%', '#1d3a63']].forEach(([o, c]) =>
      sky.appendChild(el('stop', { offset: o, 'stop-color': c })));
    d.appendChild(sky);

    const glow = el('radialGradient', { id: id + '-lights' });
    [['0%', '#ffe9b0', '0.30'], ['100%', '#ffe9b0', '0']].forEach(([o, c, op]) =>
      glow.appendChild(el('stop', { offset: o, 'stop-color': c, 'stop-opacity': op })));
    d.appendChild(glow);
    svg.appendChild(d);
  }

  function draw(svg, seat, yaw, pitch, W, H, id) {
    svg.innerHTML = '';
    defs(svg, id);
    const cam = makeCamera(seat, yaw, pitch, W, H);
    const add = (n) => { if (n) svg.appendChild(n); };
    const ring = (r, y, from, to, step) => {
      const out = [];
      for (let a = from; a <= to; a += (step || 2)) out.push([r * Math.sin(rad(a)), y, r * Math.cos(rad(a))]);
      return out;
    };

    // 하늘
    add(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + id + '-sky)' }));
    // 조명 번짐
    add(el('ellipse', { cx: W / 2, cy: H * 0.34, rx: W * 0.7, ry: H * 0.42, fill: 'url(#' + id + '-lights)' }));

    // 외야 담장 너머 관중 실루엣
    const farT = ring(150, 26, -52, 52), farB = ring(150, 0, -52, 52);
    add(worldPoly(cam, farT.concat(farB.slice().reverse()), { fill: '#0d1b33', opacity: '0.9' }));

    // 잔디
    const grass = [[0, 0, 0]].concat(ring(1, 0, 0, 0));
    grass.length = 1;
    for (let a = -45; a <= 45; a += 2) {
      const d2 = wallAt(a);
      grass.push([d2 * Math.sin(rad(a)), 0, d2 * Math.cos(rad(a))]);
    }
    add(worldPoly(cam, grass, { fill: '#2e7a4d' }));

    /* 잔디 결. 실제 구장은 잔디깎이 방향 때문에 줄무늬가 진다.
       이 한 가지로 "도형"이 "그라운드"로 보인다. */
    for (let a = -45; a < 45; a += 10) {
      const b = Math.min(45, a + 5);
      const band = [[0, 0.005, 0]];
      for (let t = a; t <= b; t += 1) {
        const d2 = wallAt(t);
        band.push([d2 * Math.sin(rad(t)), 0.005, d2 * Math.cos(rad(t))]);
      }
      add(worldPoly(cam, band, { fill: '#ffffff', opacity: '0.055' }));
    }

    // 워닝트랙 — 담장 앞 흙띠
    const wtOut = [], wtIn = [];
    for (let a = -45; a <= 45; a += 2) {
      const d2 = wallAt(a);
      wtOut.push([d2 * Math.sin(rad(a)), 0.01, d2 * Math.cos(rad(a))]);
      wtIn.push([(d2 - 5) * Math.sin(rad(a)), 0.01, (d2 - 5) * Math.cos(rad(a))]);
    }
    add(worldPoly(cam, wtOut.concat(wtIn.slice().reverse()), { fill: '#a97b51', opacity: '0.85' }));

    // 내야 흙
    const dirt = [[0, 0.02, -3]].concat(ring(29, 0.02, -52, 52, 3));
    add(worldPoly(cam, dirt, { fill: '#b98a5a' }));

    /* 내야 잔디. 베이스 사이 다이아몬드 안쪽이 잔디이고 루와 루를 잇는 길만 흙이다.
       처음에는 부채꼴로 그렸더니 엉뚱한 덩어리가 됐다. */
    const inset = 4.2;
    add(worldPoly(cam, [
      [0, 0.03, inset * 1.5],
      [D - inset, 0.03, D + inset * 0.2],
      [0, 0.03, D * 2 - inset * 1.2],
      [-(D - inset), 0.03, D + inset * 0.2]
    ], { fill: '#2e7a4d' }));

    // 파울 라인
    [-45, 45].forEach((a) => {
      const d2 = WALL.corner;
      add(worldLine(cam, [0, 0.05, 0], [d2 * Math.sin(rad(a)), 0.05, d2 * Math.cos(rad(a))],
        { stroke: '#fff', 'stroke-width': '2', opacity: '0.85' }));
    });

    // 베이스
    Object.keys(BASES).forEach((k) => {
      const [bx, bz] = BASES[k], sz = 0.65;
      add(worldPoly(cam, [
        [bx - sz, 0.07, bz - sz], [bx + sz, 0.07, bz - sz], [bx + sz, 0.07, bz + sz], [bx - sz, 0.07, bz + sz]
      ], { fill: '#fff' }));
    });

    // 마운드
    const mound = [];
    for (let a = 0; a < 360; a += 12) mound.push([2.7 * Math.cos(rad(a)), 0.08, MOUND + 2.7 * Math.sin(rad(a))]);
    add(worldPoly(cam, mound, { fill: '#c99a6a' }));

    // 외야 담장 + 위쪽 노란 선
    const wt = [], wb = [];
    for (let a = -45; a <= 45; a += 2) {
      const d2 = wallAt(a);
      wb.push([d2 * Math.sin(rad(a)), 0, d2 * Math.cos(rad(a))]);
      wt.push([d2 * Math.sin(rad(a)), 2.6, d2 * Math.cos(rad(a))]);
    }
    add(worldPoly(cam, wt.concat(wb.slice().reverse()), { fill: '#14324f' }));
    for (let i = 0; i < wt.length - 1; i++) {
      add(worldLine(cam, wt[i], wt[i + 1], { stroke: '#f2c14e', 'stroke-width': '1.6', opacity: '0.8' }));
    }

    // 파울폴
    [-45, 45].forEach((a) => {
      const d2 = WALL.corner;
      const x = d2 * Math.sin(rad(a)), z = d2 * Math.cos(rad(a));
      add(worldLine(cam, [x, 0, z], [x, 14, z], { stroke: '#f2c14e', 'stroke-width': '3', opacity: '0.9' }));
    });

    /* 홈플레이트 뒤 백스톱. 내가 앉은 쪽은 그리지 않는다 — 그 뒤에 앉아 있으니
       실제로 안 보이고, 그리면 화면을 통째로 가린다. */
    const seg = [];
    const away = (a) => Math.abs(((a - seat.bearing + 540) % 360) - 180) > 105;
    for (let a = 116; a <= 244; a += 4) { if (away(a)) seg.push(a); else flush(); }
    flush();
    function flush() {
      if (seg.length < 2) { seg.length = 0; return; }
      const t = seg.map((a) => [16 * Math.sin(rad(a)), 4, 16 * Math.cos(rad(a))]);
      const b = seg.map((a) => [16 * Math.sin(rad(a)), 0, 16 * Math.cos(rad(a))]);
      add(worldPoly(cam, t.concat(b.reverse()), { fill: '#132743', opacity: '0.95' }));
      seg.length = 0;
    }

    /* 선수. 먼 쪽부터 그려야 가까운 선수가 위에 온다.
       발밑에 그림자를 깔면 땅에 서 있는 것으로 읽힌다. */
    PLAYERS.map((pl) => {
      const foot = cam.toCam([pl.pos[0], 0, pl.pos[1]]);
      const head = cam.toCam([pl.pos[0], 1.78, pl.pos[1]]);
      if (foot[2] <= NEAR || head[2] <= NEAR) return null;
      return { pl, foot: cam.toScreen(foot), head: cam.toScreen(head), depth: foot[2] };
    }).filter(Boolean).sort((a, b) => b.depth - a.depth).forEach(({ pl, foot, head }) => {
      const h = Math.abs(foot[1] - head[1]);
      if (h < 2.5) return;
      const body = pl.batter ? '#ffd27a' : '#f2f6fc';
      const w = Math.max(2.2, h * 0.24);

      add(el('ellipse', {
        cx: foot[0].toFixed(1), cy: foot[1].toFixed(1),
        rx: (w * 1.5).toFixed(1), ry: (w * 0.5).toFixed(1),
        fill: '#000', opacity: '0.3'
      }));
      add(el('line', {
        x1: foot[0].toFixed(1), y1: foot[1].toFixed(1),
        x2: head[0].toFixed(1), y2: (head[1] + h * 0.30).toFixed(1),
        stroke: body, 'stroke-width': w.toFixed(1), 'stroke-linecap': 'round'
      }));
      add(el('circle', {
        cx: head[0].toFixed(1), cy: head[1].toFixed(1), r: Math.max(2.0, h * 0.20).toFixed(1),
        fill: body
      }));
      if (h > 13) {
        const t = el('text', {
          x: head[0].toFixed(1), y: (head[1] - h * 0.30).toFixed(1), 'text-anchor': 'middle',
          fill: '#dbe5f5', 'font-size': Math.max(9, Math.min(13, h * 0.32)).toFixed(1),
          'pointer-events': 'none'
        });
        t.textContent = pl.name;
        add(t);
      }
    });
  }

  /* ---------- 공개 ---------- */
  function mount(container, zone, opts) {
    const W = (opts && opts.width) || container.clientWidth || 320;
    const H = (opts && opts.height) || Math.round(W * 0.62);
    const seat = seatFromZone(zone);
    // 한 화면에 여러 개를 띄워도 그라디언트 id가 겹치지 않게 한다.
    const id = 'sv' + Math.random().toString(36).slice(2, 8);
    let yaw = 0, pitch = 0;

    container.innerHTML = '';
    const svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: 'auto',
      style: 'touch-action:none;display:block;border-radius:12px;background:#0b1526',
      role: 'img', 'aria-label': zone.name + '에서 본 그라운드 개략도. 끌어서 둘러볼 수 있습니다.'
    });
    container.appendChild(svg);

    const redraw = () => draw(svg, seat, yaw, pitch, W, H, id);
    redraw();

    let last = null;
    svg.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!last) return;
      yaw = Math.max(-70, Math.min(70, yaw + (last.x - e.clientX) * 0.22));
      pitch = Math.max(-25, Math.min(35, pitch - (last.y - e.clientY) * 0.15));
      last = { x: e.clientX, y: e.clientY };
      redraw();
    });
    const end = () => { last = null; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    return {
      reset() { yaw = 0; pitch = 0; redraw(); },
      look(dy) { yaw = Math.max(-70, Math.min(70, yaw + dy)); redraw(); }
    };
  }

  window.KboSeatView = { mount, seatFromZone, PLAYERS };
})();
