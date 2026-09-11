/* 서비스 워커 — 야구장에서 쓰라고 만든 것이다.
   경기 날 구장 주변은 사람이 몰려 네트워크가 제일 안 터지는데, 정작 좌석 지도가
   필요한 순간이 거기다. 그래서 한 번 본 화면과 구장 데이터는 오프라인에서도 열린다.

   지키는 선
     - 날씨 API(Open-Meteo)는 절대 캐시하지 않는다. 다른 출처(cross-origin)는 전부
       손대지 않고 지나보낸다. 오래된 날씨를 지금 날씨처럼 보여주지 않기 위해서다.
       네트워크가 없으면 화면은 "날씨를 불러오지 못했습니다"라고 정직하게 말한다.
     - 화면·코드·구장 데이터는 network-first다. 온라인이면 항상 최신을 받고,
       실패할 때만 캐시를 쓴다. 캐시 때문에 옛 버전이 붙박이는 일이 없다.
     - 아이콘·이미지만 cache-first다. 거의 안 바뀌고, 바뀔 때는 파일명을 올리는
       것이 이 저장소의 규칙이라(og-image-v2.png) 옛 주소가 굳어도 문제가 없다. */

const VERSION = 'v1';
const SHELL = 'kbo-shell-' + VERSION;
const RUNTIME = 'kbo-runtime-' + VERSION;

// 첫 방문에 미리 받아두는 최소한. 하나라도 실패하면 설치가 통째로 실패하므로
// 반드시 있는 파일만 넣는다.
const PRECACHE = [
  './',
  'index.html',
  'stadium.html',
  'css/base.css',
  'css/map.css',
  'js/config.js',
  'js/analytics.js',
  'js/recommend.js',
  'js/services/dataService.js',
  'js/services/gameService.js',
  'js/services/weatherService.js',
  'js/services/shareService.js',
  'js/ui/render.js',
  'js/ui/seatMap.js',
  'js/ui/report.js',
  'js/home.js',
  'js/stadium.js',
  'manifest.json',
  'icon.svg',
  'data/stadiums.json',
  'data/teams.json',
  'data/seats.json',
  'data/games.json',
  'data/foods.json',
  'data/shops.json',
  'data/facilities.json',
  'data/transport.json',
  'data/map/gwangju.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

// cache.addAll()은 목록 중 하나만 404여도 통째로 실패한다 — 파일명 오타 하나가
// 오프라인 기능 전체를 죽인다. 그래서 하나씩 담고 실패는 넘어간다.
// 못 담은 파일은 온라인일 때 networkFirst가 런타임 캐시에 알아서 채운다.
async function precache() {
  const cache = await caches.open(SHELL);
  await Promise.allSettled(PRECACHE.map(async (path) => {
    const res = await fetch(path, { cache: 'reload' });
    if (!res.ok) throw new Error(path + ' ' + res.status);
    return cache.put(path, res);
  }));
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isImage = (url) => /\.(png|jpg|jpeg|svg|webp|gif)$/i.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 다른 출처는 손대지 않는다 — 날씨 API가 여기에 해당한다.
  if (url.origin !== self.location.origin) return;

  if (isImage(url)) {
    e.respondWith(cacheFirst(req));
    return;
  }
  e.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    // 화면 이동인데 캐시에도 없으면 홈이라도 띄운다(빈 화면을 보여주지 않는다).
    if (req.mode === 'navigate') {
      const home = await caches.match('index.html');
      if (home) return home;
    }
    return new Response('', { status: 504, statusText: 'offline' });
  }
}
