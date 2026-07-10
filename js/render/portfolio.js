// 포트폴리오 렌더 — 요약 카드 + 비중/손익/배당 차트 + 보유 종목 테이블
window.MB = window.MB || {};
MB.render = MB.render || {};

MB.render.portfolio = (() => {
  const PALETTE = ['#4E9CF5', '#4ADE80', '#FBBF24', '#F87171', '#A78BFA',
    '#2DD4BF', '#F472B6', '#8FC5FF', '#FCA5A5', '#94A3B8'];
  const US_COLOR = '#4E9CF5';
  const KR_COLOR = '#F87171';

  // 절세 정책 상수 — 2026 현행 기준 (세법 개정 시 여기만 수정)
  const TAX_POLICY = {
    pensionCap: 6_000_000,   // 연금저축 세액공제 한도 (연)
    totalCap: 9_000_000,     // 연금저축+IRP 합산 세액공제 한도 (연)
    rateLow: 0.165,          // 총급여 5,500만 이하 공제율 (지방소득세 포함)
    rateHigh: 0.132,         // 총급여 5,500만 초과 공제율
    isaFreeGeneral: 2_000_000, // ISA 일반형 비과세 한도
    isaFreeSeomin: 4_000_000,  // ISA 서민형 비과세 한도
    isaRate: 0.099,          // ISA 비과세 초과분 분리과세율
    normalRate: 0.154,       // 일반계좌 금융소득세율 (절세효과 비교용)
  };

  const state = { member: null, members: [], charts: [], taxReady: false, taxRows: [] };

  const won = (n) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
  const signWon = (n) => `${n >= 0 ? '+' : '-'}₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`;
  const pct = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
  const qtyFmt = (n) => Number(n.toFixed(6)).toLocaleString('ko-KR');
  const native = (n, cur) => cur === 'USD'
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₩${Math.round(n).toLocaleString('ko-KR')}`;
  const plClass = (n) => (n > 0 ? 'value-income' : n < 0 ? 'value-expense' : '');

  function card({ title, value, valueClass = '', badge = null, sub = null }) {
    return `
      <div class="mb-card">
        <div class="card-title">${title}</div>
        <div class="card-value ${valueClass}">${value}</div>
        ${badge ? `<span class="card-badge ${badge.cls}">${badge.text}</span>` : ''}
        ${sub ? `<div class="mb-sync-note">${sub}</div>` : ''}
      </div>`;
  }

  function addChart(canvas, config) {
    const c = new Chart(canvas, config);
    state.charts.push(c);
    return c;
  }

  function destroyCharts() {
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
  }

  function donut(wrap, labels, values, fmt, colors = PALETTE) {
    if (values.length === 0 || values.every((v) => v <= 0)) {
      wrap.innerHTML = '<div class="mb-empty" style="border:none">데이터가 없어요</div>';
      return;
    }
    wrap.innerHTML = '<canvas></canvas>';
    const total = values.reduce((a, b) => a + b, 0);
    addChart(wrap.querySelector('canvas'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderColor: '#1A1D23', borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.parsed)} (${(ctx.parsed * 100 / total).toFixed(1)}%)`,
            },
          },
        },
      },
    });
  }

  function bars(wrap, labels, datasets, fmt) {
    wrap.innerHTML = '<canvas></canvas>';
    addChart(wrap.querySelector('canvas'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: datasets.length > 1
            ? { position: 'bottom', labels: { boxWidth: 12 } } : { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#2E333D' }, ticks: { callback: (v) => v.toLocaleString('ko-KR') } },
        },
      },
    });
  }

  // ── 데이터 조립: 보유종목 + 시세 + 환율 ──
  async function build() {
    const [trades, dividendRows, tax] = await Promise.all([
      MB.pf.fetchTrades(state.member),
      MB.pf.fetchDividendIncome(state.member).catch(() => []),
      MB.pf.tax.list(state.member).catch(() => ({ ready: true, rows: [] })),
    ]);
    const holdings = MB.pf.computeHoldings(trades);

    // 시세·환율 병렬 조회 (실패한 종목은 평단으로 표시)
    const fxP = MB.pf.fx().catch(() => null);
    await Promise.all(holdings.map(async (h) => {
      const sym = MB.pf.symbolFor(h);
      h.symbol = sym;
      try {
        if (!sym) throw new Error('심볼 없음');
        const q = await MB.pf.quote(sym);
        h.price = q.price;
        h.div12m = q.div12m;
        h.hasQuote = true;
      } catch {
        h.price = h.avg;
        h.div12m = 0;
        h.hasQuote = false;
      }
    }));
    // 절세계좌 보유종목 시세 (계좌 평가금액 자동 계산용)
    const taxHoldings = tax.holdings ?? [];
    await Promise.all(taxHoldings.map(async (h) => {
      const sym = h.symbol
        || (h.currency === 'USD' ? h.name : (MB.krSymbols ?? {})[h.name])
        || null;
      try {
        if (!sym) throw new Error('심볼 없음');
        h.price = (await MB.pf.quote(sym)).price;
        h.hasQuote = true;
      } catch {
        h.price = Number(h.avg_price);
        h.hasQuote = false;
      }
    }));

    const usdKrw = await fxP;

    // 절세계좌: 보유종목이 있으면 평가금액 = 예수금 + Σ(수량×현재가×환율), 없으면 직접입력값
    for (const h of taxHoldings) {
      const rate = h.currency === 'USD' ? (usdKrw ?? 0) : 1;
      h.valuationKrw = Number(h.quantity) * h.price * rate;
    }
    const byAccount = {};
    for (const h of taxHoldings) {
      (byAccount[h.account_id] = byAccount[h.account_id] ?? []).push(h);
    }
    for (const r of tax.rows) {
      r.holdings = byAccount[r.id] ?? [];
      r.computedValue = r.holdings.length > 0
        ? Number(r.cash ?? 0) + r.holdings.reduce((s, h) => s + h.valuationKrw, 0)
        : Number(r.value);
    }

    // 원화 환산 및 파생값
    for (const h of holdings) {
      const rate = h.currency === 'USD' ? (usdKrw ?? 0) : 1;
      h.fxOk = h.currency !== 'USD' || usdKrw != null;
      h.investedKrw = h.qty * h.avg * rate;
      h.valuationKrw = h.qty * h.price * rate;
      h.plKrw = h.valuationKrw - h.investedKrw;
      h.plRate = h.investedKrw > 0 ? h.plKrw / h.investedKrw : 0;
      h.annualDivKrw = (h.div12m ?? 0) * h.qty * rate;
    }
    holdings.sort((a, b) => b.valuationKrw - a.valuationKrw);

    const year = String(new Date().getFullYear());
    const actualDiv = dividendRows
      .filter((r) => (r.date ?? '').startsWith(year))
      .reduce((s, r) => s + r.amount, 0);

    return { holdings, usdKrw, actualDiv, year, tax };
  }

  function renderAll(root, data) {
    const { holdings, usdKrw, actualDiv, year, tax } = data;
    destroyCharts();
    state.taxReady = tax.ready;
    state.taxRows = tax.rows;

    const stockVal = holdings.reduce((s, h) => s + h.valuationKrw, 0);
    const stockInv = holdings.reduce((s, h) => s + h.investedKrw, 0);
    const taxVal = tax.rows.reduce((s, r) => s + Number(r.computedValue ?? r.value), 0);
    const taxPrin = tax.rows.reduce((s, r) => s + Number(r.principal), 0);
    const totalVal = stockVal + taxVal;
    const totalInv = stockInv + taxPrin;
    const totalPl = totalVal - totalInv;
    const totalRate = totalInv > 0 ? totalPl / totalInv : 0;
    const winners = holdings.filter((h) => h.plKrw > 0).length;
    const losers = holdings.filter((h) => h.plKrw < 0).length;
    const estDiv = holdings.reduce((s, h) => s + h.annualDivKrw, 0);
    const estYield = totalVal > 0 ? estDiv / totalVal : 0;
    const noQuote = holdings.filter((h) => !h.hasQuote);

    // 요약 카드
    root.querySelector('#pf-cards').innerHTML = [
      card({ title: '💰 총 평가금액', value: won(totalVal) }),
      card({ title: '💵 총 투자원금', value: won(totalInv) }),
      card({
        title: '📈 총 손익(₩)', value: signWon(totalPl), valueClass: plClass(totalPl),
        badge: {
          cls: totalPl > 0 ? 'badge-down' : totalPl < 0 ? 'badge-up' : 'badge-flat',
          text: `${totalPl >= 0 ? '↑' : '↓'} ${pct(totalRate)}`,
        },
      }),
      card({ title: '🎯 총 수익률', value: pct(totalRate), valueClass: plClass(totalPl) }),
    ].join('');

    root.querySelector('#pf-cards2').innerHTML = [
      card({ title: '📦 보유 종목 수', value: `${holdings.length}개` }),
      card({
        title: '⚖️ 수익 / 손실 종목',
        value: `<span class="value-income">${winners}</span> / <span class="value-expense">${losers}</span>`,
      }),
      card({
        title: `💸 ${year}년 실제 배당`, value: won(actualDiv),
        sub: '가계부 수입 중 \'배당\' 기록 합계',
      }),
      card({
        title: '🌱 연간 예상배당', value: won(estDiv),
        sub: '최근 1년 주당 배당 × 보유수량',
      }),
      card({ title: '📊 예상 배당수익률', value: `${(estYield * 100).toFixed(2)}%` }),
      card({
        title: '🛡️ 절세계좌 평가금액', value: won(taxVal),
        sub: '연금저축 · IRP · ISA 합계',
      }),
    ].join('');

    // 비중 도넛
    donut(root.querySelector('#pf-weight'),
      holdings.map((h) => h.name), holdings.map((h) => h.valuationKrw), won);

    const usSum = holdings.filter((h) => h.currency === 'USD')
      .reduce((s, h) => s + h.valuationKrw, 0);
    const krSum = totalVal - usSum;
    donut(root.querySelector('#pf-region'), ['US 해외', 'KR 국내'], [usSum, krSum],
      won, [US_COLOR, KR_COLOR]);

    const byBroker = {};
    for (const h of holdings) {
      const totalQty = Object.values(h.brokers).reduce((a, b) => a + b, 0);
      for (const [broker, q] of Object.entries(h.brokers)) {
        if (q <= 1e-9 || totalQty <= 0) continue;
        byBroker[broker] = (byBroker[broker] ?? 0) + h.valuationKrw * (q / totalQty);
      }
    }
    for (const r of tax.rows) {
      const b = r.broker || '기타';
      byBroker[b] = (byBroker[b] ?? 0) + Number(r.computedValue ?? r.value);
    }
    const brokerEntries = Object.entries(byBroker).sort((a, b) => b[1] - a[1]);
    donut(root.querySelector('#pf-broker'),
      brokerEntries.map(([k]) => k), brokerEntries.map(([, v]) => v), won);

    // 계좌 구분 (일반투자 vs 절세계좌 유형별)
    const byAcct = {};
    if (stockVal > 0) byAcct['일반투자'] = stockVal;
    for (const r of tax.rows) {
      const label = typeShort(r.account_type);
      byAcct[label] = (byAcct[label] ?? 0) + Number(r.computedValue ?? r.value);
    }
    donut(root.querySelector('#pf-acct'),
      Object.keys(byAcct), Object.values(byAcct), won);

    renderTax(root, tax);

    // 보유 종목 테이블
    const tbody = holdings.map((h) => {
      const brokers = Object.entries(h.brokers)
        .filter(([, q]) => q > 1e-9).map(([b]) => b).join('·');
      const mark = h.hasQuote ? '' : ' <span title="시세 조회 실패 — 평단으로 표시">※</span>';
      return `
        <tr>
          <td><span class="pf-badge ${h.currency === 'USD' ? 'us' : 'kr'}">${h.currency === 'USD' ? 'US' : 'KR'}</span></td>
          <td class="pf-name">${h.name}</td>
          <td>${brokers}</td>
          <td>${qtyFmt(h.qty)}</td>
          <td>${native(h.avg, h.currency)}</td>
          <td>${native(h.price, h.currency)}${mark}</td>
          <td>${won(h.valuationKrw)}</td>
          <td>${won(h.investedKrw)}</td>
          <td class="${plClass(h.plKrw)}">${signWon(h.plKrw)}</td>
          <td class="${plClass(h.plKrw)}">${pct(h.plRate)}</td>
          <td>${h.annualDivKrw > 0 ? won(h.annualDivKrw) : '—'}</td>
        </tr>`;
    }).join('');
    root.querySelector('#pf-table-wrap').innerHTML = holdings.length === 0
      ? '<div class="mb-empty" style="border:none">아직 투자 기록이 없어요. 앱의 투자 탭에서 기록하면 자동으로 나타나요.</div>'
      : `<table class="mb-table">
          <thead><tr>
            <th>시장</th><th>종목명</th><th>증권사</th><th>수량</th><th>평균단가</th><th>현재가</th>
            <th>평가금액(₩)</th><th>투자원금(₩)</th><th>손익(₩)</th><th>수익률</th><th>연간배당(₩)</th>
          </tr></thead><tbody>${tbody}</tbody></table>`;

    // 종목별 차트
    const labels = holdings.map((h) => h.name);
    bars(root.querySelector('#pf-pl'), labels, [{
      label: '손익(₩)',
      data: holdings.map((h) => Math.round(h.plKrw)),
      backgroundColor: holdings.map((h) => (h.plKrw >= 0 ? '#4ADE80' : '#F87171')),
      borderRadius: 4,
    }], won);
    bars(root.querySelector('#pf-rate'), labels, [{
      label: '수익률(%)',
      data: holdings.map((h) => +(h.plRate * 100).toFixed(2)),
      backgroundColor: holdings.map((h) => (h.plRate >= 0 ? '#4ADE80' : '#F87171')),
      borderRadius: 4,
    }], (v) => `${v}%`);
    bars(root.querySelector('#pf-inv-val'), labels, [
      { label: '투자 원금', data: holdings.map((h) => Math.round(h.investedKrw)), backgroundColor: '#94A3B8', borderRadius: 4 },
      { label: '현재 평가금액', data: holdings.map((h) => Math.round(h.valuationKrw)), backgroundColor: '#4ADE80', borderRadius: 4 },
    ], won);

    // 배당 차트 (배당 있는 종목만)
    const divHoldings = holdings.filter((h) => h.annualDivKrw > 0);
    donut(root.querySelector('#pf-div-share'),
      divHoldings.map((h) => h.name), divHoldings.map((h) => h.annualDivKrw), won);
    const divWrap = root.querySelector('#pf-div-yield');
    if (divHoldings.length === 0) {
      divWrap.innerHTML = '<div class="mb-empty" style="border:none">배당 데이터가 없어요</div>';
    } else {
      bars(divWrap, divHoldings.map((h) => h.name), [{
        label: '배당수익률(%)',
        data: divHoldings.map((h) => +(h.valuationKrw > 0 ? h.annualDivKrw * 100 / h.valuationKrw : 0).toFixed(2)),
        backgroundColor: '#4E9CF5',
        borderRadius: 4,
      }], (v) => `${v}%`);
    }

    // 하단 안내
    root.querySelector('#pf-foot').innerHTML = `
      <b>💱 USD/KRW ${usdKrw ? `₩${Math.round(usdKrw).toLocaleString('ko-KR')}` : '조회 실패'}</b> ·
      국내 종목은 원화, 해외 종목은 달러 기준으로 계산하고 현재 환율로 환산합니다.
      시세는 야후 파이낸스 기준(10분 캐시)이며, 실제 배당은 가계부 앱의 수입 기록 중
      카테고리나 메모에 '배당'이 포함된 항목을 합산합니다.
      ${noQuote.length > 0 ? `<br>※ 시세 조회 실패(평단으로 표시): ${noQuote.map((h) => h.name).join(', ')}` : ''}`;
  }

  // ── 절세계좌 섹션 ─────────────────────────────────────────
  const typeShort = (t) => (t === 'DC' ? '퇴직연금 DC' : t);
  const typeLabel = (r) => (r.account_type === 'ISA'
    ? `ISA(${r.isa_type ?? '일반'}형)` : typeShort(r.account_type));

  // 연금계좌 세액공제: 공제대상 = min(연금저축, 600만) + IRP/DC 본인 추가납입, 합산 900만 한도
  // (DC형 회사부담금은 공제 대상 아님 — year_paid에는 본인 추가납입만 입력)
  function pensionCalc(rows) {
    const P = TAX_POLICY;
    const paid = (pred) => rows.filter(pred)
      .reduce((s, r) => s + Number(r.year_paid), 0);
    const pensionPaid = paid((r) => r.account_type === '연금저축');
    const irpPaid = paid((r) => r.account_type === 'IRP' || r.account_type === 'DC');
    const eligible = Math.min(Math.min(pensionPaid, P.pensionCap) + irpPaid, P.totalCap);
    const high = rows.some((r) => r.salary_high);
    const rate = high ? P.rateHigh : P.rateLow;
    return { pensionPaid, irpPaid, eligible, rate, high,
      refund: eligible * rate, remain: Math.max(0, P.totalCap - eligible) };
  }

  // ISA: 수익 중 비과세 한도(일반 200만/서민 400만) 초과분만 9.9% 분리과세
  function isaCalc(rows) {
    const P = TAX_POLICY;
    const principal = rows.reduce((s, r) => s + Number(r.principal), 0);
    const value = rows.reduce((s, r) => s + Number(r.value), 0);
    const profit = value - principal;
    const seomin = rows.some((r) => r.isa_type === '서민');
    const freeLimit = seomin ? P.isaFreeSeomin : P.isaFreeGeneral;
    const taxable = Math.max(0, profit - freeLimit);
    const isaTax = taxable * P.isaRate;
    const normalTax = Math.max(0, profit) * P.normalRate;
    return { profit, seomin, freeLimit, taxable, isaTax,
      saved: Math.max(0, normalTax - isaTax) };
  }

  function renderTax(root, tax) {
    const area = root.querySelector('#pf-tax-area');
    if (!tax.ready) {
      area.innerHTML = `<div class="mb-empty">절세계좌 저장용 테이블(pf_tax_accounts)이 아직 없어요.<br>
        Supabase SQL Editor에서 <b>supabase/pf_tax_accounts.sql</b>을 한 번 실행하면 사용할 수 있어요.</div>`;
      return;
    }
    if (tax.rows.length === 0) {
      area.innerHTML = `<div class="mb-empty">등록된 절세계좌가 없어요.
        위의 [＋ 절세계좌 내역 추가하기]로 연금저축·IRP·ISA를 등록해 보세요.</div>`;
      return;
    }

    // 계좌 목록 테이블
    const tbody = tax.rows.map((r) => {
      const value = Number(r.computedValue ?? r.value);
      const pl = value - Number(r.principal);
      const rate = Number(r.principal) > 0 ? pl / Number(r.principal) : 0;
      const hs = r.holdings ?? [];
      const stockNote = hs.length > 0
        ? hs.map((h) => `${h.name} ${qtyFmt(Number(h.quantity))}주${h.hasQuote ? '' : '※'}`).join(', ')
        : '—';
      return `
        <tr>
          <td class="pf-name">${typeLabel(r)}</td>
          <td>${r.member}</td>
          <td>${r.broker || '—'}</td>
          <td>${won(Number(r.principal))}</td>
          <td>${won(value)}${hs.length > 0 ? ' <span title="보유종목 시세 기준 자동 계산">⟳</span>' : ''}</td>
          <td class="${plClass(pl)}">${signWon(pl)}</td>
          <td class="${plClass(pl)}">${pct(rate)}</td>
          <td>${Number(r.year_paid) > 0 ? won(Number(r.year_paid)) : '—'}</td>
          <td class="pf-stock-note" title="${stockNote}">${stockNote}</td>
          <td>
            <button class="pf-mini-btn" data-tax-stocks="${r.id}">종목</button>
            <button class="pf-mini-btn" data-tax-edit="${r.id}">수정</button>
            <button class="pf-mini-btn" data-tax-del="${r.id}">삭제</button>
          </td>
        </tr>`;
    }).join('');

    // 멤버별 절세 계산 카드
    const byMember = {};
    for (const r of tax.rows) (byMember[r.member] = byMember[r.member] ?? []).push(r);
    const calcCards = [];
    for (const [member, rows] of Object.entries(byMember)) {
      const pensionRows = rows.filter((r) => r.account_type !== 'ISA');
      const isaRows = rows.filter((r) => r.account_type === 'ISA');
      if (pensionRows.length > 0) {
        const c = pensionCalc(pensionRows);
        calcCards.push(card({
          title: `🧾 ${member} · 연금계좌 세액공제 (연금저축·IRP·DC)`,
          value: `환급 예상 ${won(c.refund)}`,
          valueClass: 'value-income',
          sub: `올해 납입: 연금저축 ${won(c.pensionPaid)} + IRP/DC ${won(c.irpPaid)}<br>`
            + `공제 대상 ${won(c.eligible)} / 한도 ${won(TAX_POLICY.totalCap)} `
            + `(공제율 ${(c.rate * 100).toFixed(1)}%${c.high ? ' · 총급여 5,500만 초과' : ''})<br>`
            + `추가 납입 가능(공제 기준): ${won(c.remain)}`,
        }));
      }
      if (isaRows.length > 0) {
        const c = isaCalc(isaRows);
        calcCards.push(card({
          title: `🛡️ ${member} · ISA 절세 효과`,
          value: `절세 예상 ${won(c.saved)}`,
          valueClass: 'value-income',
          sub: `현재 수익 ${signWon(c.profit)} · 비과세 한도 ${won(c.freeLimit)}(${c.seomin ? '서민' : '일반'}형)<br>`
            + `만기 해지 시 세금: 초과분 ${won(c.taxable)} × 9.9% = ${won(c.isaTax)}<br>`
            + `일반계좌였다면(15.4%) ${won(Math.max(0, c.profit) * TAX_POLICY.normalRate)}`,
        }));
      }
    }

    area.innerHTML = `
      <div class="mb-table-wrap">
        <table class="mb-table" style="min-width:1000px">
          <thead><tr>
            <th>유형</th><th>소유자</th><th>증권사</th><th>납입원금</th><th>평가금액</th>
            <th>수익(₩)</th><th>수익률</th><th>올해 납입</th><th>보유종목</th><th>관리</th>
          </tr></thead><tbody>${tbody}</tbody></table>
      </div>
      <div class="mb-cards" style="margin-top:14px">${calcCards.join('')}</div>`;

    area.querySelectorAll('[data-tax-stocks]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = state.taxRows.find((r) => String(r.id) === btn.dataset.taxStocks);
        if (row) openStocksModal(root, row);
      });
    });
    area.querySelectorAll('[data-tax-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = state.taxRows.find((r) => String(r.id) === btn.dataset.taxEdit);
        if (row) openTaxForm(root, row);
      });
    });
    area.querySelectorAll('[data-tax-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = state.taxRows.find((r) => String(r.id) === btn.dataset.taxDel);
        if (!row || !confirm(`${row.member}의 ${row.account_type} 계좌를 삭제할까요?`)) return;
        await MB.pf.tax.remove(row.id);
        load(root);
      });
    });
  }

  // 추가/수정 폼 (모달)
  function openTaxForm(root, row) {
    const isEdit = !!row;
    const overlay = document.createElement('div');
    overlay.className = 'mb-gate-overlay';
    overlay.innerHTML = `
      <div class="mb-gate-card pf-form">
        <h2>${isEdit ? '✏️ 절세계좌 수정' : '＋ 절세계좌 추가'}</h2>
        <p class="pf-form-hint">증권사 앱에 보이는 값을 그대로 옮기면 돼요.
          잘 모르겠으면 닫고 <b>[❓ 입력 가이드]</b>를 먼저 읽어보세요.</p>
        <label>계좌 유형</label>
        <select id="tf-type">
          ${[['연금저축', '연금저축'], ['IRP', 'IRP'], ['DC', '퇴직연금 DC형'], ['ISA', 'ISA']]
            .map(([v, t]) =>
              `<option value="${v}" ${row?.account_type === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label>소유자</label>
        <input id="tf-member" list="tf-members" placeholder="예: 강우"
          value="${row?.member ?? state.member ?? state.members[0] ?? ''}">
        <datalist id="tf-members">
          ${state.members.map((m) => `<option value="${m}">`).join('')}
        </datalist>
        <label>증권사 (선택)</label>
        <input id="tf-broker" placeholder="예: 미래에셋" value="${row?.broker ?? ''}">
        <label>총 납입원금 (원)</label>
        <input id="tf-principal" type="number" min="0" value="${row?.principal ?? ''}">
        <label>예수금/현금 (원, 선택)</label>
        <input id="tf-cash" type="number" min="0" value="${row?.cash ?? ''}">
        <label>평가금액 직접입력 (원) — 보유종목을 등록하면 시세 기준 자동 계산으로 대체</label>
        <input id="tf-value" type="number" min="0" value="${row?.value ?? ''}">
        <div id="tf-pension-only">
          <label>올해 본인 납입액 (원) — 세액공제 계산용 · DC형은 회사부담금 제외</label>
          <input id="tf-year" type="number" min="0" value="${row?.year_paid ?? ''}">
          <label class="pf-check">
            <input id="tf-high" type="checkbox" ${row?.salary_high ? 'checked' : ''}>
            총급여 5,500만 원 초과 (공제율 13.2% 적용)
          </label>
        </div>
        <div id="tf-isa-only">
          <label>ISA 유형</label>
          <select id="tf-isa">
            ${['일반', '서민'].map((t) =>
              `<option ${row?.isa_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="pf-form-actions">
          <button id="tf-cancel" class="secondary">취소</button>
          <button id="tf-save">저장</button>
        </div>
        <div class="mb-gate-error" id="tf-err">소유자를 입력해 주세요.</div>
      </div>`;
    document.body.appendChild(overlay);

    const $ = (sel) => overlay.querySelector(sel);
    const syncVisibility = () => {
      const isIsa = $('#tf-type').value === 'ISA';
      $('#tf-pension-only').style.display = isIsa ? 'none' : '';
      $('#tf-isa-only').style.display = isIsa ? '' : 'none';
    };
    syncVisibility();
    $('#tf-type').addEventListener('change', syncVisibility);
    $('#tf-cancel').addEventListener('click', () => overlay.remove());

    $('#tf-save').addEventListener('click', async () => {
      const type = $('#tf-type').value;
      const data = {
        member: $('#tf-member').value.trim(),
        account_type: type,
        broker: $('#tf-broker').value.trim(),
        principal: Number($('#tf-principal').value) || 0,
        cash: Number($('#tf-cash').value) || 0,
        value: Number($('#tf-value').value) || 0,
        year_paid: type === 'ISA' ? 0 : (Number($('#tf-year').value) || 0),
        isa_type: type === 'ISA' ? $('#tf-isa').value : null,
        salary_high: type === 'ISA' ? false : $('#tf-high').checked,
      };
      if (!data.member) {
        $('#tf-err').style.display = 'block';
        return;
      }
      try {
        if (isEdit) await MB.pf.tax.update(row.id, data);
        else await MB.pf.tax.insert(data);
        overlay.remove();
        load(root);
      } catch (e) {
        console.error(e);
        $('#tf-err').textContent = '저장하지 못했어요. 테이블 생성(SQL) 여부를 확인해 주세요.';
        $('#tf-err').style.display = 'block';
      }
    });
  }

  // 계좌 보유종목 관리 모달 — 종목 검색으로 추가, 시세 기준 평가금액 자동 계산
  function openStocksModal(root, account) {
    const localHoldings = [...(account.holdings ?? [])];
    let picked = null; // { name, symbol, currency, label } | 직접 입력

    const overlay = document.createElement('div');
    overlay.className = 'mb-gate-overlay';
    overlay.innerHTML = `
      <div class="mb-gate-card pf-form" style="width:min(480px,94vw)">
        <h2>📦 ${account.member} · ${typeLabel(account)} 보유종목</h2>
        <div id="hm-list" class="pf-holding-list"></div>
        <label>종목 검색 (국내·미국)</label>
        <div class="pf-search-wrap">
          <input id="hm-q" placeholder="예: TIGER 미국S&P500, 삼성전자, SCHD" autocomplete="off">
          <div class="pf-suggest" id="hm-sug"></div>
        </div>
        <div id="hm-picked" class="pf-picked" style="display:none"></div>
        <div class="pf-form-row">
          <div style="flex:1">
            <label>수량</label>
            <input id="hm-qty" type="number" min="0" step="any" placeholder="0">
          </div>
          <div style="flex:1">
            <label>평균단가 (<span id="hm-cur">₩</span>)</label>
            <input id="hm-price" type="number" min="0" step="any" placeholder="0">
          </div>
        </div>
        <div class="pf-form-actions">
          <button id="hm-add" class="secondary">＋ 종목 추가</button>
          <button id="hm-close">닫기</button>
        </div>
        <div class="mb-gate-error" id="hm-err">종목을 검색해 선택하고 수량·단가를 입력해 주세요.</div>
      </div>`;
    document.body.appendChild(overlay);
    const $ = (sel) => overlay.querySelector(sel);

    function renderList() {
      const list = $('#hm-list');
      if (localHoldings.length === 0) {
        list.innerHTML = '<div class="pf-holding-empty">등록된 종목이 없어요. 아래에서 검색해 추가해 보세요.</div>';
        return;
      }
      list.innerHTML = localHoldings.map((h) => `
        <div class="pf-holding-row">
          <span class="pf-badge ${h.currency === 'USD' ? 'us' : 'kr'}">${h.currency === 'USD' ? 'US' : 'KR'}</span>
          <span class="ph-name">${h.name}</span>
          <span class="ph-detail">${qtyFmt(Number(h.quantity))}주 × ${native(Number(h.avg_price), h.currency)}</span>
          <button class="pf-mini-btn" data-h-del="${h.id}">삭제</button>
        </div>`).join('');
      list.querySelectorAll('[data-h-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await MB.pf.tax.removeHolding(Number(btn.dataset.hDel));
          const i = localHoldings.findIndex((h) => String(h.id) === btn.dataset.hDel);
          if (i >= 0) localHoldings.splice(i, 1);
          renderList();
        });
      });
    }
    renderList();

    function pick(item) {
      picked = item;
      $('#hm-q').value = '';
      $('#hm-sug').style.display = 'none';
      $('#hm-cur').textContent = item.currency === 'USD' ? '$' : '₩';
      const el = $('#hm-picked');
      el.style.display = '';
      el.innerHTML = `<span class="pf-badge ${item.currency === 'USD' ? 'us' : 'kr'}">${item.market ?? (item.currency === 'USD' ? 'US' : 'KR')}</span>
        <b>${item.name}</b> <span style="color:var(--text-dim)">${item.label !== item.name ? item.label : (item.symbol ?? '직접 입력')}</span>`;
    }

    $('#hm-q').addEventListener('input', () => {
      const q = $('#hm-q').value.trim();
      const sug = $('#hm-sug');
      if (!q) { sug.style.display = 'none'; return; }
      const results = MB.pf.searchStocks(q);
      sug.innerHTML = [
        `<div class="item" data-direct="1">✏️ '${q}' 직접 입력 (미국 티커는 그대로, 그 외는 시세 없이 단가 기준)</div>`,
        ...results.map((r, i) => `
          <div class="item" data-i="${i}">
            <span class="pf-badge ${r.currency === 'USD' ? 'us' : 'kr'}">${r.market}</span>
            <span>${r.label}</span>
            <span style="color:var(--text-dim);font-size:12px">${r.symbol}</span>
          </div>`),
      ].join('');
      sug.style.display = '';
      sug.querySelectorAll('.item').forEach((el) => {
        el.addEventListener('click', () => {
          if (el.dataset.direct) {
            const isUsTicker = /^[A-Za-z.\-]{1,6}$/.test(q);
            pick({
              name: isUsTicker ? q.toUpperCase() : q,
              symbol: isUsTicker ? q.toUpperCase() : null,
              currency: isUsTicker ? 'USD' : 'KRW',
              label: q,
              market: isUsTicker ? 'US' : 'KR',
            });
          } else {
            pick(results[Number(el.dataset.i)]);
          }
        });
      });
    });

    $('#hm-add').addEventListener('click', async () => {
      const qty = Number($('#hm-qty').value);
      const price = Number($('#hm-price').value);
      if (!picked || qty <= 0 || price <= 0) {
        $('#hm-err').style.display = 'block';
        return;
      }
      $('#hm-err').style.display = 'none';
      try {
        const saved = await MB.pf.tax.insertHolding({
          account_id: account.id,
          name: picked.name,
          symbol: picked.symbol,
          currency: picked.currency,
          quantity: qty,
          avg_price: price,
        });
        localHoldings.push(saved);
        picked = null;
        $('#hm-picked').style.display = 'none';
        $('#hm-qty').value = '';
        $('#hm-price').value = '';
        renderList();
      } catch (e) {
        console.error(e);
        $('#hm-err').textContent = '저장하지 못했어요. pf_tax_holdings 테이블 생성(SQL) 여부를 확인해 주세요.';
        $('#hm-err').style.display = 'block';
      }
    });

    // 닫으면 평가금액·차트 재계산
    $('#hm-close').addEventListener('click', () => {
      overlay.remove();
      load(root);
    });
  }

  async function load(root) {
    const body = root.querySelector('#pf-body');
    body.style.opacity = '.5';
    try {
      const [data, synced] = await Promise.all([build(), MB.pf.lastSynced()]);
      root.querySelector('#pf-sync').textContent = synced
        ? `마지막 업데이트: ${synced.member_id} · ${MB.format.timeAgo(synced.synced_at)}`
        : '아직 업로드된 투자 기록이 없어요';
      renderAll(root, data);
    } finally {
      body.style.opacity = '1';
    }
  }

  function renderChips(root) {
    const wrap = root.querySelector('#pf-chips');
    wrap.innerHTML = '';
    for (const m of [null, ...state.members]) {
      const btn = document.createElement('button');
      btn.className = `mb-chip ${state.member === m ? 'active' : ''}`;
      btn.textContent = m ?? '전체';
      btn.addEventListener('click', () => {
        state.member = m;
        renderChips(root);
        load(root);
      });
      wrap.appendChild(btn);
    }
  }

  async function mount(root) {
    root.innerHTML = `
      <div class="mb-title">📈 포트폴리오</div>
      <div class="mb-sync-note" id="pf-sync">불러오는 중…</div>
      <div class="mb-chips" id="pf-chips"></div>
      <div id="pf-body">
        <div class="mb-cards" id="pf-cards"></div>
        <div class="mb-cards" id="pf-cards2" style="margin-top:14px"></div>
        <div class="mb-section-title">🍩 자산 비중</div>
        <div class="mb-charts">
          <div class="mb-chart-card"><div class="chart-title">포트폴리오 비중 (원화 평가금액 기준)</div><div class="chart-body" id="pf-weight"></div></div>
          <div class="mb-chart-card"><div class="chart-title">국내 / 해외 비중</div><div class="chart-body" id="pf-region"></div></div>
          <div class="mb-chart-card"><div class="chart-title">증권사별 비중</div><div class="chart-body" id="pf-broker"></div></div>
          <div class="mb-chart-card"><div class="chart-title">계좌 구분 (일반투자 / 절세계좌)</div><div class="chart-body" id="pf-acct"></div></div>
        </div>
        <div class="mb-section-title">📋 보유 종목 현황</div>
        <div class="mb-table-wrap" id="pf-table-wrap"></div>
        <div class="mb-section-title">🛡️ 절세계좌
          <button class="mb-chip" id="pf-tax-add" style="margin-left:12px">＋ 절세계좌 내역 추가하기</button>
          <button class="mb-chip" id="pf-tax-guide" style="margin-left:8px">❓ 입력 가이드</button>
        </div>
        <div class="pf-guide" id="pf-guide" style="display:none">
          <b>📖 사용 순서</b>
          <ol>
            <li><b>[＋ 절세계좌 내역 추가하기]</b>로 계좌를 등록해요 (금액은 증권사 앱에 보이는 값을 그대로).</li>
            <li>목록의 <b>[종목]</b> 버튼으로 계좌 안에 들어있는 종목을 검색해 등록해요.</li>
            <li>종목을 등록하면 평가금액이 실시간 시세로 <b>자동 계산</b>되고(⟳ 표시), 아래에 세액공제 카드가 생겨요.</li>
          </ol>
          <b>🏦 계좌 유형은 어떤 걸 고르나요?</b>
          <ul>
            <li><b>연금저축</b> — 증권사에서 직접 만든 연금저축펀드 계좌. 세액공제 연 600만 원 한도.</li>
            <li><b>IRP</b> — 개인형 퇴직연금. 연금저축과 합쳐 연 900만 원까지 세액공제.</li>
            <li><b>퇴직연금 DC형</b> — 회사가 넣어주는 퇴직연금. 세액공제는 <b>본인이 추가로 납입한 금액만</b> 해당돼요 (회사부담금 제외).</li>
            <li><b>ISA</b> — 중개형 ISA 등. 만기 해지 시 수익 200만 원(서민형 400만 원)까지 비과세, 초과분은 9.9%만 과세.</li>
          </ul>
          <b>✏️ 입력칸 설명</b>
          <ul>
            <li><b>총 납입원금</b> — 지금까지 이 계좌에 넣은 돈 전부. 수익률 계산의 기준이에요.</li>
            <li><b>예수금/현금</b> — 계좌 안에서 아직 투자하지 않은 현금. 종목 등록 시 평가금액에 합산돼요.</li>
            <li><b>평가금액 직접입력</b> — 증권사 앱의 현재 평가금액. <b>[종목]으로 보유종목을 등록할 거라면 비워둬도 돼요</b> (자동 계산이 우선).</li>
            <li><b>올해 본인 납입액</b> — 올해 1월부터 지금까지 넣은 금액. 연말정산 환급 예상액 계산에 쓰여요.</li>
            <li><b>총급여 5,500만 초과</b> — 체크하면 공제율 13.2%, 아니면 16.5%가 적용돼요.</li>
          </ul>
          <b>🔍 종목 등록 팁</b>
          <ul>
            <li>앱과 똑같이 종목명 일부(예: "나스닥100")나 티커(예: SCHD)로 검색하면 돼요.</li>
            <li>연금 계좌의 펀드(TDF 등)처럼 검색에 없는 상품은 <b>'직접 입력'</b>을 누르고 수량 1, 단가에 평가금액을 넣으면 돼요.</li>
            <li>수량·평균단가는 증권사 앱의 보유종목 화면에 있는 값을 그대로 옮기면 됩니다.</li>
          </ul>
        </div>
        <div id="pf-tax-area"></div>
        <div class="mb-section-title">📊 종목별 분석</div>
        <div class="mb-charts">
          <div class="mb-chart-card"><div class="chart-title">종목별 손익 (₩)</div><div class="chart-body" id="pf-pl"></div></div>
          <div class="mb-chart-card"><div class="chart-title">종목별 수익률 (%)</div><div class="chart-body" id="pf-rate"></div></div>
          <div class="mb-chart-card wide"><div class="chart-title">투자 원금 vs 현재 평가금액 (₩)</div><div class="chart-body" id="pf-inv-val"></div></div>
        </div>
        <div class="mb-section-title">💸 배당</div>
        <div class="mb-charts">
          <div class="mb-chart-card"><div class="chart-title">종목별 연간 예상배당 비중 (₩)</div><div class="chart-body" id="pf-div-share"></div></div>
          <div class="mb-chart-card"><div class="chart-title">종목별 배당수익률 (%)</div><div class="chart-body" id="pf-div-yield"></div></div>
        </div>
        <div class="pf-note" id="pf-foot"></div>
      </div>
    `;

    root.querySelector('#pf-tax-guide').addEventListener('click', () => {
      const g = root.querySelector('#pf-guide');
      g.style.display = g.style.display === 'none' ? '' : 'none';
    });
    root.querySelector('#pf-tax-add').addEventListener('click', () => {
      if (!state.taxReady) {
        alert('절세계좌 저장용 테이블이 아직 없어요.\nSupabase SQL Editor에서 supabase/pf_tax_accounts.sql을 먼저 실행해 주세요.');
        return;
      }
      openTaxForm(root, null);
    });

    if (window.Chart) {
      Chart.defaults.color = '#9AA0A9';
      Chart.defaults.animation = false;
    }

    state.members = await MB.pf.fetchMembers();
    renderChips(root);
    await load(root);
  }

  return { mount };
})();

MB.registerPage({
  id: 'portfolio',
  icon: '📈',
  label: '포트폴리오',
  mount: (root) => MB.render.portfolio.mount(root),
});
