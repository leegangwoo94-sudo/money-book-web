// 포트폴리오 데이터 계층 — invest_trades 조회 + 보유 계산 + 야후 시세/환율
// 계층 규칙: render → MB.pf → MB.db 단방향
window.MB = window.MB || {};

MB.pf = (() => {
  const TABLE = 'invest_trades';
  const QUOTE_TTL = 10 * 60 * 1000; // 시세 캐시 10분

  // 야후는 CORS를 막으므로 공개 프록시 폴백 체인 사용 (직접 → 프록시들)
  const PROXIES = [
    (u) => u,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  // ── 클라우드 조회 ──────────────────────────────────────────
  async function fetchTrades(member = null) {
    let q = MB.db.client.from(TABLE).select('*')
      .order('date', { ascending: true })
      .order('local_id', { ascending: true });
    if (member) q = q.eq('member_id', member);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function fetchMembers() {
    const { data, error } = await MB.db.client.from(TABLE).select('member_id');
    if (error) throw error;
    return [...new Set(data.map((r) => r.member_id))].sort();
  }

  async function lastSynced() {
    const { data, error } = await MB.db.client.from(TABLE)
      .select('member_id, synced_at')
      .order('synced_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data[0] ?? null;
  }

  // 실제 배당: 가계부 수입 기록 중 카테고리/메모에 '배당'이 들어간 것
  async function fetchDividendIncome(member = null) {
    let q = MB.db.client.from('transactions').select('*').eq('type', 'income');
    if (member) q = q.eq('member_id', member);
    const { data, error } = await q;
    if (error) throw error;
    return data.filter((r) =>
      (r.category_name ?? '').includes('배당') || (r.memo ?? '').includes('배당'));
  }

  // ── 보유종목 계산 (앱과 동일한 이동평균: 매수만 평단 갱신, 매도는 수량 차감) ──
  function computeHoldings(rows) {
    const map = new Map(); // key: 종목명|통화
    for (const t of rows) {
      const key = `${t.name}|${t.currency}`;
      let p = map.get(key);
      if (!p) {
        p = { name: t.name, currency: t.currency, qty: 0, avg: 0, brokers: {} };
        map.set(key, p);
      }
      const q = Number(t.quantity);
      const price = Number(t.price);
      if (t.trade_type === 'buy') {
        p.avg = (p.qty * p.avg + q * price) / (p.qty + q);
        p.qty += q;
        p.brokers[t.broker] = (p.brokers[t.broker] ?? 0) + q;
      } else {
        p.qty -= q;
        p.brokers[t.broker] = (p.brokers[t.broker] ?? 0) - q;
      }
    }
    return [...map.values()].filter((p) => p.qty > 1e-9);
  }

  // 종목 → 야후 심볼 (미국은 티커 그대로, 국내는 종목명→코드 맵)
  function symbolFor(holding) {
    if (holding.currency === 'USD') return holding.name;
    return (MB.krSymbols ?? {})[holding.name] ?? null;
  }

  // ── 야후 시세 ──────────────────────────────────────────────
  async function fetchJson(url) {
    for (const wrap of PROXIES) {
      try {
        const res = await fetch(wrap(url), { signal: AbortSignal.timeout(9000) });
        if (!res.ok) continue;
        return await res.json();
      } catch { /* 다음 프록시로 폴백 */ }
    }
    throw new Error(`시세 조회 실패: ${url}`);
  }

  // 현재가 + 최근 1년 주당 배당 합계
  async function quote(symbol) {
    const cacheKey = `mb.quote.${symbol}`;
    try {
      const c = JSON.parse(localStorage.getItem(cacheKey));
      if (c && Date.now() - c.t < QUOTE_TTL) return c.v;
    } catch { /* 캐시 없음 */ }

    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/'
      + `${encodeURIComponent(symbol)}?range=1y&interval=1mo&events=div`;
    const json = await fetchJson(url);
    const r = json?.chart?.result?.[0];
    const price = r?.meta?.regularMarketPrice;
    if (typeof price !== 'number') throw new Error(`시세 없음: ${symbol}`);
    const div12m = Object.values(r.events?.dividends ?? {})
      .reduce((s, d) => s + (d.amount ?? 0), 0);
    const v = { price, div12m };
    try { localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), v })); } catch { /* 무시 */ }
    return v;
  }

  // USD/KRW 환율
  async function fx() {
    return (await quote('KRW=X')).price;
  }

  return {
    fetchTrades, fetchMembers, lastSynced, fetchDividendIncome,
    computeHoldings, symbolFor, quote, fx,
  };
})();
