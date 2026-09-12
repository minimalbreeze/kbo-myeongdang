// 데이터 검사기
//
// 왜 필요한가
//   이 서비스의 내용은 전부 data/*.json에 사람이 손으로 넣는다. 그런데 손으로 넣는
//   곳에서는 반드시 실수가 난다 — 없는 구장 id를 적거나, 가격에 음수가 들어가거나,
//   날짜 형식이 어긋나거나, 쉼표 하나를 빠뜨린다. 앱은 그런 값을 만나도 조용히
//   빈 화면을 내기 때문에 한참 뒤에야 알아차리게 된다.
//
//   이 스크립트는 그걸 커밋 전에 잡는다. CI에서도 돈다.
//
// 실행: node scripts/validate-data.mjs

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const errors = [];
const warns = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warns.push(`${file}: ${msg}`);

async function readJson(rel) {
  const text = await readFile(join(DATA, rel), 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    // 쉼표 하나 빠뜨렸을 때 몇 번째 줄인지 알려준다.
    const at = /position (\d+)/.exec(e.message);
    const line = at ? text.slice(0, Number(at[1])).split('\n').length : null;
    err(rel, `JSON 형식이 깨졌습니다${line ? ` (${line}번째 줄 근처)` : ''} — ${e.message}`);
    return null;
  }
}

const isYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isHm = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const isHttps = (v) => typeof v === 'string' && /^https:\/\//.test(v);

// 값이 있을 때만 검사한다 — null은 "정보 준비 중"이라는 뜻이므로 정상이다.
function ifPresent(v, check) { return v == null ? true : check(v); }

function checkPrice(file, where, price) {
  if (price == null) return;
  const n = typeof price === 'number' ? price : Number(String(price).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) { warn(file, `${where}: 가격 "${price}"에서 숫자를 읽지 못했습니다.`); return; }
  if (n < 0) err(file, `${where}: 가격이 음수입니다 (${price}).`);
}

function checkScore(file, where, key, v) {
  if (v == null) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    err(file, `${where}: ${key}가 숫자가 아닙니다 (${JSON.stringify(v)}).`);
  } else if (v < 0 || v > 5) {
    err(file, `${where}: ${key}는 0~5여야 하는데 ${v}입니다.`);
  }
}

function checkUrl(file, where, key, v) {
  if (v == null) return;
  if (!isHttps(v)) err(file, `${where}: ${key}가 https 주소가 아닙니다 (${JSON.stringify(v)}).`);
}

function checkUpdatedAt(file, where, v) {
  if (v == null) return;
  if (!isYmd(v)) err(file, `${where}: updatedAt은 YYYY-MM-DD여야 합니다 (${JSON.stringify(v)}).`);
}

async function main() {
  const stadiums = await readJson('stadiums.json');
  const teams = await readJson('teams.json');
  const seats = await readJson('seats.json');
  const games = await readJson('games.json');
  if (!stadiums || !teams || !seats || !games) return finish();

  // ---------- stadiums ----------
  const ids = new Set();
  for (const s of stadiums.stadiums || []) {
    const at = `stadiums[${s.id || '?'}]`;
    if (!s.id) { err('stadiums.json', `${at}: id가 없습니다.`); continue; }
    if (ids.has(s.id)) err('stadiums.json', `${at}: id가 중복됩니다.`);
    ids.add(s.id);

    for (const f of ['name', 'city', 'homeTeams']) {
      if (s[f] == null) err('stadiums.json', `${at}: ${f}는 반드시 있어야 합니다.`);
    }
    if (s.coordinates) {
      const { lat, lng } = s.coordinates;
      // 대한민국 범위를 크게 벗어나면 좌표를 잘못 넣은 것이다(위경도 뒤바꿈 등).
      if (!(lat >= 33 && lat <= 39)) err('stadiums.json', `${at}: 위도 ${lat}가 한국 범위(33~39) 밖입니다.`);
      if (!(lng >= 124 && lng <= 132)) err('stadiums.json', `${at}: 경도 ${lng}가 한국 범위(124~132) 밖입니다.`);
    }
    if (s.capacity != null && (typeof s.capacity !== 'number' || s.capacity <= 0)) {
      err('stadiums.json', `${at}: capacity가 양수가 아닙니다 (${s.capacity}).`);
    }
    checkUrl('stadiums.json', at, 'officialUrl', s.officialUrl);
    if (s.ticket) checkUrl('stadiums.json', at, 'ticket.url', s.ticket.url);
    checkUpdatedAt('stadiums.json', at, s.updatedAt);

    // verified는 "이 필드를 확인했다"는 표시다. 없는 필드를 확인했다고 하면 안 된다.
    for (const k of Object.keys(s.verified || {})) {
      if (!(k in s) && k !== 'ticket') warn('stadiums.json', `${at}: verified.${k}에 해당하는 필드가 없습니다.`);
      if (s.verified[k] === true && s[k] == null && k !== 'ticket') {
        err('stadiums.json', `${at}: verified.${k}가 true인데 값이 비어 있습니다.`);
      }
    }
    for (const src of s.sources || []) {
      if (!src.name) err('stadiums.json', `${at}: sources에 name이 없는 항목이 있습니다.`);
      if (src.url != null && !isHttps(src.url)) err('stadiums.json', `${at}: sources.url이 https가 아닙니다.`);
    }
  }
  if (!ids.size) err('stadiums.json', '구장이 하나도 없습니다.');

  const refStadium = (file, where, id) => {
    if (id != null && !ids.has(id)) err(file, `${where}: 없는 구장 id "${id}"를 가리킵니다. (있는 id: ${[...ids].join(', ')})`);
  };

  // ---------- teams ----------
  const teamIds = new Set();
  for (const t of teams.teams || []) {
    const at = `teams[${t.id || '?'}]`;
    if (!t.id) { err('teams.json', `${at}: id가 없습니다.`); continue; }
    if (teamIds.has(t.id)) err('teams.json', `${at}: id가 중복됩니다.`);
    teamIds.add(t.id);
    if (!t.name) err('teams.json', `${at}: name이 없습니다.`);
    refStadium('teams.json', at, t.homeStadium);
    checkUrl('teams.json', at, 'officialUrl', t.officialUrl);
    checkUrl('teams.json', at, 'shopUrl', t.shopUrl);
    if (t.color != null && !/^#[0-9a-fA-F]{6}$/.test(t.color)) {
      err('teams.json', `${at}: color가 #rrggbb 형식이 아닙니다 (${t.color}).`);
    }
    checkUpdatedAt('teams.json', at, t.updatedAt);
  }
  // 구장이 가리키는 홈팀이 실제로 있는지
  for (const s of stadiums.stadiums || []) {
    for (const tid of s.homeTeams || []) {
      if (!teamIds.has(tid)) err('stadiums.json', `stadiums[${s.id}]: 없는 팀 id "${tid}"를 가리킵니다.`);
    }
  }

  // ---------- seats ----------
  const scoreKeys = (seats.scoreFields || []).map((f) => f.key);
  if (!scoreKeys.length) err('seats.json', 'scoreFields가 비어 있습니다.');
  for (const [sid, entry] of Object.entries(seats.stadiums || {})) {
    refStadium('seats.json', `seats.stadiums.${sid}`, sid);
    const typeIds = new Set();
    for (const t of entry.seatTypes || []) {
      const at = `seats.${sid}.seatTypes[${t.id || '?'}]`;
      if (!t.id) err('seats.json', `${at}: id가 없습니다.`);
      else if (typeIds.has(t.id)) err('seats.json', `${at}: id가 중복됩니다.`);
      typeIds.add(t.id);
      if (!t.name) err('seats.json', `${at}: name이 없습니다.`);
    }
    const sectionIds = new Set();
    for (const sec of entry.sections || []) {
      const at = `seats.${sid}.sections[${sec.section || '?'}]`;
      if (!sec.section) err('seats.json', `${at}: section이 없습니다.`);
      else if (sectionIds.has(sec.section)) err('seats.json', `${at}: section이 중복됩니다.`);
      sectionIds.add(sec.section);
      for (const k of scoreKeys) checkScore('seats.json', at, k, sec[k]);
      checkPrice('seats.json', at, sec.price);
      checkUrl('seats.json', at, 'viewImage', sec.viewImage);
      checkUpdatedAt('seats.json', at, sec.updatedAt);
      // 시야 사진이 있으면 출처가 있어야 한다 — 누가 찍었는지 모르는 사진은 쓰지 않는다.
      if (sec.viewImage && !sec.viewSource) {
        err('seats.json', `${at}: viewImage가 있는데 viewSource(촬영 출처)가 없습니다.`);
      }
    }
  }

  // ---------- games ----------
  const statusCodes = Object.keys(games.statusCodes || {});
  if (!statusCodes.includes('unknown')) err('games.json', 'statusCodes에 unknown이 반드시 있어야 합니다(기본값).');
  checkUrl('games.json', 'games', 'officialStatusUrl', games.officialStatusUrl);
  const seen = new Set();
  for (const g of games.games || []) {
    const at = `games[${g.date || '?'} ${g.time || ''} ${g.stadiumId || ''}]`;
    if (!isYmd(g.date)) err('games.json', `${at}: date가 YYYY-MM-DD가 아닙니다.`);
    if (!isHm(g.time)) err('games.json', `${at}: time이 HH:MM이 아닙니다.`);
    refStadium('games.json', at, g.stadiumId);
    if (g.status != null && !statusCodes.includes(g.status)) {
      err('games.json', `${at}: 모르는 status "${g.status}" (가능: ${statusCodes.join(', ')})`);
    }
    if (!g.homeName || !g.awayName) err('games.json', `${at}: homeName/awayName이 필요합니다.`);
    const key = `${g.date}|${g.time}|${g.stadiumId}`;
    if (seen.has(key)) err('games.json', `${at}: 같은 구장·같은 시각에 경기가 두 개 있습니다.`);
    seen.add(key);
  }

  // ---------- 구장별 목록 파일 ----------
  for (const [file, pick] of [
    ['foods.json', (x) => x.storeName],
    ['shops.json', (x) => x.name],
    ['facilities.json', (x) => x.name]
  ]) {
    const d = await readJson(file);
    if (!d) continue;
    for (const [sid, list] of Object.entries(d.stadiums || {})) {
      refStadium(file, `${file}.stadiums.${sid}`, sid);
      (list || []).forEach((item, i) => {
        const at = `${file}.${sid}[${i}]`;
        if (!pick(item)) err(file, `${at}: 이름이 없습니다.`);
        checkPrice(file, at, item.price);
        checkUrl(file, at, 'officialUrl', item.officialUrl);
        checkUpdatedAt(file, at, item.updatedAt);
      });
    }
  }

  const transport = await readJson('transport.json');
  if (transport) {
    for (const [sid, t] of Object.entries(transport.stadiums || {})) {
      refStadium('transport.json', `transport.stadiums.${sid}`, sid);
      if (t && t.parking && t.parking.spaces != null &&
          (typeof t.parking.spaces !== 'number' || t.parking.spaces < 0)) {
        err('transport.json', `transport.${sid}: parking.spaces가 0 이상 숫자가 아닙니다.`);
      }
      if (t) checkUpdatedAt('transport.json', `transport.${sid}`, t.updatedAt);
    }
  }

  // ---------- 좌석 지도 ----------
  let mapFiles = [];
  try { mapFiles = (await readdir(join(DATA, 'map'))).filter((f) => f.endsWith('.json')); } catch (e) {}
  for (const f of mapFiles) {
    const rel = `map/${f}`;
    const m = await readJson(rel);
    if (!m) continue;
    const sid = f.replace(/\.json$/, '');
    refStadium(rel, rel, sid);
    if (!/^[\d.\-]+ [\d.\-]+ [\d.\-]+ [\d.\-]+$/.test(String(m.viewBox || ''))) {
      err(rel, `viewBox가 "x y w h" 형식이 아닙니다 (${m.viewBox}).`);
    }
    const zoneIds = new Set();
    for (const z of m.zones || []) {
      const at = `zones[${z.id || "?"}]`;
      if (!z.id) err(rel, `${at}: id가 없습니다.`);
      else if (zoneIds.has(z.id)) err(rel, `${at}: id가 중복됩니다.`);
      zoneIds.add(z.id);
      if (!z.name) err(rel, `${at}: name이 없습니다.`);
      for (const k of ['a0', 'a1', 'r0', 'r1']) {
        if (typeof z[k] !== 'number') err(rel, `${at}: ${k}가 숫자가 아닙니다.`);
      }
      if (typeof z.a0 === 'number' && (z.a0 < 0 || z.a0 > 360)) err(rel, `${at}: a0는 0~360이어야 합니다.`);
      if (typeof z.a1 === 'number' && (z.a1 < 0 || z.a1 > 360)) err(rel, `${at}: a1은 0~360이어야 합니다.`);
      if (typeof z.r0 === 'number' && typeof z.r1 === 'number' && z.r0 >= z.r1) {
        err(rel, `${at}: r0(${z.r0})가 r1(${z.r1})보다 작아야 합니다.`);
      }
      const okConf = ['verified', 'corroborated', 'unplaced'];
      if (z.confidence != null && !okConf.includes(z.confidence)) {
        err(rel, `${at}: confidence는 ${okConf.join(' / ')} 중 하나여야 합니다 (${z.confidence}).`);
      }
      if (z.verified !== true && !z.why) {
        warn(rel, `${at}: 아직 확인 전인데 why(왜 확인 중인지)가 없습니다. 화면이 이유를 말해주지 못합니다.`);
      }
    }
    if (!zoneIds.size) warn(rel, '구역이 하나도 없습니다.');
  }

  // 지도 없는 구장은 좌석 화면이 "준비 중"만 나온다 — 오류는 아니고 알림이다.
  for (const id of ids) {
    if (!mapFiles.includes(`${id}.json`)) warn('map', `구장 "${id}"의 좌석 지도(data/map/${id}.json)가 없습니다.`);
  }

  finish();
}

function finish() {
  if (warns.length) {
    console.log(`\n알림 ${warns.length}건`);
    warns.forEach((w) => console.log('  · ' + w));
  }
  if (errors.length) {
    console.log(`\n오류 ${errors.length}건 — 고쳐야 합니다`);
    errors.forEach((e) => console.log('  ✗ ' + e));
    console.log('');
    process.exit(1);
  }
  console.log(`\n데이터 검사 통과${warns.length ? ` (알림 ${warns.length}건은 오류가 아닙니다)` : ''}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
