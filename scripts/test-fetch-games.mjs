/* data/games.json을 채우는 스크립트의 시험.

   이 스크립트는 Actions에서 아무도 안 볼 때 돌면서 저장소에 커밋한다.
   그러니 KBO를 부르지 않고도 확인할 수 있는 것은 전부 여기서 확인한다 —
   아는 구장만 남기는가, 겹친 경기를 한 번만 넣는가, 바뀐 게 없으면
   파일을 건드리지 않는가, 그리고 쓴 결과가 데이터 검사를 통과하는가.

   KBO 응답 대신 견본 파일을 읽히고(KBO_FIXTURE), 실제 데이터 대신
   임시 파일에 쓰게 한다(KBO_OUT). */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kbo-games-'));
const out = join(dir, 'games.json');
const fixture = join(dir, 'fixture.json');

const cell = (t) => ({ Text: t });
const row = (...cells) => ({ row: cells.map(cell) });

/* 두 달을 다 이 견본으로 받는다. 그래서 같은 경기가 두 번 들어온다 —
   겹침을 걸러내는지 보기에 마침 좋다. */
writeFileSync(fixture, JSON.stringify({
  d: JSON.stringify({
    rows: [
      row('09.17(수)', '18:30', '한화 vs KIA', '광주', '-'),
      row('18:30', '롯데 vs 삼성', '대구', '-'),          // 아직 없는 구장
      row('09.18(목)', '17:00', 'LG vs KIA', '광주', '우천취소'),
      row('09.16(화)', '18:30', 'NC vs KIA', '광주', '-')  // 순서가 뒤엉킨 줄
    ]
  })
}));

copyFileSync(join(root, 'data', 'games.json'), out);

function run() {
  return execFileSync('node', [join(root, 'scripts', 'fetch-games.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, KBO_FIXTURE: fixture, KBO_OUT: out }
  });
}

const ok = [];
const log1 = run();
const wrote = JSON.parse(readFileSync(out, 'utf8'));
const games = wrote.games;

ok.push(['광주 경기만 남는다', games.length === 3]);
ok.push(['다른 구장은 들어오지 않는다', games.every((g) => g.stadiumId === 'gwangju')]);
ok.push(['겹친 경기는 한 번만', new Set(games.map((g) => g.date + g.time)).size === games.length]);
/* 연도는 스크립트가 서울 기준 오늘에서 가져온다. 시험도 같은 값을 쓴다 —
   해가 바뀌었다고 시험이 빨개지면 안 된다. */
const year = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
ok.push(['날짜순으로 정렬한다', games[0].date === `${year}-09-16`]);
ok.push(['취소는 공식 표에 적힌 대로',
  games.find((g) => g.date === `${year}-09-18`).status === 'canceled']);
ok.push(['updatedAt을 남긴다', typeof wrote.updatedAt === 'string' && wrote.updatedAt.length > 0]);
ok.push(['다른 구장을 건너뛴 것을 알린다', /다른 구장/.test(log1)]);

// statusCodes 같은 기존 내용은 그대로 둔다 — games와 updatedAt만 바꾼다.
const orig = JSON.parse(readFileSync(join(root, 'data', 'games.json'), 'utf8'));
ok.push(['statusCodes를 지우지 않는다',
  JSON.stringify(wrote.statusCodes) === JSON.stringify(orig.statusCodes)]);
ok.push(['officialStatusUrl을 지우지 않는다', wrote.officialStatusUrl === orig.officialStatusUrl]);

// 두 번째 실행: 바뀐 것이 없으면 파일을 건드리지 않는다(소음 커밋 방지).
const before = readFileSync(out, 'utf8');
const log2 = run();
ok.push(['같은 결과면 다시 쓰지 않는다', readFileSync(out, 'utf8') === before]);
ok.push(['바뀐 것이 없다고 알린다', /바뀐 것이 없습니다/.test(log2)]);

// 쓴 결과가 데이터 검사를 통과해야 한다. 여기서 막지 못하면 Actions가 빨개진다.
let passed = true;
try {
  const tmpData = JSON.parse(readFileSync(out, 'utf8'));
  for (const g of tmpData.games) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date)) passed = false;
    if (g.time != null && !/^\d{2}:\d{2}$/.test(g.time)) passed = false;
    if (!g.homeName || !g.awayName) passed = false;
    if (!Object.keys(tmpData.statusCodes).includes(g.status)) passed = false;
  }
} catch (e) { passed = false; }
ok.push(['쓴 경기가 데이터 검사 규칙에 맞는다', passed]);

let fail = 0;
ok.forEach(([n, p]) => { if (!p) fail++; console.log((p ? '  PASS' : '  FAIL') + '  ' + n); });
console.log(fail ? `\n${fail}건 실패` : `\n일정 받기 ${ok.length}건 전부 통과`);
process.exit(fail ? 1 : 0);
