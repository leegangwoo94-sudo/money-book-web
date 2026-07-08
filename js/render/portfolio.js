// 포트폴리오 렌더 — 요약 카드 + 비중/손익/배당 차트 + 보유 종목 테이블
window.MB = window.MB || {};
MB.render = MB.render || {};

MB.render.portfolio = (() => {
  const PALETTE = ['#4E9CF5', '#4ADE80', '#FBBF24', '#F87171', '#A78BFA',
    '#2DD4BF', '#F472B6', '#8FC5FF', '#FCA5A5', '#94A3B8'];
  const US_COLOR = '#4E9CF5';
  const KR_COLOR = '#F87171';

  const state = { member: null, members: [], charts: [] };

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
    const [trades, dividendRows] = await Promise.all([
      MB.pf.fetchTrades(state.member),
      MB.pf.fetchDividendIncome(state.member).catch(() => []),
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
    const usdKrw = await fxP;

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

    return { holdings, usdKrw, actualDiv, year };
  }

  function renderAll(root, data) {
    const { holdings, usdKrw, actualDiv, year } = data;
    destroyCharts();

    const totalVal = holdings.reduce((s, h) => s + h.valuationKrw, 0);
    const totalInv = holdings.reduce((s, h) => s + h.investedKrw, 0);
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
    ].join('');

    // 비중 도넛 3종
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
    const brokerEntries = Object.entries(byBroker).sort((a, b) => b[1] - a[1]);
    donut(root.querySelector('#pf-broker'),
      brokerEntries.map(([k]) => k), brokerEntries.map(([, v]) => v), won);

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
        </div>
        <div class="mb-section-title">📋 보유 종목 현황</div>
        <div class="mb-table-wrap" id="pf-table-wrap"></div>
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
