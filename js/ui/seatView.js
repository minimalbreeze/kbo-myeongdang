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
  const BASE = 27.43;          // 루간 거리
  const D = BASE / Math.SQRT2; // 1·3루의 x, z 성분
  const MOUND = 18.44;

  const BASES = {
    home: [0, 0], first: [D, D], second: [0, BASE * Math.SQRT2 / 2 * 2 * 0.5 + D], third: [-D, D]
  };
  BASES.second = [0, D * 2];

  // 표준 수비 위치. 야구의 규격이지 우리가 정한 값이 아니다.
  const PLAYERS = [
    { id: 'p',  name: '투수',   pos: [0, MOUND] },
    { id: 'c',  name: '포수',   pos: [0, -1.6] },
    { id: '1b', name: '1루수',  pos: [21, 30] },
    { id: '2b', name: '2루수',  pos: [9, 45] },
    { id: 'ss', name: '유격수', pos: [-9, 45] },
    { id: '3b', name: '3루수',  pos: [-21, 30] },
    { id: 'lf', name: '좌익수', pos: [-44, 80] },
    { id: 'cf', name: '중견수', pos: [0, 92] },
    { id: 'rf', name: '우익수', pos: [44, 80] },
    { id: 'bat', name: '타자',  pos: [-1.2, 0.4], batter: true }
  ];

  const WALL = { corner: 99, center: 121 };   // 개략값. 실측이 생기면 데이터로 뺀다.

  /* 지도 좌표(각도·반지름)를 좌석의 실제 위치로 옮긴다.

     반지름에 그냥 비례를 곱하면 안 된다. 지도는 개략도라 관중석이 필드에 비해
     크게 그려져 있어서, 그대로 환산하면 홈 뒤 자리가 50m 넘게 멀어지고 그라운드가
     점처럼 작아졌다. 그래서 관중석 반지름 구간(GROUND~바깥)을 실제 좌석 거리
     구간(백스톱 뒤 18m ~ 외야 뒤 135m)에 맞춰 편다. */
  const STAND_MIN = 112, STAND_MAX = 414;
  const NEAR_M = 18, FAR_M = 135;      // 가장 앞줄 ~ 가장 뒷자리 거리
  const HIGH_M = 28;                    // 가장 뒷자리 높이

  function seatFromZone(zone) {
    let span = zone.a1 - zone.a0;
    if (span <= 0) span += 360;
    const a = (zone.a0 + span / 2) % 360;
    const r = (zone.r0 + zone.r1) / 2;
    const t = Math.max(0, Math.min(1, (r - STAND_MIN) / (STAND_MAX - STAND_MIN)));
    const meters = NEAR_M + t * (FAR_M - NEAR_M);
    return {
      // 각도 0 = 중견수 방향이므로 그대로 쓰면 된다.
      x: meters * Math.sin(rad(a)),
      z: meters * Math.cos(rad(a)),
      y: 4 + t * HIGH_M
    };
  }

  /* ---------- 원근 투영 ----------
     카메라를 좌석에 두고, 기본으로 내야 가운데를 본다.
     yaw/pitch를 더해 둘러볼 수 있게 한다. */
  function makeCamera(seat, yaw, pitch, W, H) {
    const target = [0, 1, 34];                       // 2루 언저리. 25로 두니 그라운드가 위로 몰렸다.
    const base = Math.atan2(target[0] - seat.x, target[2] - seat.z);
    const ay = base + rad(yaw);
    const ax = rad(pitch) + Math.atan2(seat.y - target[1], Math.hypot(target[0] - seat.x, target[2] - seat.z)) * -1;

    const cosY = Math.cos(ay), sinY = Math.sin(ay);
    const cosX = Math.cos(ax), sinX = Math.sin(ax);
    const f = W * 0.80;                               // 초점거리. 클수록 좁고 크게 보인다.

    return function project(wx, wy, wz) {
      let dx = wx - seat.x, dy = wy - seat.y, dz = wz - seat.z;
      // yaw
      let rx = dx * cosY - dz * sinY;
      let rz = dx * sinY + dz * cosY;
      // pitch
      let ry = dy * cosX - rz * sinX;
      rz = dy * sinX + rz * cosX;
      if (rz <= 0.4) return null;                     // 카메라 뒤는 그리지 않는다
      return [W / 2 + f * rx / rz, H / 2 - f * ry / rz, rz];
    };
  }

  function poly(pts, attrs) {
    if (pts.some((p) => !p)) return null;
    return el('polygon', Object.assign({
      points: pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
    }, attrs));
  }

  /* ---------- 그리기 ---------- */
  function draw(svg, seat, yaw, pitch, W, H) {
    svg.innerHTML = '';
    const P = makeCamera(seat, yaw, pitch, W, H);
    const add = (n) => { if (n) svg.appendChild(n); };

    // 하늘과 먼 배경
    add(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#0b1526' }));

    // 외야 잔디 — 파울라인 안쪽을 부채꼴로
    const grass = [P(0, 0, 0)];
    for (let a = -45; a <= 45; a += 3) {
      const t = Math.abs(a) / 45;
      const d = WALL.center + (WALL.corner - WALL.center) * t;
      grass.push(P(d * Math.sin(rad(a)), 0, d * Math.cos(rad(a))));
    }
    add(poly(grass, { fill: '#2f7d4f', opacity: '0.55' }));

    // 내야 흙
    const dirt = [P(0, 0, -3)];
    for (let a = -50; a <= 50; a += 4) dirt.push(P(29 * Math.sin(rad(a)), 0, 29 * Math.cos(rad(a))));
    add(poly(dirt, { fill: '#b98a5a', opacity: '0.7' }));

    // 파울 라인
    [[-45, '#fff'], [45, '#fff']].forEach(([a, col]) => {
      const t = Math.abs(a) / 45;
      const d = WALL.corner;
      const p0 = P(0, 0.02, 0), p1 = P(d * Math.sin(rad(a)), 0.02, d * Math.cos(rad(a)));
      if (p0 && p1) add(el('line', {
        x1: p0[0].toFixed(1), y1: p0[1].toFixed(1), x2: p1[0].toFixed(1), y2: p1[1].toFixed(1),
        stroke: col, 'stroke-width': '2', opacity: '0.75'
      }));
    });

    // 베이스
    Object.keys(BASES).forEach((k) => {
      const [bx, bz] = BASES[k];
      const s = 0.6;
      add(poly([P(bx - s, 0.03, bz - s), P(bx + s, 0.03, bz - s), P(bx + s, 0.03, bz + s), P(bx - s, 0.03, bz + s)],
        { fill: '#fff', opacity: '0.92' }));
    });

    // 마운드
    const mound = [];
    for (let a = 0; a < 360; a += 15) mound.push(P(2.7 * Math.cos(rad(a)), 0.04, MOUND + 2.7 * Math.sin(rad(a))));
    add(poly(mound, { fill: '#c99a6a', opacity: '0.9' }));

    // 외야 담장
    const wallTop = [], wallBot = [];
    for (let a = -45; a <= 45; a += 3) {
      const t = Math.abs(a) / 45;
      const d = WALL.center + (WALL.corner - WALL.center) * t;
      wallBot.push(P(d * Math.sin(rad(a)), 0, d * Math.cos(rad(a))));
      wallTop.push(P(d * Math.sin(rad(a)), 2.4, d * Math.cos(rad(a))));
    }
    if (wallTop.every(Boolean) && wallBot.every(Boolean)) {
      add(poly(wallTop.concat(wallBot.slice().reverse()), { fill: '#16324d', opacity: '0.95' }));
    }

    // 홈플레이트 뒤 백스톱과 스탠드. 외야 자리에서 보면 저쪽이 그냥 비어 있었다.
    // 내가 앉은 쪽 백스톱은 그리지 않는다. 그 뒤에 앉아 있으니 실제로 안 보이고,
    // 그리면 화면을 통째로 가린다(챔피언석에서 그라운드가 사라졌었다).
    const seatBearing = (Math.atan2(seat.x, seat.z) * 180 / Math.PI + 360) % 360;
    const away = (a) => {
      const diff = Math.abs(((a - seatBearing + 540) % 360) - 180);   // 시선 반대편일수록 180에 가깝다
      return diff > 105;
    };
    const bsT = [], bsB = [];
    for (let a = 118; a <= 242; a += 4) {
      if (!away(a)) { flushBackstop(); continue; }
      const d = 16;
      bsB.push(P(d * Math.sin(rad(a)), 0, d * Math.cos(rad(a))));
      bsT.push(P(d * Math.sin(rad(a)), 4, d * Math.cos(rad(a))));
    }
    flushBackstop();

    function flushBackstop() {
      if (bsT.length > 1 && bsT.every(Boolean) && bsB.every(Boolean)) {
        add(poly(bsT.concat(bsB.slice().reverse()), { fill: '#16243d', opacity: '0.95' }));
      }
      bsT.length = 0; bsB.length = 0;
    }

    /* 선수. 멀리 있을수록 작아지는 건 투영이 알아서 해준다.
       사람 모양은 머리(원) + 몸(선)으로 충분하다 — 이건 시야를 가늠하는 그림이지
       선수를 그리는 그림이 아니다. */
    const people = PLAYERS.map((pl) => {
      const foot = P(pl.pos[0], 0, pl.pos[1]);
      const head = P(pl.pos[0], 1.75, pl.pos[1]);
      return foot && head ? { pl, foot, head, depth: foot[2] } : null;
    }).filter(Boolean).sort((a, b) => b.depth - a.depth);   // 먼 선수부터 그린다

    people.forEach(({ pl, foot, head }) => {
      const h = Math.abs(foot[1] - head[1]);
      if (h < 2.5) return;                                   // 점만도 못하면 생략
      const col = pl.batter ? '#ffd27a' : '#ffffff';
      add(el('line', {
        x1: foot[0].toFixed(1), y1: foot[1].toFixed(1),
        x2: head[0].toFixed(1), y2: (head[1] + h * 0.32).toFixed(1),
        stroke: col, 'stroke-width': Math.max(2.2, h * 0.26).toFixed(1),
        'stroke-linecap': 'round', opacity: '0.95'
      }));
      add(el('circle', {
        cx: head[0].toFixed(1), cy: head[1].toFixed(1), r: Math.max(2.0, h * 0.22).toFixed(1),
        fill: col, opacity: '0.95'
      }));
      if (h > 13) {
        const t = el('text', {
          x: head[0].toFixed(1), y: (head[1] - h * 0.28).toFixed(1), 'text-anchor': 'middle',
          fill: '#e6edf8', 'font-size': Math.max(9, Math.min(13, h * 0.34)).toFixed(1), 'pointer-events': 'none'
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
    let yaw = 0, pitch = 0;

    container.innerHTML = '';
    const svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: 'auto',
      style: 'touch-action:none;display:block;border-radius:12px;background:#0b1526',
      role: 'img', 'aria-label': zone.name + '에서 본 그라운드 개략도. 끌어서 둘러볼 수 있습니다.'
    });
    container.appendChild(svg);

    const redraw = () => draw(svg, seat, yaw, pitch, W, H);
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
    const end = (e) => { last = null; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    return {
      reset() { yaw = 0; pitch = 0; redraw(); },
      look(dy) { yaw = Math.max(-70, Math.min(70, yaw + dy)); redraw(); }
    };
  }

  window.KboSeatView = { mount, seatFromZone, PLAYERS };
})();
