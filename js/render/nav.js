// 사이드 내비게이션 + 페이지 레지스트리
// 새 메뉴 추가법: render 모듈에서 MB.registerPage({ id, icon, label, mount }) 한 줄이면 끝
window.MB = window.MB || {};
MB.render = MB.render || {};

MB.pages = MB.pages || [];
MB.registerPage = (page) => MB.pages.push(page);

MB.render.nav = (() => {
  let activeId = null;

  function mount(navRoot, appRoot) {
    navRoot.innerHTML = '<div class="side-logo">🏠 우리집 가계부</div>';

    for (const page of MB.pages) {
      const item = document.createElement('div');
      item.className = 'mb-nav-item';
      item.dataset.page = page.id;
      item.textContent = `${page.icon} ${page.label}`;
      item.addEventListener('click', () => activate(page.id, navRoot, appRoot));
      navRoot.appendChild(item);
    }

    if (MB.pages.length > 0) activate(MB.pages[0].id, navRoot, appRoot);
  }

  async function activate(id, navRoot, appRoot) {
    if (activeId === id) return;
    activeId = id;
    navRoot.querySelectorAll('.mb-nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.page === id);
    });
    const page = MB.pages.find((p) => p.id === id);
    appRoot.innerHTML = '<div class="mb-empty">불러오는 중…</div>';
    try {
      await page.mount(appRoot);
    } catch (e) {
      console.error(e);
      appRoot.innerHTML =
        '<div class="mb-empty">데이터를 불러오지 못했어요. 접속 정보를 확인해 주세요.<br><br>'
        + '<button class="mb-chip" onclick="MB.gate.reset()">접속 정보 다시 입력</button></div>';
    }
  }

  return { mount };
})();
