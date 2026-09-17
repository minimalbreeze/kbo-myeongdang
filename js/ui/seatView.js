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
    { name: '포수',   pos: [0, -1.6], labelBelow: true },   // 타자와 겹치지 않게 아래로
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

  /* 관중석 앞면까지의 거리.

     한동안 관중석을 반지름 145m 원으로 빙 둘렀다. 그런데 실제 야구장은
     원형이 아니다 — 홈 뒤는 백네트가 코앞에 붙어 있고 외야는 담장 너머로
     멀다. 원으로 두르니 외야석에서 홈플레이트 쪽을 볼 때 관중석이 120m쯤
     더 멀리 물러나 앉아, 홈플레이트 뒤가 텅 빈 초록 벌판으로 보였다.

     0도(중견수)에서 180도(홈 뒤)까지 꺾은선으로 잡는다. */
  const BOWL = [[0, 128], [45, 106], [90, 55], [135, 32], [180, 26]];

  function bowlAt(a) {
    let k = ((a % 360) + 360) % 360;
    if (k > 180) k = 360 - k;                  // 좌우 대칭
    for (let i = 1; i < BOWL.length; i++) {
      if (k <= BOWL[i][0]) {
        const p0 = BOWL[i - 1], p1 = BOWL[i];
        return p0[1] + (p1[1] - p0[1]) * (k - p0[0]) / (p1[0] - p0[0]);
      }
    }
    return BOWL[BOWL.length - 1][1];
  }
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
     좌석에 두고 내야 전체가 들어오도록 자동으로 잡는다. yaw/pitch로 둘러본다.
     원근 나눗셈 전에 잘라내기를 해야 하므로 투영을 두 단계로 나눈다. */
  const NEAR = 0.5;

  /* 자동 프레이밍.

     처음에는 어느 자리에서든 고정된 한 점(중견수 쪽 34m)을 바라보게 했다.
     홈 뒤에서는 잘 맞았지만 1·3루 쪽 자리에서는 홈플레이트가 화면 오른쪽
     끝으로 밀려나고 왼쪽 절반이 텅 비었다. 자리가 옆으로 갈수록 홈플레이트와
     그 한 점의 방향이 크게 벌어지기 때문이다.

     그래서 한 점을 보는 대신, 꼭 보여야 하는 것들(홈플레이트와 1·2·3루)의
     방향을 재서 그 가운데를 보고, 전부 들어갈 만큼만 당긴다.
     기준점은 내야 네 꼭짓점만 쓴다. 처음에는 "얕은 외야(중견수 앞 74m)"도
     넣었는데, 좌익수 쪽 구석 자리(EV석 3루)에서는 그 점과 홈플레이트의 방향이
     100도 가까이 벌어진다. 둘 사이를 보면 홈플레이트가 화면 밖으로 나간다.
     홈플레이트는 그라운드에서 제일 중요한 지점이다. 반드시 화면 안에 둔다. */
  const KEY = [
    [0, 1, 0],                 // 홈플레이트 — 이게 화면에서 밀려나면 안 된다
    [D, 1, D],                 // 1루
    [-D, 1, D],                // 3루
    [0, 1, D * 2]              // 2루
  ];

  function frame(seat, W) {
    const angs = KEY.map((p) => Math.atan2(p[0] - seat.x, p[2] - seat.z));
    // 방향이 ±180도를 넘나들 수 있으므로 첫 점을 기준으로 접어서 비교한다.
    const ref = angs[0];
    const rel = angs.map((a) => {
      let d = a - ref;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    });
    const lo = Math.min.apply(null, rel), hi = Math.max.apply(null, rel);
    /* 네 점의 한가운데를 보면 홈플레이트가 화면 가장자리에 몰린다(3루 바깥
       K5석에서 가로 84% 지점). 홈플레이트 쪽으로 20%만 시선을 당기고,
       그만큼 화각을 넓혀 반대쪽 2루도 화면에 남긴다. rel의 기준점이
       홈플레이트이므로 0으로 당기면 된다. */
    const mid = (lo + hi) / 2;
    const center = mid * 0.8;
    const half = Math.max(0.20, Math.max(hi - center, center - lo));
    const dist = KEY.reduce((sum, p) =>
      sum + Math.hypot(p[0] - seat.x, p[2] - seat.z), 0) / KEY.length;
    return {
      base: ref + center,
      // 내야가 가로 폭의 68% 안에 들어오게 — 나머지는 외야와 관중석 몫이다.
      // 화각이 극단으로 가지 않도록 묶는다.
      f: Math.max(W * 0.42, Math.min(W * 0.90, W * 0.34 / Math.tan(half))),
      dist: dist
    };
  }

  function makeCamera(seat, yaw, pitch, W, H) {
    const fr = frame(seat, W);
    const ay = fr.base + rad(yaw);
    const ax = rad(pitch) - Math.atan2(seat.y - 1, fr.dist);

    const cosY = Math.cos(ay), sinY = Math.sin(ay);
    const cosX = Math.cos(ax), sinX = Math.sin(ax);
    const f = fr.f;

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
    /* 카메라 뒤에 있는 조각은 아예 만들지 않는다.
       한 바퀴를 전부 그리다 보니 손가락으로 끌 때마다 SVG 노드를 1700개씩
       새로 찍고 있었다. 절반은 등 뒤라 보이지도 않는다. */
    const behind = (a, r) =>
      cam.toCam([r * Math.sin(rad(a)), 10, r * Math.cos(rad(a))])[2] <= NEAR;

    const ring = (r, y, from, to, step) => {
      const out = [];
      for (let a = from; a <= to; a += (step || 2)) out.push([r * Math.sin(rad(a)), y, r * Math.cos(rad(a))]);
      return out;
    };

    // 하늘
    add(el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + id + '-sky)' }));
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 7919) % 1000) / 1000 * W;
      const sy = ((i * 104729) % 1000) / 1000 * H * 0.42;
      add(el('circle', { cx: sx.toFixed(1), cy: sy.toFixed(1),
        r: (0.6 + (i % 3) * 0.35).toFixed(1), fill: '#fff', opacity: '0.35' }));
    }
    // 조명 번짐
    add(el('ellipse', { cx: W / 2, cy: H * 0.34, rx: W * 0.7, ry: H * 0.42, fill: 'url(#' + id + '-lights)' }));

    /* 바닥 판. 잔디 부채꼴 바깥(파울지역·관중석 앞)이 하늘색으로 비어 보이던 걸 막는다. */
    (function () {
      const disc = [];
      for (let a = -180; a < 180; a += 6) disc.push([210 * Math.sin(rad(a)), -0.02, 210 * Math.cos(rad(a))]);
      add(worldPoly(cam, disc, { fill: '#14283f' }));
      /* 그라운드 바닥. 잔디 부채꼴 바깥(파울지역)이 남색으로 비면 구장이 아니라
         무대처럼 보인다. 처음엔 중견수 쪽 ±78도만 깔았는데, 홈 뒤 자리에서는
         바로 앞이 남색이었다 — 하늘과 같은 실수를 바닥에서 또 한 셈이다.
         한 바퀴 전부 깔고, 조각마다 따로 그린다. */
      for (let a = -180; a < 180; a += 3) {
        if (behind(a + 1.5, bowlAt(a) * 0.6)) continue;
        add(worldPoly(cam, [
          [2 * Math.sin(rad(a)), -0.01, 2 * Math.cos(rad(a))],
          [bowlAt(a) * Math.sin(rad(a)), -0.01, bowlAt(a) * Math.cos(rad(a))],
          [bowlAt(a + 3.4) * Math.sin(rad(a + 3.4)), -0.01, bowlAt(a + 3.4) * Math.cos(rad(a + 3.4))],
          [2 * Math.sin(rad(a + 3.4)), -0.01, 2 * Math.cos(rad(a + 3.4))]
        ], { fill: '#27603f' }));
      }
    })();

    /* 구장 바깥 — 도시 실루엣.
       처음엔 중견수 쪽 ±85도에만 세웠더니 외야석에서 홈플레이트를 볼 때
       화면에 하늘밖에 없었다. 한 바퀴 전부 세우고, 조각마다 따로 그린다
       (한 덩어리로 그리면 카메라 뒤로 감기는 부분에서 잘라내기가 망가진다). */
    const noise = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    for (let a = -180; a < 180; a += 6) {
      const R = bowlAt(a) + 120;
      if (behind(a + 3, R)) continue;
      const h2 = 14 + noise(a) * 26;
      add(worldPoly(cam, [
        [R * Math.sin(rad(a)), 0, R * Math.cos(rad(a))],
        [R * Math.sin(rad(a + 6)), 0, R * Math.cos(rad(a + 6))],
        [R * Math.sin(rad(a + 6)), h2, R * Math.cos(rad(a + 6))],
        [R * Math.sin(rad(a)), h2, R * Math.cos(rad(a))]
      ], { fill: '#0a1424', opacity: '0.92' }));
      // 창문 몇 개. 멀리서도 "도시"로 읽히게 하는 최소한의 신호다.
      if (noise(a + 1) > 0.55) {
        const wy = 6 + noise(a + 2) * (h2 - 10);
        add(worldPoly(cam, [
          [R * Math.sin(rad(a + 2)), wy, R * Math.cos(rad(a + 2))],
          [R * Math.sin(rad(a + 4)), wy, R * Math.cos(rad(a + 4))],
          [R * Math.sin(rad(a + 4)), wy + 3, R * Math.cos(rad(a + 4))],
          [R * Math.sin(rad(a + 2)), wy + 3, R * Math.cos(rad(a + 2))]
        ], { fill: '#f2c14e', opacity: '0.25' }));
      }
    }

    /* 관중석. 구장을 빙 둘러 세우고 그 위에 관중을 점으로 흩뿌린다.
       이게 없으면 그라운드만 떠 있어서 경기장으로 안 보인다. */
    // 3도씩. 6도로 했더니 반지름이 빠르게 변하는 구간에서 실루엣이 톱니처럼 튀었다.
    for (let a = -180; a < 180; a += 3) {
      if (behind(a + 1.5, bowlAt(a) + 20)) continue;
      const s0 = Math.sin(rad(a)), c0 = Math.cos(rad(a));
      // 0.4도씩 겹쳐 그린다 — 딱 붙이면 조각 사이에 머리카락 같은 이음매가 남는다.
      const s1 = Math.sin(rad(a + 3.4)), c1 = Math.cos(rad(a + 3.4));
      const b0 = bowlAt(a), b1 = bowlAt(a + 3.4);
      // 뒤로 갈수록 높아지는 스탠드 단면
      add(worldPoly(cam, [
        [b0 * s0, 3, b0 * c0], [b1 * s1, 3, b1 * c1],
        [(b1 + 43) * s1, 32, (b1 + 43) * c1], [(b0 + 43) * s0, 32, (b0 + 43) * c0]
      ], { fill: '#1a3054' }));
      // 지붕
      add(worldPoly(cam, [
        [(b0 + 31) * s0, 40, (b0 + 31) * c0], [(b1 + 31) * s1, 40, (b1 + 31) * c1],
        [(b1 + 51) * s1, 44, (b1 + 51) * c1], [(b0 + 51) * s0, 44, (b0 + 51) * c0]
      ], { fill: '#1b3358' }));
      add(worldLine(cam, [(b0 + 31) * s0, 40, (b0 + 31) * c0], [(b1 + 31) * s1, 40, (b1 + 31) * c1],
        { stroke: '#3b5a80', 'stroke-width': '1.2', opacity: '0.8' }));
    }
    for (let a = -180; a < 180; a += 5) {
      if (behind(a, bowlAt(a) + 20)) continue;
      for (let t = 0; t < 4; t++) {
        const rr = bowlAt(a) + 3 + t * 10.5, hh = 4 + t * 7.2;
        const p = cam.toCam([rr * Math.sin(rad(a)), hh, rr * Math.cos(rad(a))]);
        if (p[2] <= NEAR) continue;
        const sp = cam.toScreen(p);
        add(el('circle', {
          cx: sp[0].toFixed(1), cy: sp[1].toFixed(1),
          r: Math.max(0.7, 40 / p[2]).toFixed(1),
          fill: ['#e8556d', '#f2c14e', '#7fd6a8', '#cdd8ea'][(a + t * 3 + 180) % 4],
          opacity: '0.6'
        }));
      }
    }

    /* 조명탑 여섯 기. 야구장을 야구장으로 보이게 하는 물건이다.
       어느 방향을 보든 한두 기는 화면에 들어오도록 한 바퀴에 고루 세운다. */
    [-150, -95, -40, 40, 95, 150].forEach((a) => {
      const rr = bowlAt(a) + 50;
      if (behind(a, rr)) return;
      const x = rr * Math.sin(rad(a)), z = rr * Math.cos(rad(a));
      add(worldLine(cam, [x, 0, z], [x, 66, z],
        { stroke: '#3c5c82', 'stroke-width': '3.5', 'stroke-linecap': 'round' }));
      add(worldPoly(cam, [
        [x - 11, 66, z], [x + 11, 66, z], [x + 11, 78, z], [x - 11, 78, z]
      ], { fill: '#f4e3ad', opacity: '0.92' }));
      const glow = cam.toCam([x, 72, z]);
      if (glow[2] > NEAR) {
        const g = cam.toScreen(glow);
        add(el('circle', { cx: g[0].toFixed(1), cy: g[1].toFixed(1),
          r: Math.max(8, 900 / glow[2]).toFixed(1),
          fill: 'url(#' + id + '-lights)' }));
      }
    });

    /* 전광판. 중견수 뒤에 하나.
       한때 홈 뒤에도 보조판을 세웠다. 외야에서 홈 쪽이 허전해서였는데,
       관중석에 윤곽이 생기면서 백네트와 스탠드가 그 자리를 채운다. 이제는
       그라운드 위에 뜬 판자처럼 보여서 뺐다. */
    [[0, 26, 22, 12]].forEach(function (b) {
      const a = b[0], hw = b[1], hh = b[2], y0 = b[3];
      const rr = bowlAt(a) + (a === 0 ? 22 : 6);
      const x = rr * Math.sin(rad(a)), z = rr * Math.cos(rad(a));
      const ux = Math.cos(rad(a)), uz = -Math.sin(rad(a));   // 판의 가로 방향
      const P = (u, y, d) => [x + ux * u + Math.sin(rad(a)) * d, y,
        z + uz * u + Math.cos(rad(a)) * d];
      add(worldPoly(cam, [P(-hw, y0, 0), P(hw, y0, 0), P(hw, y0 + hh, 0), P(-hw, y0 + hh, 0)],
        { fill: '#0b1526', stroke: '#3b5a80', 'stroke-width': '1.5' }));
      add(worldPoly(cam, [P(-hw + 3, y0 + 3, -0.4), P(hw - 3, y0 + 3, -0.4),
        P(hw - 3, y0 + hh - 3, -0.4), P(-hw + 3, y0 + hh - 3, -0.4)],
        { fill: '#16324f' }));
      for (let i = 0; i < 5; i++) {
        const u0 = -hw + 4 + i * (hw * 2 - 8) / 5;
        add(worldPoly(cam, [P(u0, y0 + 5, -0.6), P(u0 + (hw * 2 - 8) / 8, y0 + 5, -0.6),
          P(u0 + (hw * 2 - 8) / 8, y0 + hh - 5, -0.6), P(u0, y0 + hh - 5, -0.6)],
          { fill: '#f2c14e', opacity: String(0.22 + (i % 3) * 0.16) }));
      }
    });

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
      const t = seg.map((a) => [16 * Math.sin(rad(a)), 4.5, 16 * Math.cos(rad(a))]);
      const b = seg.map((a) => [16 * Math.sin(rad(a)), 0, 16 * Math.cos(rad(a))]);
      /* 백네트는 그물이다. 꽉 찬 남색으로 칠했더니 그라운드 위에 판자를 세워
         둔 것처럼 보였다. 비치게 두고 위쪽 테두리만 남긴다. */
      add(worldPoly(cam, t.concat(b.reverse()), { fill: '#16304f', opacity: '0.42' }));
      add(worldPoly(cam, t, { fill: 'none', stroke: '#4a678e',
        'stroke-width': '1.4', opacity: '0.7' }));
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
      /* 포지션 이름은 아홉 자리 전부 쓴다. 한때 겹침을 피한다고 포수를 지웠는데,
         이름이 빠진 선수가 있으면 그림이 덜 만들어진 것처럼 보인다. 겹치는 것은
         타자와 포수뿐이니 포수 이름만 발밑으로 내린다.
         어두운 테두리를 둘러 잔디 위에서도 읽히게 한다. */
      /* 멀다고 이름을 빼지 않는다. 중견수는 홈 뒤에서 120m 떨어져 있어 사람은
         점만 하게 보이지만, 이름이 없으면 저게 누구인지 알 수가 없다.
         글자는 작아져도 읽을 수 있는 크기까지만 줄인다. */
      if (h > 3.5) {
        const ly = pl.labelBelow ? foot[1] + h * 0.30 + 4 : head[1] - h * 0.34 - 3;
        const t = el('text', {
          x: head[0].toFixed(1), y: ly.toFixed(1), 'text-anchor': 'middle',
          fill: '#eaf1fb', 'font-size': Math.max(9.5, Math.min(13, h * 0.30)).toFixed(1),
          stroke: '#0b1526', 'stroke-width': '2.6', 'paint-order': 'stroke',
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

    /* 손가락 하나 움직이는 동안 pointermove가 화면 주사율보다 빨리 들어온다.
       들어올 때마다 다시 그리면 그리지도 못할 프레임을 계산하느라 버벅인다.
       한 프레임에 한 번만 그린다. */
    let pending = 0;
    const paint = () => draw(svg, seat, yaw, pitch, W, H, id);
    const redraw = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; paint(); });
    };
    paint();

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
      look(dy) { yaw = Math.max(-70, Math.min(70, yaw + dy)); redraw(); },
      // 공유 카드가 "지금 보고 있는 각도" 그대로를 담을 수 있어야 한다.
      angle() { return { yaw: yaw, pitch: pitch }; }
    };
  }

  /* 화면에 붙이지 않고 그리기만 한다. 공유 카드처럼 큰 판에 한 번 그려서
     이미지로 굽는 용도. mount와 같은 draw를 쓰므로 보이는 것과 어긋나지 않는다. */
  function snapshot(zone, opts) {
    const o = opts || {};
    const W = o.width || 1080, H = o.height || 660;
    const svg = el('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 ' + W + ' ' + H, width: W, height: H
    });
    draw(svg, seatFromZone(zone), o.yaw || 0, o.pitch || 0, W, H,
      'snap' + Math.random().toString(36).slice(2, 8));
    return svg;
  }

  window.KboSeatView = { mount, snapshot, seatFromZone, PLAYERS };
})();
