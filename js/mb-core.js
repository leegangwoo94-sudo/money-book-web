// 공통 코어 — db(supabase 클라이언트) / api(데이터 접근) / period(정산기간) / format(표기)
// 계층 규칙: render → api → db 단방향. UI 코드는 이 파일을 수정하지 않는다.
window.MB = window.MB || {};

// ── DB: supabase 클라이언트 싱글턴 ─────────────────────────
MB.db = (() => {
  let client = null;

  function init(creds) {
    client = window.supabase.createClient(creds.url, creds.key);
    return client;
  }

  return {
    init,
    get client() {
      if (!client) throw new Error('MB.db.init() 먼저 호출 필요');
      return client;
    },
  };
})();

// ── PERIOD: 정산기간 계산 (Flutter MonthlyPeriod/periodEnd와 동일 로직) ──
MB.period = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const toDb = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // offset: 0=이번 정산기간, -1=지난 기간 …
  function range(offset = 0) {
    const day = MB.config.settlementDay;
    const now = new Date();
    let start = now.getDate() >= day
      ? new Date(now.getFullYear(), now.getMonth(), day)
      : new Date(now.getFullYear(), now.getMonth() - 1, day);
    start = new Date(start.getFullYear(), start.getMonth() + offset, day);
    // 종료일 = 다음 정산 시작일의 전날 (앱 periodEnd와 동일)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, day);
    end.setDate(end.getDate() - 1);
    return { from: toDb(start), to: toDb(end), start, end };
  }

  function label(r) {
    return `${r.start.getFullYear()}-${pad(r.start.getMonth() + 1)}`;
  }

  return { range, label, toDb };
})();

// ── FORMAT: 금액·날짜·상대시간 ──────────────────────────────
MB.format = (() => {
  const comma = (n) => Number(n).toLocaleString('ko-KR');
  const won = (n) => `₩${comma(n)}`;

  function timeAgo(iso) {
    if (!iso) return '기록 없음';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }

  return { comma, won, timeAgo };
})();

// ── API: 데이터 접근 계층 ──────────────────────────────────
MB.api = (() => {
  const TABLE = 'transactions';

  // 기간 내 거래 (member가 null이면 전체 가족)
  async function fetchByRange(from, to, member = null) {
    let q = MB.db.client.from(TABLE).select('*')
      .gte('date', from).lte('date', to)
      .order('date', { ascending: false })
      .order('local_id', { ascending: false });
    if (member) q = q.eq('member_id', member);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  // 가족 구성원 목록 (DB에서 자동 인식)
  async function fetchMembers() {
    const { data, error } = await MB.db.client.from(TABLE).select('member_id');
    if (error) throw error;
    return [...new Set(data.map((r) => r.member_id))].sort();
  }

  // 마지막 동기화 시각
  async function lastSynced() {
    const { data, error } = await MB.db.client.from(TABLE)
      .select('member_id, synced_at')
      .order('synced_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data[0] ?? null;
  }

  // 거래 목록 → 요약 집계 (브라우저에서 계산 — 가족 규모면 충분)
  function aggregate(rows) {
    const sum = { income: 0, expense: 0, byCategory: {}, byMember: {} };
    for (const r of rows) {
      if (r.type === 'income') {
        sum.income += r.amount;
      } else {
        sum.expense += r.amount;
        const cat = `${r.category_emoji} ${r.category_name}`;
        sum.byCategory[cat] = (sum.byCategory[cat] ?? 0) + r.amount;
      }
      sum.byMember[r.member_id] = (sum.byMember[r.member_id] ?? 0)
        + (r.type === 'expense' ? r.amount : 0);
    }
    sum.balance = sum.income - sum.expense;
    return sum;
  }

  return { fetchByRange, fetchMembers, lastSynced, aggregate };
})();
