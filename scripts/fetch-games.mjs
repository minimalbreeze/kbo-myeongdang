/* KBO 경기 일정을 받아 data/games.json에 채운다.

   왜 이 방식인가

     처음에는 Cloudflare Worker로 중계기를 세웠다. 잘 돌지만 쓰려면 계정을
     만들고, wrangler를 깔고, 로그인하고, 배포하고, 나온 주소를 설정에
     옮겨 적어야 한다. 일정 하나 띄우자고 치르는 값으로는 비싸다.

     이 저장소는 이미 GitHub Actions를 쓰고 있고, GitHub Pages로 배포된다.
     그러면 Actions가 하루에 몇 번 KBO에서 일정을 받아 data/games.json에
     커밋하면 된다. 계정도, 설치도, 설정도 필요 없다. 바뀐 내용이 커밋으로
     남아서 무엇이 언제 바뀌었는지도 보인다.

     실시간이 필요하면 worker/ 의 중계기를 배포해 config.gamesProxyUrl에
     넣으면 된다. 그쪽이 우선이고, 없으면 이 파일을 쓴다.

   지키는 것
     경기 취소를 추론하지 않는다. 공식 표에 적힌 말만 옮긴다.
     KBO가 응답하지 않으면 기존 파일을 건드리지 않는다 — 어제 것이라도
     비어 있는 것보다 낫다.

   쓰는 법
     node scripts/fetch-games.mjs           이번 달 + 다음 달
     node scripts/fetch-games.mjs --dry     파일을 쓰지 않고 결과만 본다
     node scripts/fetch-games.mjs --raw     KBO가 준 것을 그대로 찍는다

   시험할 때
     KBO_FIXTURE  KBO를 부르지 않고 이 JSON 파일을 응답으로 삼는다
     KBO_OUT      data/games.json 대신 이 파일에 쓴다
   둘 다 시험용이다. 실제 실행에서는 쓰지 않는다.
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { toGames } from '../worker/kbo-schedule.js';

const KBO_URL = 'https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList';
const OUT = process.env.KBO_OUT
  ? new URL(process.env.KBO_OUT, 'file://' + process.cwd() + '/')
  : new URL('../data/games.json', import.meta.url);
const FIXTURE = process.env.KBO_FIXTURE || '';
const STADIUMS = new URL('../data/stadiums.json', import.meta.url);

const pad = (n) => String(n).padStart(2, '0');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const RAW = args.includes('--raw');

/** 서울 기준 오늘. Actions 러너는 UTC로 돈다. */
function seoulNow() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

async function fetchMonth(year, month) {
  // 시험용. KBO를 부르지 않고 받아 둔 응답을 읽는다.
  if (FIXTURE) return JSON.parse(readFileSync(FIXTURE, 'utf8'));

  const body = new URLSearchParams({
    leId: '1',
    srIdList: '0,9,6',
    seasonId: String(year),
    gameMonth: pad(month),
    teamId: ''                       // 비어 있어도 반드시 보내야 한다
  });
  const res = await fetch(KBO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      // 이 두 개가 없으면 KBO가 빈 응답을 준다.
      Referer: 'https://www.koreabaseball.com/Schedule/Schedule.aspx',
      'User-Agent': 'Mozilla/5.0 (compatible; kbo-myeongdang/1.0)'
    },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`KBO 응답 ${res.status} — ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON이 아닙니다 — ${text.slice(0, 200)}`);
  }
}

/* 표에 줄이 몇 개나 들어 있었는가.

   "한 경기도 못 읽었다"에는 두 가지가 섞여 있다. 비시즌이라 표가 원래
   비어 있는 것과, 표는 왔는데 우리가 못 읽는 것. 앞은 정상이고 뒤는 고장이다.
   줄 수를 세어 두면 둘을 가를 수 있다. */
function rowCount(payload) {
  let d = payload && payload.d !== undefined ? payload.d : payload;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (e) { return 0; }
  }
  return ((d && d.rows) || []).length;
}

/* 이번 달과 다음 달을 받는다.
   월말에 이번 달만 받으면 "다음 경기"가 하루 만에 비어 버린다. */
function monthsToFetch() {
  const t = seoulNow();
  const next = t.m === 12 ? { y: t.y + 1, m: 1 } : { y: t.y, m: t.m + 1 };
  return [{ y: t.y, m: t.m }, next];
}

async function main() {
  const months = monthsToFetch();
  const all = [];
  let failed = 0;
  let rows = 0;

  for (const { y, m } of months) {
    try {
      const payload = await fetchMonth(y, m);
      if (RAW) {
        console.log(`\n===== ${y}-${pad(m)} 원본 =====`);
        console.log(JSON.stringify(payload).slice(0, 4000));
        continue;
      }
      const games = toGames(payload, y);
      rows += rowCount(payload);
      console.log(`${y}-${pad(m)}: ${games.length}경기 (표 ${rowCount(payload)}줄)`);
      all.push(...games);
    } catch (e) {
      failed++;
      console.error(`${y}-${pad(m)} 실패: ${e.message}`);
    }
  }
  if (RAW) return;

  /* 한 달도 못 받았으면 파일을 건드리지 않는다.
     어제 것이라도 남아 있는 편이 빈 목록보다 낫다. */
  if (failed === months.length) {
    console.error('KBO에서 아무것도 받지 못했습니다. 기존 파일을 그대로 둡니다.');
    process.exitCode = 0;                 // 워크플로를 빨갛게 만들지 않는다
    return;
  }

  /* 표는 왔는데 한 경기도 읽지 못했다면 KBO가 구조를 바꾼 것이다. 이때도
     덮어쓰지 않는다 — 읽기가 깨졌을 뿐인데 기존 일정까지 날리면 안 된다. */
  if (!all.length && rows) {
    console.error('받기는 했는데 한 경기도 읽지 못했습니다. 표 구조가 바뀐 것 같습니다.');
    console.error('node scripts/fetch-games.mjs --raw 로 원본을 확인하세요.');
    process.exitCode = 1;                 // 이건 알아야 한다
    return;
  }

  // 비시즌이라 표가 원래 비어 있는 것은 고장이 아니다. 조용히 지나간다.
  if (!all.length) {
    console.log('두 달 모두 편성된 경기가 없습니다(비시즌). 기존 파일을 그대로 둡니다.');
    return;
  }

  /* 이 앱이 아는 구장의 경기만 남긴다.

     KBO는 열 구장을 한꺼번에 준다. 하지만 이 앱에는 아직 광주뿐이고,
     구장 정보가 없는 경기를 넣어 두면 화면에서는 구장 이름이 빈칸으로 뜨고
     데이터 검사는 "없는 구장 id"라며 빨개진다. 구장이 늘면 여기는 저절로
     따라 늘어난다 — stadiums.json만 보기 때문이다. */
  const known = new Set(
    (JSON.parse(readFileSync(STADIUMS, 'utf8')).stadiums || []).map((s) => s.id)
  );
  /* 같은 경기가 두 번 들어오면 한 번만 남긴다.
     월 경계에서 KBO가 겹쳐 주는 경우가 있고, 겹친 채로 커밋하면 데이터 검사가
     "같은 구장·같은 시각에 경기가 두 개"라며 막는다. */
  const uniq = [];
  const seen = new Set();
  for (const g of all) {
    const key = `${g.date}|${g.time}|${g.stadiumId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(g);
  }

  const mine = uniq.filter((g) => g.stadiumId && known.has(g.stadiumId));
  const dropped = uniq.length - mine.length;
  if (dropped) console.log(`다른 구장 ${dropped}경기는 넣지 않았습니다 (아는 구장: ${[...known].join(', ')}).`);

  if (!mine.length) {
    console.error('아는 구장의 경기가 하나도 없습니다. 기존 파일을 그대로 둡니다.');
    return;
  }

  mine.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

  const cur = JSON.parse(readFileSync(OUT, 'utf8'));

  /* 경기 목록이 그대로면 파일을 건드리지 않는다.
     updatedAt만 바뀐 커밋이 하루에 두 개씩 쌓이면 기록이 아니라 소음이다. */
  if (JSON.stringify(cur.games) === JSON.stringify(mine)) {
    console.log(`바뀐 것이 없습니다 (${mine.length}경기 그대로).`);
    return;
  }

  /* games와 updatedAt만 바꾼다. note·statusCodes·officialStatusUrl은
     저장소에서 관리하는 값이라 손대지 않는다. */
  const next = { ...cur, updatedAt: new Date().toISOString(), games: mine };

  if (DRY) {
    console.log(`\n[--dry] ${mine.length}경기. 파일은 쓰지 않았습니다.`);
    console.log(mine.slice(0, 3));
    return;
  }

  writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`\n총 ${mine.length}경기 저장.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
