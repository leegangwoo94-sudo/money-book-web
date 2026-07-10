// ETF 비교 — 검색으로 최대 4개 선택, 수익률 차트(TR/가격·지수 비교) + 상세 비교 표 + 구성종목 TOP5
// 데이터: 야후(시세·시계열) + 네이버 모바일 API(국내 ETF 상세 — 운용사/총보수/순자산/구성종목)
window.MB = window.MB || {};
MB.render = MB.render || {};

MB.render.etfCompare = (() => {
  const COLORS = ['#4E9CF5', '#4ADE80', '#FBBF24', '#A78BFA'];
  const RANGES = [['1mo', '1M'], ['ytd', 'YTD'], ['1y', '1Y'], ['3y', '3Y'], ['max', 'MAX']];
  const INDEXES = [['', '지수 비교 없음'], ['^KS200', 'KOSPI200'], ['^GSPC', 'S&P500'], ['^NDX', '나스닥100']];

  const state = { selected: [], range: '1y', tr: true, index: '', chart: null };

  const isKr = (sym) => /\.(KS|KQ)$/.test(sym ?? '');
  const krCode = (sym) => sym.replace(/\.(KS|KQ)$/, '');
  const pctText = (v) => (v == null ? '—'
    : `<span class="${v > 0 ? 'value-expense' : v < 0 ? 'ec-down' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${Math.abs(v).toFixed(2)}%</span>`);
  const priceText = (v, sym) => (isKr(sym)
    ? `${Math.round(v).toLocaleString('ko-KR')}원`
    : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // 분배주기 (지급 간격 기반)
  const freqOf = (events) => MB.pf.divFrequency(events) ?? '—';

  // ── 데이터 로드 ──
  async function loadItem(item) {
    const [quote, s5, naver] = await Promise.all([
      MB.pf.quote(item.symbol).catch(() => null),
      MB.pf.series(item.symbol, '5d').catch(() => null),
      isKr(item.symbol) ? MB.pf.naverEtf(krCode(item.symbol)).catch(() => null) : null,
    ]);
    item.quote = quote;
    item.naver = naver;
    // 당일 등락률: 최근 종가 vs 직전 거래일 종가
    const closes = (s5?.close ?? []).filter((v) => v != null);
    item.dayChange = closes.length >= 2
      ? (closes.at(-1) / closes.at(-2) - 1) * 100 : null;
    // 네이버가 있으면 그 값을 우선 (실시간 등락률)
    const nRatio = Number(naver?.basic?.fluctuationsRatio);
    if (!Number.isNaN(nRatio) && naver?.basic?.fluctuationsRatio != null) item.dayChange = nRatio;
    return item;
  }

  const perf = (naver, code) => naver?.analysis?.returnPerformanceList
    ?.find((r) => r.periodTypeCode === code)?.value ?? null;

  // 시계열에서 n일 전 대비 수익률 (네이버 정보가 없는 종목용)
  function seriesReturn(s, days) {
    if (!s) return null;
    const last = s.adj.findLast((v) => v != null);
    const target = Date.now() - days * 86400000;
    let idx = 0;
    for (let i = 0; i < s.dates.length; i++) {
      if (new Date(s.dates[i]).getTime() <= target) idx = i;
    }
    const base = s.adj[idx];
    if (base == null || last == null || idx >= s.adj.length - 1) return null;
    return (last / base - 1) * 100;
  }

  // ── 렌더 ──
  function renderSelected(root) {
    const wrap = root.querySelector('#ec-selected');
    if (state.selected.length === 0) {
      wrap.innerHTML = '<div class="mb-empty" style="border:none">위에서 ETF를 검색해 추가해 보세요 (최대 4개, 미국 ETF도 가능)</div>';
      return;
    }
    wrap.innerHTML = state.selected.map((s, i) => {
      const q = s.quote;
      const change = s.dayChange ?? null;
      return `
        <div class="ec-card">
          <button class="ec-x" data-ec-del="${s.symbol}">×</button>
          <div class="ec-card-head">
            <span class="ec-dot" style="background:${COLORS[i]}"></span>
            <span class="pf-badge ${isKr(s.symbol) ? 'kr' : 'us'}">${isKr(s.symbol) ? '국내' : '미국'}</span>
            <span class="ec-name" title="${s.label}">${s.label}</span>
          </div>
          <div class="ec-code">${isKr(s.symbol) ? krCode(s.symbol) : s.symbol}</div>
          <div class="ec-price">${q ? priceText(q.price, s.symbol) : '—'}</div>
          <div class="ec-change">${change != null ? pctText(change) : ''}</div>
        </div>`;
    }).join('');
    wrap.querySelectorAll('[data-ec-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selected = state.selected.filter((s) => s.symbol !== btn.dataset.ecDel);
        refresh(root);
      });
    });
  }

  async function renderChart(root) {
    const wrap = root.querySelector('#ec-chart');
    const stats = root.querySelector('#ec-stats');
    state.chart?.destroy();
    state.chart = null;
    if (state.selected.length === 0) {
      wrap.innerHTML = '<div class="mb-empty" style="border:none">비교할 ETF를 선택하면 수익률 그래프가 나와요</div>';
      stats.innerHTML = '';
      return;
    }
    wrap.innerHTML = '<div class="mb-empty" style="border:none">차트 그리는 중…</div>';

    const targets = [...state.selected];
    if (state.index) {
      targets.push({ symbol: state.index, label: INDEXES.find(([v]) => v === state.index)[1], isIndex: true });
    }
    const seriesList = await Promise.all(targets.map(async (t) => ({
      t, s: await MB.pf.series(t.symbol, state.range).catch(() => null),
    })));

    // 날짜 합집합으로 정렬된 라벨 생성 → 시계열을 %수익률로 정규화
    const dateSet = new Set();
    for (const { s } of seriesList) s?.dates.forEach((d) => dateSet.add(d));
    const labels = [...dateSet].sort();
    if (labels.length === 0) {
      wrap.innerHTML = '<div class="mb-empty" style="border:none">시계열 데이터를 불러오지 못했어요</div>';
      return;
    }

    const datasets = [];
    const statRows = [];
    seriesList.forEach(({ t, s }, i) => {
      if (!s) return;
      const values = state.tr ? s.adj : s.close;
      const first = values.find((v) => v != null);
      const map = {};
      s.dates.forEach((d, j) => {
        if (values[j] != null) map[d] = (values[j] / first - 1) * 100;
      });
      const data = labels.map((d) => map[d] ?? null);

      // 최저/최고/MDD
      const clean = data.filter((v) => v != null);
      const min = Math.min(...clean);
      const max = Math.max(...clean);
      let peak = -Infinity;
      let mdd = 0;
      for (const v of clean) {
        const lvl = 1 + v / 100;
        peak = Math.max(peak, lvl);
        mdd = Math.min(mdd, (lvl / peak - 1) * 100);
      }
      const color = t.isIndex ? '#94A3B8' : COLORS[i];
      datasets.push({
        label: t.label, data, borderColor: color, borderWidth: t.isIndex ? 1.5 : 2,
        borderDash: t.isIndex ? [6, 4] : [], pointRadius: 0, spanGaps: true, tension: 0.1,
      });
      statRows.push(`
        <div class="ec-stat">
          <div class="ec-stat-name"><span class="ec-dot" style="background:${color}"></span>${t.label}</div>
          <div class="ec-stat-vals">
            기간 ${pctText(clean[clean.length - 1])} · 최저 ${pctText(min)} · 최고 ${pctText(max)} · MDD ${pctText(mdd)}
          </div>
        </div>`);
    });

    wrap.innerHTML = '<canvas></canvas>';
    state.chart = new Chart(wrap.querySelector('canvas'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
          y: { grid: { color: '#2E333D' }, ticks: { callback: (v) => `${v}%` } },
        },
      },
    });
    stats.innerHTML = statRows.join('');
  }

  async function renderTable(root) {
    const wrap = root.querySelector('#ec-table');
    if (state.selected.length === 0) { wrap.innerHTML = ''; return; }

    // 네이버 미지원(미국 등) 종목의 기간수익률 계산용 시계열
    const seriesMap = {};
    await Promise.all(state.selected.map(async (s) => {
      if (!s.naver) seriesMap[s.symbol] = await MB.pf.series(s.symbol, '1y').catch(() => null);
    }));

    const rows = [
      ['종목코드', (s) => (isKr(s.symbol) ? krCode(s.symbol) : s.symbol)],
      ['주가', (s) => (s.quote ? `<b>${priceText(s.quote.price, s.symbol)}</b>` : '—')],
      ['당일 등락률', (s) => pctText(s.dayChange ?? null)],
      ['1주일 수익률', (s) => pctText(perf(s.naver, 'W1') ?? seriesReturn(seriesMap[s.symbol], 7))],
      ['1개월 수익률', (s) => pctText(perf(s.naver, 'M1') ?? seriesReturn(seriesMap[s.symbol], 30))],
      ['6개월 수익률', (s) => pctText(perf(s.naver, 'M6') ?? seriesReturn(seriesMap[s.symbol], 182))],
      ['1년 수익률', (s) => pctText(perf(s.naver, 'Y1') ?? seriesReturn(seriesMap[s.symbol], 365))],
      ['순자산 (AUM)', (s) => s.naver?.analysis?.totalNav ?? '—'],
      ['총보수 (TER)', (s) => (s.naver?.analysis?.totalFee != null
        ? `<span class="value-income">${s.naver.analysis.totalFee}%</span>` : '—')],
      ['분배율(연)', (s) => {
        const y = s.naver?.analysis?.dividend?.dividendYieldTtm
          ?? (s.quote?.div12m && s.quote.price ? s.quote.div12m * 100 / s.quote.price : null);
        return y != null ? `<span class="value-income">${Number(y).toFixed(2)}%</span>` : '—';
      }],
      ['분배주기', (s) => freqOf(s.quote?.divEvents)],
      ['최근 지급일', (s) => {
        const last = s.quote?.divEvents?.at(-1);
        if (!last) return '—';
        const d = new Date(last.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }],
      ['상장일', (s) => {
        const ld = s.naver?.analysis?.listedDate;
        if (ld) return `${ld.slice(0, 4)}-${ld.slice(4, 6)}-${ld.slice(6, 8)}`;
        const ft = seriesMap[s.symbol]?.meta?.firstTradeDate;
        return ft ? new Date(ft * 1000).toISOString().slice(0, 10) : '—';
      }],
      ['환헤지', (s) => (isKr(s.symbol) ? (s.label.includes('(H)') ? '환헤지(H)' : '환노출(UH)') : '—')],
      ['운용사', (s) => s.naver?.analysis?.issuerName?.replace('(ETF)', '') ?? '—'],
      ['기초지수', (s) => s.naver?.analysis?.etfBaseIndex ?? '—'],
    ];

    wrap.innerHTML = `
      <table class="mb-table" style="min-width:${360 + state.selected.length * 220}px">
        <thead><tr>
          <th style="text-align:left">항목</th>
          ${state.selected.map((s, i) =>
            `<th><span class="ec-dot" style="background:${COLORS[i]}"></span> ${s.label}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${rows.map(([label, fn]) => `
            <tr>
              <td style="text-align:left;color:var(--text-dim)">${label}</td>
              ${state.selected.map((s) => `<td>${fn(s)}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderTop5(root) {
    const wrap = root.querySelector('#ec-top5');
    const cards = state.selected
      .filter((s) => s.naver?.analysis?.etfTop10MajorConstituentAssets?.length)
      .map((s, i) => `
        <div class="mb-card">
          <div class="card-title"><span class="ec-dot" style="background:${COLORS[state.selected.indexOf(s)]}"></span> ${s.label}</div>
          <div style="margin-top:10px">
            ${s.naver.analysis.etfTop10MajorConstituentAssets.slice(0, 5).map((c, j) => `
              <div class="ec-top5-row">
                <span>${j + 1}. ${c.itemName}</span>
                <b>${c.etfWeight}</b>
              </div>`).join('')}
          </div>
        </div>`);
    root.querySelector('#ec-top5-section').style.display = cards.length ? '' : 'none';
    wrap.innerHTML = cards.join('');
  }

  async function refresh(root) {
    renderSelected(root);
    await Promise.all(state.selected.map((s) => (s.quote ? null : loadItem(s))));
    renderSelected(root);
    await Promise.all([renderChart(root), renderTable(root)]);
    renderTop5(root);
  }

  async function mount(root) {
    root.innerHTML = `
      <div class="mb-title">📊 ETF 비교</div>
      <div class="mb-sync-note">최대 4개까지 비교할 수 있어요. 국내 ETF는 순자산·총보수·구성종목까지, 미국 ETF는 시세·수익률·배당 기준으로 비교돼요.</div>
      <div class="mb-card" style="margin-top:16px">
        <div class="pf-search-wrap">
          <input id="ec-q" placeholder="ETF 종목명 또는 코드 검색 (예: KODEX 200, TIGER 미국S&P500, SCHD)" autocomplete="off">
          <div class="pf-suggest" id="ec-sug"></div>
        </div>
      </div>
      <div class="mb-section-title">선택된 ETF <span class="mb-tx-count" id="ec-count"></span></div>
      <div class="ec-cards" id="ec-selected"></div>
      <div class="mb-section-title">수익률 비교</div>
      <div class="mb-chart-card">
        <div class="mb-filters" style="margin-bottom:10px">
          ${RANGES.map(([v, l]) =>
            `<button class="mb-chip ec-range ${state.range === v ? 'active' : ''}" data-range="${v}">${l}</button>`).join('')}
          <button class="mb-chip ec-tr active" id="ec-tr">TR(배당포함)</button>
          <select id="ec-index">${INDEXES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="chart-body" style="height:340px" id="ec-chart"></div>
        <div id="ec-stats" class="ec-stats"></div>
      </div>
      <div class="mb-section-title">상세 정보 비교</div>
      <div class="mb-table-wrap" id="ec-table"></div>
      <div id="ec-top5-section" style="display:none">
        <div class="mb-section-title">구성종목 TOP 5 <span class="mb-tx-count">각 ETF가 가장 크게 보유한 종목 (국내 ETF)</span></div>
        <div class="mb-cards" id="ec-top5"></div>
      </div>
    `;

    if (window.Chart) {
      Chart.defaults.color = '#9AA0A9';
      Chart.defaults.animation = false;
    }

    // 검색
    const q = root.querySelector('#ec-q');
    const sug = root.querySelector('#ec-sug');
    q.addEventListener('input', () => {
      const text = q.value.trim();
      if (!text) { sug.style.display = 'none'; return; }
      const results = MB.pf.searchStocks(text, 15);
      sug.innerHTML = results.map((r, i) => `
        <div class="item" data-i="${i}">
          <span class="pf-badge ${r.currency === 'USD' ? 'us' : 'kr'}">${r.market}</span>
          <span>${r.label}</span>
          <span style="color:var(--text-dim);font-size:12px">${r.symbol}</span>
        </div>`).join('') || '<div class="item">검색 결과가 없어요</div>';
      sug.style.display = '';
      sug.querySelectorAll('.item[data-i]').forEach((el) => {
        el.addEventListener('click', () => {
          const r = results[Number(el.dataset.i)];
          q.value = '';
          sug.style.display = 'none';
          if (state.selected.length >= 4 || state.selected.some((s) => s.symbol === r.symbol)) return;
          state.selected.push({ symbol: r.symbol, label: r.label });
          root.querySelector('#ec-count').textContent = `(${state.selected.length}/4)`;
          refresh(root);
        });
      });
    });

    root.querySelectorAll('.ec-range').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.range = btn.dataset.range;
        root.querySelectorAll('.ec-range').forEach((b) =>
          b.classList.toggle('active', b.dataset.range === state.range));
        renderChart(root);
      });
    });
    root.querySelector('#ec-tr').addEventListener('click', (e) => {
      state.tr = !state.tr;
      e.target.classList.toggle('active', state.tr);
      e.target.textContent = state.tr ? 'TR(배당포함)' : '가격 기준';
      renderChart(root);
    });
    root.querySelector('#ec-index').addEventListener('change', (e) => {
      state.index = e.target.value;
      renderChart(root);
    });

    root.querySelector('#ec-count').textContent = `(${state.selected.length}/4)`;
    await refresh(root);
  }

  return { mount };
})();

MB.registerPage({
  id: 'etf-compare',
  icon: '📊',
  label: 'ETF 비교',
  mount: (root) => MB.render.etfCompare.mount(root),
});
