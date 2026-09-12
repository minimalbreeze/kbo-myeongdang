/* 맞춤 명당 추천 — 데이터 기반 단순 가중합(지시서 19번).
   AI를 쓰지 않는다. 나중에 AI로 바꾸더라도 이 모듈만 교체하면 되도록 분리해 둔다.

   점수 규약: 모든 점수는 5점 만점이고 "높을수록 좋다".
   sunScore 5 = 햇빛 영향이 적다, weatherScore 5 = 비바람 영향이 적다. */
(function () {
  const PREFS = [
    { id: 'focus',  label: '경기 집중', emoji: '⚾', weights: { gameScore: 3, viewScore: 3 } },
    { id: 'cheer',  label: '응원',     emoji: '🔥', weights: { cheerScore: 4, gameScore: 1 } },
    { id: 'family', label: '가족',     emoji: '👨‍👩‍👧', weights: { facilityScore: 3, sunScore: 2, valueScore: 1 } },
    { id: 'couple', label: '커플',     emoji: '💑', weights: { viewScore: 2, photoScore: 2, facilityScore: 1 } },
    { id: 'photo',  label: '사진',     emoji: '📸', weights: { photoScore: 4, viewScore: 2 } },
    { id: 'value',  label: '가성비',   emoji: '💰', weights: { valueScore: 4, viewScore: 1 } }
  ];

  function weightsFor(prefIds) {
    const total = {};
    (prefIds || []).forEach((id) => {
      const p = PREFS.find((x) => x.id === id);
      if (!p) return;
      Object.keys(p.weights).forEach((k) => { total[k] = (total[k] || 0) + p.weights[k]; });
    });
    return total;
  }

  /* 점수 매기기.

     처음에는 "있는 점수만 골라 평균"을 냈는데, 그러면 한 축만 높은 구역이
     실제로 맞는 구역을 이겼다. 응원 기준인데 챔피언석이 1위로 나왔다 —
     응원 점수가 아예 없어서 경기 몰입도 하나만 평균이 됐기 때문이다.

     그래서 두 가지를 쓴다.
       기준 점수(0~75)  가중 평균에 "얼마나 알고 있는지"(coverage)를 곱한다.
                        모르는 축이 많으면 점수가 낮아진다 — 모르는 것을
                        좋다고 치지 않는다.
       근거 가산점(0~25) 출처들이 "이건 무엇에 좋은 자리"라고 공통으로 말한
                        경우(myeongdangFor)에만 붙는다. 지어낸 가점이 아니라
                        후기에 실제로 있던 말이다. */
  function scoreSection(section, weights, prefIds) {
    const totalWeight = Object.keys(weights).reduce((a, k) => a + weights[k], 0);
    if (!totalWeight) return null;

    let sum = 0, covered = 0, used = 0;
    Object.keys(weights).forEach((k) => {
      const v = section[k];
      if (typeof v !== 'number') return;
      sum += v * weights[k];
      covered += weights[k];
      used += 1;
    });

    const matched = (section.myeongdangFor || []).filter((x) => prefIds.includes(x)).length;
    const matchRatio = prefIds.length ? matched / prefIds.length : 0;

    // 점수도 없고 출처의 추천도 없으면 추천 대상이 아니다.
    if (!used && !matched) return null;

    const avg = covered ? sum / covered : 0;          // 0~5
    const coverage = covered / totalWeight;           // 0~1
    const base = (avg * coverage) / 5 * 75;
    return { value: Math.round(base + matchRatio * 25), coverage };
  }

  function rank(sections, prefIds, limit) {
    const prefs = prefIds || [];
    const weights = weightsFor(prefs);
    if (!Object.keys(weights).length) return [];
    const scored = (sections || [])
      .map((s) => {
        const r = scoreSection(s, weights, prefs);
        return r ? { section: s, score: r.value, coverage: r.coverage } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit == null ? 3 : limit);
  }

  window.KboRecommend = { PREFS, rank, weightsFor };
})();
