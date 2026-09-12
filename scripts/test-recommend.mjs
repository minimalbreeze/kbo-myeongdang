// 추천 알고리즘 테스트
//
// 왜 필요한가
//   한 번 크게 틀린 적이 있다. "있는 점수만 골라 평균"을 내던 시절, 응원 기준인데
//   챔피언석이 1위로 나왔다 — 응원 점수가 아예 없어서 경기 몰입도 하나만 평균이
//   됐기 때문이다. 눈으로 보기 전에는 몰랐다. 그래서 취향별 1위를 고정해 둔다.
//
// 실행: node scripts/test-recommend.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const w = {};
new Function('window', await readFile(join(ROOT, 'js/recommend.js'), 'utf8'))(w);
const Rec = w.KboRecommend;

const seats = JSON.parse(await readFile(join(ROOT, 'data/seats.json'), 'utf8'));
const sections = seats.stadiums.gwangju.sections;

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

const top = (prefs) => {
  const r = Rec.rank(sections, prefs);
  return r.length ? r[0].section.section : null;
};

// ---------- 실제 데이터로 ----------
// 출처들이 공통으로 말한 내용과 순위가 맞아야 한다.
check('경기 집중 1위는 홈 뒤쪽 자리', ['champion', 'k9'].includes(top(['focus'])), top(['focus']));
check('응원 1위는 3루 K8석', top(['cheer']) === 'k8-3b', top(['cheer']));
check('가성비 1위는 외야 자유석', top(['value']) === 'outfield', top(['value']));
check('커플 1위는 테이블석', top(['couple']) === 'table', top(['couple']));
check('가족 1위는 테이블석', top(['family']) === 'table', top(['family']));

// 후기가 없는 취향은 점수가 낮아야 한다 — 모르는 것을 좋다고 치지 않는다.
const photo = Rec.rank(sections, ['photo']);
check('사진 취향은 근거가 적어 1위 점수가 50 미만', photo[0].score < 50, photo[0].score);

// ---------- 규칙 ----------
const fixture = [
  { section: 'allrounder', viewScore: 4, gameScore: 4, cheerScore: 4, valueScore: 4, photoScore: 4, facilityScore: 4 },
  { section: 'onetrick',   gameScore: 5 },                                  // 응원 점수 없음
  { section: 'cheerhero',  cheerScore: 5, gameScore: 3 },
  { section: 'nodata',     seatName: '평가 없음' },
  { section: 'onlysource', myeongdangFor: ['cheer'] }                        // 점수는 없고 출처 추천만
];
check('응원 1위는 응원 점수가 있는 쪽', Rec.rank(fixture, ['cheer'])[0].section.section === 'cheerhero',
      Rec.rank(fixture, ['cheer'])[0].section.section);
// rank()는 기본이 상위 3개라, 순위 비교에는 전체를 받아야 한다.
const allCheer = Rec.rank(fixture, ['cheer'], 10).map((r) => r.section.section);
check('한 축만 아는 구역이 골고루 아는 구역을 이기지 않는다',
      allCheer.indexOf('onetrick') > allCheer.indexOf('allrounder'), allCheer.join(' > '));
check('점수도 출처 추천도 없으면 순위에서 빠진다',
      Rec.rank(fixture, ['cheer'], 10).every((r) => r.section.section !== 'nodata'));
check('점수가 없어도 출처가 추천했으면 순위에 든다',
      Rec.rank(fixture, ['cheer'], 10).some((r) => r.section.section === 'onlysource'));
check('선택이 없으면 빈 결과', Rec.rank(sections, []).length === 0);
check('빈 데이터에서도 안전', Rec.rank([], ['focus']).length === 0);
check('최대 3개', Rec.rank(sections, ['focus', 'cheer', 'value']).length === 3);
check('점수는 0~100', Rec.rank(sections, ['focus'], 10).every((r) => r.score >= 0 && r.score <= 100));
check('복수 선택은 가중치를 더한다',
      JSON.stringify(Rec.weightsFor(['focus', 'cheer'])) === JSON.stringify({ gameScore: 4, viewScore: 3, cheerScore: 4 }));

let failed = 0;
results.forEach((r) => {
  if (!r.pass) failed++;
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.pass ? '' : `  (실제: ${r.detail})`));
});
console.log(failed ? `\n${failed}건 실패\n` : `\n추천 테스트 ${results.length}건 전부 통과\n`);
process.exit(failed ? 1 : 0);
