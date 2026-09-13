/* 공유 카드.

   지금까지 공유는 텍스트 한 줄 + 링크가 전부였다. 그런데 이 앱에서 남에게
   보여줄 만한 것은 "그 자리에서 이렇게 보인다"는 그림이다. 링크만 보내면
   받는 사람은 열어보기 전까지 아무것도 모른다. 그림이 먼저 가야 한다.

   만드는 방법
     좌석 시야 SVG를 큰 판에 다시 그려서(KboSeatView.snapshot) 이미지로 굽고,
     그 위아래 글자는 캔버스에 직접 쓴다.

     글자를 SVG 안에 넣지 않는 이유: SVG를 이미지로 구울 때는 그 SVG가 격리된
     문서로 취급돼서 폰트 상속이 어긋날 수 있다. 한글이 깨지면 카드 전체가
     쓸모없어진다. 도형은 SVG로, 글자는 캔버스로 나눈다.

   외부 라이브러리는 쓰지 않는다. 빌드 도구가 없는 저장소다. */
(function () {
  const CFG = window.KBO_CONFIG;

  const W = 1080, H = 1350;              // 인스타 스토리·피드에 무난한 4:5
  const PAD = 72;
  /* 시야는 더 크게 그린 뒤 가운데 띠만 쓴다.
     딱 VIEW_H로 그렸더니 그림 아래쪽 3분의 1이 텅 빈 바닥이라 카드에 구멍이
     뚫린 것처럼 보였다. 위로 60(하늘), 아래로 200(바닥)을 덜어낸다. */
  const OVER_TOP = 60, OVER_BOT = 200;
  const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

  const C = {
    bg: '#0b1526', ink: '#f2f6fc', dim: '#93a4bd',
    gold: '#ffd27a', line: '#1e3354', brand: '#e8556d'
  };

  /* SVG 엘리먼트를 이미지로. data: URI로 넘겨야 캔버스가 오염되지 않는다
     (blob: URL을 쓰면 브라우저에 따라 toBlob에서 보안 오류가 난다). */
  function svgToImage(svg) {
    return new Promise((resolve, reject) => {
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('시야 그림을 이미지로 바꾸지 못했습니다'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }

  // 둥근 사각형. 오래된 사파리에는 roundRect가 없다.
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* 한 줄에 안 들어가면 접는다. 제목이 카드 밖으로 삐져나가면 안 된다. */
  function wrap(ctx, text, maxW) {
    const out = [];
    let line = '';
    for (const ch of String(text)) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxW && line) { out.push(line); line = ch; }
      else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  function pill(ctx, x, y, text, fill, fg) {
    ctx.font = '600 30px ' + FONT;
    const w = ctx.measureText(text).width + 40;
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, w, 52, 26);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 20, y + 27);
    return w + 12;                        // 다음 배지가 들어갈 x 오프셋
  }

  /* opts: { stadiumName, zone, section, rank, yaw, pitch, side, fanSide } */
  function build(opts) {
    const o = opts || {};
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    /* 글 높이를 먼저 잰다.
       처음에는 그림 높이를 고정했더니, 배지도 없고 설명도 한 줄인 구역에서
       카드 아래쪽이 200px쯤 텅 비었다. 글이 안 쓰는 자리는 그림이 가져간다 —
       이 카드에서 제일 볼 만한 것은 그림이다. */
    const maxW = W - PAD * 2;
    const badges = [];
    if (o.rank) {
      badges.push({ t: ['🥇', '🥈', '🥉'][o.rank - 1] + ' 명당 ' + o.rank + '위',
        bg: C.gold, fg: '#3a2a08' });
    }
    if (o.side === 'home' || o.side === 'away') {
      badges.push({ t: o.side === 'home' ? '🏠 홈 응원석' : '✈️ 원정 응원석',
        bg: '#15294a', fg: C.ink });
    }

    ctx.font = '800 88px ' + FONT;
    const nameLines = wrap(ctx, (o.zone && o.zone.name) || '', maxW).slice(0, 2);

    const why = (o.section && o.section.description) || (o.zone && o.zone.why) || '';
    ctx.font = '400 36px ' + FONT;
    const whyLines = why ? wrap(ctx, why, maxW).slice(0, 2) : [];

    const footY = H - 150;
    const blockH = (badges.length ? 92 : 24) + nameLines.length * 100 + 92 +
      whyLines.length * 52;
    const viewH = Math.max(520, Math.min(880, footY - 60 - blockH - 20));

    const svg = window.KboSeatView.snapshot(o.zone, {
      width: W, height: viewH + OVER_TOP + OVER_BOT,
      yaw: o.yaw || 0, pitch: o.pitch || 0
    });

    return svgToImage(svg).then((img) => {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      // 시야 그림 — 크게 그린 것에서 가운데 띠만 떠 온다
      ctx.drawImage(img, 0, OVER_TOP, W, viewH, 0, 0, W, viewH);
      // 그림 아래를 배경색으로 부드럽게 녹여 글자와 이어 붙인다.
      const fade = ctx.createLinearGradient(0, viewH - 130, 0, viewH);
      fade.addColorStop(0, 'rgba(11,21,38,0)');
      fade.addColorStop(1, C.bg);
      ctx.fillStyle = fade;
      ctx.fillRect(0, viewH - 130, W, 130);

      let y = viewH + 20;

      // 배지 줄 — 순위와 응원석
      ctx.textBaseline = 'middle';
      let x = PAD;
      badges.forEach((b) => { x += pill(ctx, x, y, b.t, b.bg, b.fg); });
      y += badges.length ? 92 : 24;

      // 구역 이름
      ctx.fillStyle = C.ink;
      ctx.font = '800 88px ' + FONT;
      ctx.textBaseline = 'alphabetic';
      nameLines.forEach((ln) => { ctx.fillText(ln, PAD, y + 70); y += 100; });

      // 구장 이름
      ctx.fillStyle = C.dim;
      ctx.font = '500 40px ' + FONT;
      ctx.fillText(o.stadiumName || '', PAD, y + 40);
      y += 92;

      // 한 줄 설명 — 이 자리를 왜 볼 만한지
      ctx.fillStyle = '#c3d1e6';
      ctx.font = '400 36px ' + FONT;
      whyLines.forEach((ln) => { ctx.fillText(ln, PAD, y + 36); y += 52; });

      // 아래 띠 — 이건 사진이 아니라는 말과 브랜드
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PAD, footY); ctx.lineTo(W - PAD, footY); ctx.stroke();

      ctx.fillStyle = C.dim;
      ctx.font = '400 28px ' + FONT;
      ctx.fillText('사진이 아니라 좌석 위치로 계산한 개략도입니다', PAD, footY + 48);

      ctx.fillStyle = C.brand;
      ctx.font = '800 40px ' + FONT;
      ctx.fillText('⚾ ' + CFG.siteName, PAD, footY + 108);

      ctx.fillStyle = C.dim;
      ctx.font = '400 28px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(CFG.tagline, W - PAD, footY + 108);
      ctx.textAlign = 'left';

      return new Promise((resolve, reject) => {
        cv.toBlob((b) => b ? resolve(b) : reject(new Error('이미지를 만들지 못했습니다')),
          'image/png');
      });
    });
  }

  window.KboShareCard = { build };
})();
