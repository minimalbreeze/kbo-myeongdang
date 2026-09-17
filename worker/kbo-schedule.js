/* KBO 경기 일정 중계기 (Cloudflare Worker)

   왜 필요한가
     KBO는 공개 API를 주지 않는다. 그래서 data/games.json은 사람이 채우는
     파일이었고, 비어 있으면 "오늘 경기 정보 없음"이 뜨고 손으로 적어 넣어도
     하루 지나면 틀렸다. 이 Worker가 KBO 일정 페이지가 쓰는 내부 주소를
     대신 불러 우리 앱이 읽을 수 있는 모양으로 바꿔 준다.

   왜 브라우저에서 바로 못 부르나
     KBO 쪽은 CORS 헤더를 주지 않는다. 브라우저가 막는다. 그래서 중계기가
     필요하다. 덤으로 캐시를 두어 KBO를 두들기지 않는다.

   지켜야 할 것
     경기 취소를 날씨나 정황으로 추론하지 않는다. 공식 발표에 "취소"라고
     적혀 있을 때만 취소로 옮긴다. 그 외에는 전부 unknown이고, 앱은 공식
     발표 링크를 함께 보여준다.

   쓰는 법
     GET /                     이번 달 일정
     GET /?month=2026-10       특정 달
     GET /?stadium=gwangju     한 구장만
     GET /?debug=1             KBO가 준 응답을 그대로 보여준다(파싱 고칠 때)

   파싱이 깨지면
     KBO가 표 구조를 바꾸면 조용히 빈 목록이 나올 수 있다. 그럴 때 ?debug=1로
     원본을 확인하고 pickCells()만 고치면 된다. 나머지는 건드릴 일이 없다. */

const KBO_URL = 'https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList';

/* KBO 일정 페이지가 쓰는 값. 여러 크롤러가 공통으로 쓰는 조합이다.
   srIdList는 정규시즌·포스트시즌을 함께 받기 위한 것이다. */
const LE_ID = '1';
const SR_ID_LIST = '0,9,6';

const CACHE_SECONDS = 600;          // 10분. 일정이 분 단위로 바뀌지는 않는다.

/* 구장 이름 → 우리 앱의 구장 id.
   KBO는 "광주", "잠실"처럼 짧게 적는다. 부분 일치로 찾는다. */
const STADIUMS = [
  ['광주', 'gwangju'],
  ['잠실', 'jamsil'],
  ['고척', 'gocheok'],
  ['문학', 'munhak'],
  ['수원', 'suwon'],
  ['대전', 'daejeon'],
  ['대구', 'daegu'],
  ['사직', 'sajik'],
  ['창원', 'changwon']
];

const STATUS_CODES = {
  scheduled: { emoji: '🟢', label: '경기 진행 예정' },
  unknown:   { emoji: '🟡', label: '공식 발표 확인 필요' },
  canceled:  { emoji: '🔴', label: '경기 취소' },
  delayed:   { emoji: '🟠', label: '경기 지연' }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (body, status) => new Response(JSON.stringify(body, null, 2), {
  status: status || 200,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=' + CACHE_SECONDS,
    ...CORS
  }
});

// ---------- 도우미 ----------

const pad = (n) => String(n).padStart(2, '0');

/** 서울 기준 오늘. Worker는 UTC로 돈다. */
function seoulToday() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    y: now.getUTCFullYear(),
    m: now.getUTCMonth() + 1,
    d: now.getUTCDate()
  };
}

/** 태그를 걷어내고 공백을 정리한다. KBO는 셀 안에 <span><img>를 섞어 넣는다. */
function plain(html) {
  return String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stadiumIdOf(text) {
  for (const [name, id] of STADIUMS) if (text.includes(name)) return id;
  return null;
}

/* 경기 상태.

   날씨나 정황으로 추론하지 않는다. 공식 표에 적힌 말만 옮긴다.
   아무 말도 없으면 unknown이고, 앱이 공식 발표로 보낸다. */
function statusOf(cells, hasScore) {
  const all = cells.join(' ');
  if (all.includes('취소')) return 'canceled';
  if (all.includes('서스펜디드') || all.includes('지연') || all.includes('중단')) return 'delayed';
  if (hasScore) return 'scheduled';          // 이미 열린 경기. 편성은 확정이었다.
  if (/\d{1,2}:\d{2}/.test(all)) return 'scheduled';
  return 'unknown';
}

/* 한 줄(row)에서 쓸 값을 뽑는다.

   자리로만 찾으면 KBO가 열을 하나 끼워 넣는 순간 전부 어긋난다. 생김새로
   찾는다 — 날짜꼴, 시각꼴, 구장 이름. 그러고 남은 것 중 팀 이름이 있는
   칸을 경기 칸으로 본다.

   KBO 표는 같은 날 경기를 여러 줄로 쓰면서 날짜는 첫 줄에만 적는다(rowspan).
   그래서 날짜는 바깥에서 이어받는다. */
function pickCells(cells) {
  let date = null, time = null, stadium = null, play = null;

  for (const c of cells) {
    if (!date) {
      const m = c.match(/(\d{1,2})\.(\d{1,2})/);        // 09.17(수)
      if (m) { date = { m: +m[1], d: +m[2] }; continue; }
    }
    if (!time) {
      const m = c.match(/^(\d{1,2}):(\d{2})$/);
      if (m) { time = pad(+m[1]) + ':' + m[2]; continue; }
    }
    if (!stadium && stadiumIdOf(c) && c.length <= 8) { stadium = c; continue; }
    if (!play && /vs|VS/.test(c)) { play = c; continue; }
  }

  // "vs"가 없는 형식이면, 팀 이름이 둘 들어 있는 가장 긴 칸을 경기 칸으로 본다.
  if (!play) {
    const cand = cells
      .filter((c) => c.length >= 4 && !/^\d/.test(c))
      .sort((a, b) => b.length - a.length);
    play = cand[0] || null;
  }
  return { date, time, stadium, play };
}

/* "KIA vs 한화" 또는 "KIA 3 : 5 한화" 에서 두 팀을 뽑는다.
   KBO 표는 원정팀을 앞에, 홈팀을 뒤에 적는다. */
function teamsOf(play) {
  if (!play) return { away: null, home: null, score: false };
  const t = play.replace(/\s+/g, ' ').trim();

  let m = t.match(/^(.+?)\s*(?:vs|VS)\s*(.+)$/);
  if (m) return { away: plain(m[1]), home: plain(m[2]), score: false };

  // 점수가 붙은 형식: "KIA 3 : 5 한화"
  m = t.match(/^(\D+?)\s*\d+\s*[:：]\s*\d+\s*(\D+)$/);
  if (m) return { away: plain(m[1]), home: plain(m[2]), score: true };

  return { away: null, home: null, score: false };
}

/* KBO가 준 것을 우리 모양으로 옮긴다.

   .asmx는 {"d": ...} 로 감싸서 주고, d 안이 다시 JSON 문자열일 때가 있다.
   둘 다 받아 준다. 그 안은 rows[].row[].Text 에 칸별 HTML이 들어 있다. */
function toGames(payload, year) {
  let d = payload && payload.d !== undefined ? payload.d : payload;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (e) { return []; }
  }
  const rows = (d && d.rows) || [];
  const out = [];
  let lastDate = null;

  for (const r of rows) {
    const cells = ((r && r.row) || [])
      .map((c) => plain(c && (c.Text !== undefined ? c.Text : c.Value)))
      .filter((c) => c !== '');
    if (!cells.length) continue;

    const got = pickCells(cells);
    if (got.date) lastDate = got.date;
    if (!lastDate) continue;                    // 아직 날짜를 못 만났다

    const { away, home, score } = teamsOf(got.play);
    if (!away || !home) continue;

    const stadiumId = got.stadium ? stadiumIdOf(got.stadium) : null;

    out.push({
      date: year + '-' + pad(lastDate.m) + '-' + pad(lastDate.d),
      time: got.time || null,
      stadiumId: stadiumId,
      stadiumName: got.stadium || null,
      awayName: away,
      homeName: home,
      status: statusOf(cells, score)
    });
  }
  return out;
}

/* KBO에 물어본다.

   던지지 않고 결과를 그대로 돌려준다. 실패했을 때 무엇이 왔는지가
   ?debug=1에서 제일 알고 싶은 것인데, 던져 버리면 그게 사라진다. */
async function fetchMonth(year, month) {
  const body = new URLSearchParams({
    leId: LE_ID,
    srIdList: SR_ID_LIST,
    seasonId: String(year),
    gameMonth: pad(month),
    teamId: ''                                  // 비어 있어도 반드시 보내야 한다
  });

  let res;
  try {
    res = await fetch(KBO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        // 이 두 개가 없으면 KBO가 빈 응답을 준다.
        'Referer': 'https://www.koreabaseball.com/Schedule/Schedule.aspx',
        'User-Agent': 'Mozilla/5.0 (compatible; kbo-myeongdang/1.0)'
      },
      body
    });
  } catch (e) {
    return { ok: false, status: 0, error: '연결 실패: ' + String(e && e.message || e) };
  }

  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false, status: res.status,
      error: 'KBO 응답 ' + res.status,
      // 막힌 이유가 본문에 적혀 있을 때가 많다. 앞부분만 싣는다.
      bodyHead: text.slice(0, 600)
    };
  }
  try {
    return { ok: true, status: res.status, payload: JSON.parse(text) };
  } catch (e) {
    return {
      ok: false, status: res.status,
      error: 'JSON이 아닙니다 — KBO가 HTML을 돌려줬을 수 있습니다.',
      bodyHead: text.slice(0, 600)
    };
  }
}

/* 표를 읽는 부분만 따로 내보낸다. 이 Worker는 KBO에 직접 물어봐야 확인되는데,
   표 읽기는 그것 없이도 시험할 수 있다. scripts/test-worker.mjs가 쓴다. */
export { toGames, teamsOf, pickCells, statusOf, plain, stadiumIdOf };

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const today = seoulToday();

    // ?month=2026-10
    let year = today.y, month = today.m;
    const mp = url.searchParams.get('month');
    if (mp) {
      const m = mp.match(/^(\d{4})-(\d{1,2})$/);
      if (!m) return json({ error: 'month은 2026-10 꼴이어야 합니다.' }, 400);
      year = +m[1]; month = +m[2];
    }

    const debug = !!url.searchParams.get('debug');

    const cache = caches.default;
    const key = new Request(url.origin + url.pathname + '?y=' + year + '&m=' + month,
      { method: 'GET' });

    let payload = null, failed = null;
    const hit = debug ? null : await cache.match(key);   // 진단할 때는 캐시를 건너뛴다
    if (hit) {
      payload = await hit.json();
    } else {
      const got = await fetchMonth(year, month);
      if (got.ok) {
        payload = got.payload;
        if (!debug) await cache.put(key, json(payload));
      } else {
        failed = got;
      }
    }

    /* 파싱이나 접속을 고칠 때 쓴다. 성공하면 KBO가 준 것을, 실패하면 왜
       실패했는지를 보여준다. 정작 알고 싶은 순간은 실패했을 때다. */
    if (debug) {
      return json(failed
        ? { year, month, ok: false, status: failed.status,
            error: failed.error, bodyHead: failed.bodyHead || null,
            url: KBO_URL,
            sent: { leId: LE_ID, srIdList: SR_ID_LIST, seasonId: year, gameMonth: pad(month) } }
        : { year, month, ok: true, parsed: toGames(payload, year).length, raw: payload });
    }

    if (failed) {
      /* KBO가 죽어도 앱은 살아야 한다. 앱은 games가 비면 공식 발표 링크를
         보여주므로, 오류를 200으로 돌려주되 무슨 일인지 적어 둔다. */
      return json({
        games: [], statusCodes: STATUS_CODES, updatedAt: new Date().toISOString(),
        error: failed.error,
        hint: '자세한 내용은 ?debug=1 을 열어보세요.'
      });
    }

    let games = toGames(payload, year);

    const only = url.searchParams.get('stadium');
    if (only) games = games.filter((g) => g.stadiumId === only);

    return json({
      schemaVersion: 1,
      source: 'KBO 공식 일정',
      officialStatusUrl: 'https://www.koreabaseball.com/Schedule/Schedule.aspx',
      note: [
        '경기 취소·지연은 공식 표에 적힌 말만 옮긴다. 날씨로 추론하지 않는다.',
        '표를 읽지 못하면 games가 빈 배열이 된다. ?debug=1로 원본을 볼 수 있다.'
      ],
      statusCodes: STATUS_CODES,
      updatedAt: new Date().toISOString(),
      games
    });
  }
};
