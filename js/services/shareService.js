/* 공유 — Web Share API 우선, 안 되면 링크 복사(지시서 34·37번).
   iOS는 navigator.share()를 "사용자가 누른 직후"에만 열어준다. 그래서 이 함수는
   클릭 핸들러 안에서 await 없이 바로 불려야 하고, 링크는 url 필드로 따로 넘기지 않고
   text 안에 넣는다(카카오·스레드에서 url 필드가 버려지는 경우가 있다). */
(function () {
  function currentUrl(extra) {
    const u = new URL(location.href);
    if (extra) Object.keys(extra).forEach((k) => {
      if (extra[k] == null) u.searchParams.delete(k);
      else u.searchParams.set(k, extra[k]);
    });
    return u.toString();
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function share(text, url) {
    const full = text + '\n' + url;
    if (navigator.share) {
      navigator.share({ text: full }).catch((e) => {
        if (e && e.name === 'AbortError') return;   // 사용자가 공유 시트를 닫음
        copy(full);
      });
      return;
    }
    copy(full);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('링크를 복사했어요 🔗'))
        .catch(() => prompt('아래 링크를 복사하세요', text));
    } else {
      prompt('아래 링크를 복사하세요', text);
    }
  }

  /* 이미지까지 얹은 공유.
     iOS는 navigator.share()를 누른 직후에만 열어주는데, 카드를 굽는 데 시간이
     걸려서 그 창을 놓친다. 그래서 여기서는 굽기를 기다렸다가 부르고, 실패하면
     조용히 글자 공유로 내려간다 — 사용자가 보기에 아무 일도 안 일어나는 것이
     제일 나쁘다.

     buildBlob은 함수로 받는다. 공유를 못 하는 환경이면 굽지도 않는다. */
  function shareImage(buildBlob, filename, text, url) {
    const full = text + '\n' + url;
    if (!navigator.canShare || !window.File) { share(text, url); return; }

    toast('공유 카드를 만드는 중… 🎨');
    Promise.resolve()
      .then(buildBlob)
      .then((blob) => {
        const file = new File([blob], filename, { type: 'image/png' });
        if (!navigator.canShare({ files: [file] })) { share(text, url); return; }
        return navigator.share({ files: [file], text: full }).catch((e) => {
          if (e && e.name === 'AbortError') return;   // 사용자가 닫음
          share(text, url);
        });
      })
      .catch(() => share(text, url));
  }

  window.KboShare = { share, shareImage, copy, currentUrl, toast };
})();
