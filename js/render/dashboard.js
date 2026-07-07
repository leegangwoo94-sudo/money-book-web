// 대시보드 렌더 — 멤버 칩 + 월 이동 + 요약 카드 4개 + 차트 2개
window.MB = window.MB || {};
MB.render = MB.render || {};

MB.render.dashboard = (() => {
  const PERIOD_COUNT = 6; // 막대 차트에 보여줄 정산기간 수
  const PALETTE = ['#4E9CF5', '#4ADE80', '#FBBF24', '#F87171', '#A78BFA',
    '#2DD4BF', '#F472B6', '#8FC5FF', '#FCA5A5', '#94A3B8'];

  const state = {
    member: null, offset: 0, members: [], donut: null, bar: null,
    curRows: [], // 현재 정산기간 거래 (거래 내역 섹션용)
    txFilter: { type: 'all', category: 'all', sort: 'date' },
  };

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function card({ title, value, valueClass = '', badge = null }) {
    return `
      <div class="mb-card">
        <div class="card-title">${title}</div>
        <div class="card-value ${valueClass}">${value}</div>
        ${badge ? `<span class="card-badge ${badge.cls}">${badge.text}</span>` : ''}
      </div>`;
  }

  function expenseBadge(cur, prev) {
    if (prev === 0) return { cls: 'badge-flat', text: '전월 기록 없음' };
    const diff = cur - prev;
    if (diff > 0) return { cls: 'badge-up', text: `↑ 전월비 +${MB.format.comma(diff)}` };
    if (diff < 0) return { cls: 'badge-down', text: `↓ 전월비 ${MB.format.comma(diff)}` };
    return { cls: 'badge-flat', text: '전월과 동일' };
  }

  const inPeriod = (row, p) => row.date >= p.from && row.date <= p.to;

  function renderCards(root, sum, prevSum, period) {
    const days = Math.max(1, Math.min(
      Math.floor((Date.now() - period.start.getTime()) / 86400000) + 1,
      Math.floor((period.end - period.start) / 86400000) + 1,
    ));
    const dailyAvg = Math.round(sum.expense / days);

    root.querySelector('#mb-cards').innerHTML = [
      card({ title: '💰 총 수입', value: MB.format.won(sum.income), valueClass: 'value-income' }),
      card({
        title: '💸 총 지출', value: MB.format.won(sum.expense), valueClass: 'value-expense',
        badge: expenseBadge(sum.expense, prevSum.expense),
      }),
      card({
        title: '📊 수지 (수입-지출)', value: MB.format.won(sum.balance),
        valueClass: sum.balance > 0 ? 'value-income' : sum.balance < 0 ? 'value-expense' : '',
      }),
      card({ title: '📅 하루 평균 지출', value: MB.format.won(dailyAvg) }),
    ].join('');
  }

  function renderDonut(root, byCategory) {
    const wrap = root.querySelector('#mb-donut-wrap');
    state.donut?.destroy();
    state.donut = null;

    const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      wrap.innerHTML = '<div class="mb-empty">이 기간 지출 기록이 없어요</div>';
      return;
    }
    wrap.innerHTML = '<canvas id="mb-donut"></canvas>';
    const total = entries.reduce((acc, [, v]) => acc + v, 0);

    state.donut = new Chart(wrap.querySelector('#mb-donut'), {
      type: 'doughnut',
      data: {
        labels: entries.map(([k]) => k),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: PALETTE,
          borderColor: '#1A1D23',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const pct = (ctx.parsed * 100 / total).toFixed(1);
                return ` ${MB.format.won(ctx.parsed)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  function renderBar(root, periods, buckets) {
    const wrap = root.querySelector('#mb-bar-wrap');
    state.bar?.destroy();
    state.bar = null;
    wrap.innerHTML = '<canvas id="mb-bar"></canvas>';

    state.bar = new Chart(wrap.querySelector('#mb-bar'), {
      type: 'bar',
      data: {
        labels: periods.map((p) => MB.period.label(p)),
        datasets: [
          { label: '수입', data: buckets.map((b) => b.income), backgroundColor: '#4ADE80', borderRadius: 4 },
          { label: '지출', data: buckets.map((b) => b.expense), backgroundColor: '#F87171', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${MB.format.won(ctx.parsed.y)}` },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: '#2E333D' },
            ticks: { callback: (v) => MB.format.comma(v) },
          },
        },
      },
    });
  }

  // ── 거래 내역 ──
  function renderTxFilters(root) {
    const catSel = root.querySelector('#mb-f-cat');
    const cats = [...new Set(state.curRows.map((r) => `${r.category_emoji} ${r.category_name}`))].sort();
    const keep = state.txFilter.category;
    catSel.innerHTML = '<option value="all">전체 카테고리</option>'
      + cats.map((c) => `<option value="${c}">${c}</option>`).join('');
    catSel.value = cats.includes(keep) ? keep : 'all';
    state.txFilter.category = catSel.value;
  }

  function renderTxList(root) {
    const f = state.txFilter;
    let rows = state.curRows;
    if (f.type !== 'all') rows = rows.filter((r) => r.type === f.type);
    if (f.category !== 'all') {
      rows = rows.filter((r) => `${r.category_emoji} ${r.category_name}` === f.category);
    }
    rows = [...rows];
    if (f.sort === 'amount') rows.sort((a, b) => b.amount - a.amount);
    // 'date'는 fetch 시점에 이미 최신순

    root.querySelector('#mb-tx-count').textContent = `${rows.length}건`;

    const list = root.querySelector('#mb-tx-list');
    if (rows.length === 0) {
      list.innerHTML = '<div class="mb-empty" style="border:none">조건에 맞는 기록이 없어요</div>';
      return;
    }
    list.innerHTML = rows.map((r) => {
      const isExpense = r.type === 'expense';
      const title = r.memo ? `${r.category_name} · ${r.memo}` : r.category_name;
      return `
        <div class="mb-tx-row">
          <div class="tx-emoji">${r.category_emoji}</div>
          <div class="tx-main">
            <div class="tx-title">${title}</div>
            <div class="tx-sub">${r.date} · ${r.member_id}</div>
          </div>
          <div class="tx-amount ${r.type}">${isExpense ? '-' : '+'}${MB.format.won(r.amount)}</div>
        </div>`;
    }).join('');
  }

  async function load(root) {
    // 최근 6개 정산기간을 쿼리 한 번으로 가져와 클라이언트에서 분배
    const periods = Array.from({ length: PERIOD_COUNT },
      (_, i) => MB.period.range(state.offset - (PERIOD_COUNT - 1) + i));
    const cur = periods[PERIOD_COUNT - 1];
    const prev = periods[PERIOD_COUNT - 2];

    const [allRows, synced] = await Promise.all([
      MB.api.fetchByRange(periods[0].from, cur.to, state.member),
      MB.api.lastSynced(),
    ]);

    state.curRows = allRows.filter((r) => inPeriod(r, cur));
    const sum = MB.api.aggregate(state.curRows);
    const prevSum = MB.api.aggregate(allRows.filter((r) => inPeriod(r, prev)));
    const buckets = periods.map((p) => MB.api.aggregate(allRows.filter((r) => inPeriod(r, p))));

    root.querySelector('#mb-sync').textContent = synced
      ? `마지막 업데이트: ${synced.member_id} · ${MB.format.timeAgo(synced.synced_at)}`
      : '아직 업로드된 기록이 없어요';
    root.querySelector('#mb-month-label').textContent = MB.period.label(cur);

    renderCards(root, sum, prevSum, cur);
    renderDonut(root, sum.byCategory);
    renderBar(root, periods, buckets);
    renderTxFilters(root);
    renderTxList(root);
  }

  function renderChips(root) {
    const wrap = root.querySelector('#mb-chips');
    const all = [null, ...state.members];
    wrap.innerHTML = '';
    for (const m of all) {
      const chip = h(`<button class="mb-chip ${state.member === m ? 'active' : ''}">${m ?? '전체'}</button>`);
      chip.addEventListener('click', () => {
        state.member = m;
        renderChips(root);
        load(root);
      });
      wrap.appendChild(chip);
    }
  }

  async function mount(root) {
    root.innerHTML = `
      <div class="mb-title">💰 가계부</div>
      <div class="mb-sync-note" id="mb-sync">불러오는 중…</div>
      <div class="mb-chips" id="mb-chips"></div>
      <div class="mb-month-nav">
        <button id="mb-prev">◀ 이전</button>
        <span class="label" id="mb-month-label"></span>
        <button id="mb-next">다음 ▶</button>
      </div>
      <div class="mb-cards" id="mb-cards"></div>
      <div class="mb-section-title">📈 통계</div>
      <div class="mb-charts">
        <div class="mb-chart-card">
          <div class="chart-title">카테고리별 지출</div>
          <div class="chart-body" id="mb-donut-wrap"></div>
        </div>
        <div class="mb-chart-card">
          <div class="chart-title">정산기간별 수입 vs 지출 (최근 ${PERIOD_COUNT}개월)</div>
          <div class="chart-body" id="mb-bar-wrap"></div>
        </div>
      </div>
      <div class="mb-section-title">🧾 거래 내역<span class="mb-tx-count" id="mb-tx-count"></span></div>
      <div class="mb-filters">
        <select id="mb-f-type">
          <option value="all">전체 유형</option>
          <option value="expense">지출</option>
          <option value="income">수입</option>
        </select>
        <select id="mb-f-cat"><option value="all">전체 카테고리</option></select>
        <select id="mb-f-sort">
          <option value="date">최신순</option>
          <option value="amount">금액 큰 순</option>
        </select>
      </div>
      <div class="mb-tx-list" id="mb-tx-list"></div>
    `;
    root.querySelector('#mb-prev').addEventListener('click', () => { state.offset--; load(root); });
    root.querySelector('#mb-next').addEventListener('click', () => { state.offset++; load(root); });
    root.querySelector('#mb-f-type').addEventListener('change', (e) => {
      state.txFilter.type = e.target.value;
      renderTxList(root);
    });
    root.querySelector('#mb-f-cat').addEventListener('change', (e) => {
      state.txFilter.category = e.target.value;
      renderTxList(root);
    });
    root.querySelector('#mb-f-sort').addEventListener('change', (e) => {
      state.txFilter.sort = e.target.value;
      renderTxList(root);
    });

    if (window.Chart) {
      Chart.defaults.color = '#9AA0A9';
      Chart.defaults.animation = false; // 대시보드는 즉시 표시 (캡처/성능에도 유리)
    }

    state.members = await MB.api.fetchMembers();
    renderChips(root);
    await load(root);
  }

  return { mount };
})();

// 사이드 내비게이션에 등록 — 새 메뉴도 같은 방식으로 추가
MB.registerPage({
  id: 'ledger',
  icon: '💰',
  label: '가계부',
  mount: (root) => MB.render.dashboard.mount(root),
});
