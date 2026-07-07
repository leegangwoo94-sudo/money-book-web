// 가족 코드 게이트 — 접속정보(supabase URL/anon 키)를 얻을 때까지 화면을 가림
// 경로 1(배포): MB.config.encryptedCreds 블롭을 가족 코드로 복호화
// 경로 2(개발): 블롭이 없으면 URL/키 직접 입력 (이 기기 localStorage에만 저장)
window.MB = window.MB || {};

MB.gate = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bufToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

  async function deriveKey(code, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // setup.html에서 사용 — 접속정보를 가족 코드로 암호화한 블롭 생성
  async function encryptCreds(code, creds) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(code, salt);
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(creds)));
    return { salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(data) };
  }

  async function decryptCreds(code, blob) {
    const key = await deriveKey(code, b64ToBuf(blob.salt));
    const data = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(blob.iv) }, key, b64ToBuf(blob.data));
    return JSON.parse(dec.decode(data));
  }

  function savedCreds() {
    try {
      const raw = localStorage.getItem(MB.config.storageKeys.creds);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function save(creds) {
    localStorage.setItem(MB.config.storageKeys.creds, JSON.stringify(creds));
  }

  function overlay(inner) {
    const el = document.createElement('div');
    el.className = 'mb-gate-overlay';
    el.innerHTML = `<div class="mb-gate-card">${inner}</div>`;
    document.body.appendChild(el);
    return el;
  }

  // 가족 코드 입력 화면 (배포 경로)
  function askCode(blob) {
    return new Promise((resolve) => {
      const el = overlay(`
        <h2>🏠 우리집 가계부</h2>
        <p>가족 코드를 입력하면 열려요. 이 기기에는 한 번만 입력하면 됩니다.</p>
        <input id="mb-code" type="password" placeholder="가족 코드" autocomplete="off">
        <button id="mb-enter">열기</button>
        <div class="mb-gate-error" id="mb-err">코드가 맞지 않아요. 다시 확인해 주세요.</div>
      `);
      const tryEnter = async () => {
        const code = el.querySelector('#mb-code').value.trim();
        if (!code) return;
        try {
          const creds = await decryptCreds(code, blob);
          save(creds);
          el.remove();
          resolve(creds);
        } catch {
          el.querySelector('#mb-err').style.display = 'block';
        }
      };
      el.querySelector('#mb-enter').addEventListener('click', tryEnter);
      el.querySelector('#mb-code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryEnter();
      });
    });
  }

  // URL/키 직접 입력 화면 (개발용 — 블롭 미설정 시)
  function askManual() {
    return new Promise((resolve) => {
      const el = overlay(`
        <h2>🛠️ 개발용 접속 설정</h2>
        <p>배포 전 로컬 확인용입니다. Supabase 접속 정보를 입력하세요.<br>
           이 기기의 브라우저에만 저장됩니다.</p>
        <input id="mb-url" type="text" placeholder="Supabase URL (https://…)" autocomplete="off">
        <input id="mb-key" type="password" placeholder="anon 공개 키" autocomplete="off">
        <button id="mb-enter">연결</button>
        <div class="mb-gate-error" id="mb-err">URL과 키를 모두 입력해 주세요.</div>
      `);
      el.querySelector('#mb-enter').addEventListener('click', () => {
        const url = el.querySelector('#mb-url').value.trim().replace(/\/$/, '');
        const key = el.querySelector('#mb-key').value.trim();
        if (!url || !key) {
          el.querySelector('#mb-err').style.display = 'block';
          return;
        }
        const creds = { url, key };
        save(creds);
        el.remove();
        resolve(creds);
      });
    });
  }

  // 진입점 — 접속정보를 확보해서 반환
  async function init() {
    const saved = savedCreds();
    if (saved) return saved;
    if (MB.config.encryptedCreds) return askCode(MB.config.encryptedCreds);
    return askManual();
  }

  function reset() {
    localStorage.removeItem(MB.config.storageKeys.creds);
    location.reload();
  }

  return { init, reset, encryptCreds };
})();
