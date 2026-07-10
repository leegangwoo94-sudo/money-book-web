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

  // ── 종목 검색 (stocks-all.js 데이터 — 앱의 검색과 동일 원천) ──
  // 반환: { name(표시명: 국내=종목명, 미국=티커), symbol, currency, label }
  function searchStocks(query, limit = 20) {
    const q = query.trim().toLowerCase();
    if (!q || !MB.stockData) return [];
    const starts = [];
    const contains = [];
    const push = (sym, name, isKr) => {
      const item = {
        name: isKr ? name : sym,
        symbol: sym,
        currency: isKr ? 'KRW' : 'USD',
        label: name,
        market: isKr ? 'KR' : 'US',
      };
      const n = name.toLowerCase();
      const s = sym.toLowerCase();
      if (n.startsWith(q) || s.startsWith(q)) starts.push(item);
      else if (n.includes(q) || s.includes(q)) contains.push(item);
    };
    for (const [sym, name] of MB.stockData.kr) {
      if (starts.length >= limit) break;
      push(sym, name, true);
    }
    for (const [sym, name] of MB.stockData.us) {
      if (starts.length >= limit) break;
      push(sym, name, false);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  // ── 절세계좌 (웹에서 직접 입력 — pf_tax_accounts + pf_tax_holdings) ──
  const tax = (() => {
    const T = 'pf_tax_accounts';
    const TH = 'pf_tax_holdings';
    const missing = (e) => e?.code === 'PGRST205' || e?.code === '42P01';

    async function list(member = null) {
      let q = MB.db.client.from(T).select('*').order('member').order('account_type');
      if (member) q = q.eq('member', member);
      const { data, error } = await q;
      if (error) {
        if (missing(error)) return { ready: false, rows: [] }; // 테이블 미생성
        throw error;
      }
      // 계좌별 보유종목 (테이블 없으면 빈 목록으로 동작)
      let holdings = [];
      if (data.length > 0) {
        const { data: h, error: he } = await MB.db.client.from(TH)
          .select('*').in('account_id', data.map((r) => r.id));
        if (he && !missing(he)) throw he;
        holdings = h ?? [];
      }
      return { ready: true, rows: data, holdings };
    }

    async function insertHolding(row) {
      const { data, error } = await MB.db.client.from(TH).insert(row).select().single();
      if (error) throw error;
      return data;
    }

    async function removeHolding(id) {
      const { error } = await MB.db.client.from(TH).delete().eq('id', id);
      if (error) throw error;
    }

    async function insert(row) {
      const { error } = await MB.db.client.from(T).insert(row);
      if (error) throw error;
    }

    async function update(id, row) {
      const { error } = await MB.db.client.from(T)
        .update({ ...row, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    }

    async function remove(id) {
      const { error } = await MB.db.client.from(T).delete().eq('id', id);
      if (error) throw error;
    }

    return { list, insert, update, remove, insertHolding, removeHolding };
  })();

  return {
    fetchTrades, fetchMembers, lastSynced, fetchDividendIncome,
    computeHoldings, symbolFor, quote, fx, tax, searchStocks,
  };
})();
