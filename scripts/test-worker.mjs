/* KBO 일정 중계기의 표 읽기 시험.

   Worker 자체는 KBO에 물어봐야 확인되지만, 받은 표를 우리 모양으로 옮기는
   부분은 그것 없이도 시험할 수 있다. KBO 응답 모양을 본뜬 견본으로 건다.

   표 구조가 바뀌어 파싱이 깨지면 여기가 먼저 빨개진다. */
import { toGames, teamsOf, statusOf, plain, stadiumIdOf } from '../worker/kbo-schedule.js';

const cell = (t) => ({ Text: t });
const row  = (...cells) => ({ row: cells.map(cell) });

/* KBO 표를 본뜬 견본.
   같은 날 경기를 여러 줄로 쓰면서 날짜는 첫 줄에만 적는다(rowspan). */
const sample = {
  d: JSON.stringify({
    rows: [
      row('09.17(수)', '18:30', '<span>한화</span> vs <span>KIA</span>', '광주', '-'),
      row('18:30', '롯데 vs 삼성', '대구', '-'),
      row('09.18(목)', '18:30', 'LG 2 : 7 KIA', '광주', '-'),
      row('09.19(금)', '17:00', 'NC vs KIA', '광주', '우천취소')
    ]
  })
};

const ok = [];
const games = toGames(sample, 2026);

ok.push(['네 경기 모두 읽는다', games.length === 4]);
ok.push(['첫 경기 날짜 09-17', games[0].date === '2026-09-17']);
ok.push(['원정 한화 · 홈 KIA', games[0].awayName === '한화' && games[0].homeName === 'KIA']);
ok.push(['광주 → gwangju', games[0].stadiumId === 'gwangju']);
ok.push(['시각 18:30', games[0].time === '18:30']);

// rowspan — 날짜가 없는 줄은 앞 날짜를 이어받는다
ok.push(['날짜 없는 줄이 앞 날짜를 잇는다', games[1].date === '2026-09-17']);
ok.push(['대구 경기는 gwangju가 아니다', games[1].stadiumId === 'daegu']);

// 점수가 붙은 형식
ok.push(['점수형에서 팀을 뽑는다', games[2].awayName === 'LG' && games[2].homeName === 'KIA']);

// 취소는 공식 표에 적혀 있을 때만
ok.push(['우천취소 → canceled', games[3].status === 'canceled']);
ok.push(['그냥 편성된 경기는 scheduled', games[0].status === 'scheduled']);

// 추론 금지: 아무 말 없으면 unknown
ok.push(['단서가 없으면 unknown', statusOf(['09.20(토)', '경기'], false) === 'unknown']);

// 태그 걷어내기
ok.push(['태그를 걷어낸다', plain('<span>KIA</span>&nbsp;타이거즈') === 'KIA 타이거즈']);
ok.push(['vs 양쪽 태그 제거', teamsOf('<b>한화</b> vs <b>KIA</b>').home === 'KIA']);

// 구장 이름
ok.push(['잠실 → jamsil', stadiumIdOf('잠실') === 'jamsil']);
ok.push(['모르는 구장은 null', stadiumIdOf('어딘가') === null]);

// 깨진 입력에도 죽지 않는다
ok.push(['빈 응답은 빈 배열', toGames({}, 2026).length === 0]);
ok.push(['망가진 d도 빈 배열', toGames({ d: '{{{' }, 2026).length === 0]);

let fail = 0;
ok.forEach(([n, p]) => { if (!p) fail++; console.log((p ? '  PASS' : '  FAIL') + '  ' + n); });
console.log(fail ? `\n${fail}건 실패` : `\n일정 중계기 표 읽기 ${ok.length}건 전부 통과`);
process.exit(fail ? 1 : 0);
