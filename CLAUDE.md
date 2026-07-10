# 가계부 홈페이지 (money_book_web) — 프로젝트 가이드

가족 가계부 데이터를 보여주는 웹. **GitHub Pages 배포 완료**: https://leegangwoo94-sudo.github.io/money-book-web/
(저장소 leegangwoo94-sudo/money-book-web, main 루트, public). Flutter 앱은 `D:\dev\money_book` (자체 CLAUDE.md 있음).
사용자와 **한국어**로 소통. 상세 설계는 [DESIGN.md](DESIGN.md).

## 작업 규칙 (사용자 요청사항)
- **기능 단위로 진행, 한 번에 많은 코드 금지**
- 프레임워크 금지 — 순수 HTML/CSS/JS + CDN(supabase-js v2, Chart.js 4)만
- 워크플로: 로컬에서 확인시켜 주고 → 사용자 승인 → `git push` (1~2분 뒤 반영)
- **Supabase DB 구조 변경 금지** (앱과의 계약)

## 구조
- 전역 네임스페이스 `MB` 하나만 사용. 계층: render → api → db 단방향
  - `js/mb-config.js` — 암호화 접속정보 블롭(encryptedCreds) + 상수. **블롭은 실제 값이 심어져 있음, 지우면 안 됨**
  - `js/mb-gate.js` — 가족 코드 게이트 (PBKDF2+AES-GCM 복호화 → localStorage 'mb.creds.v1'). 블롭 없으면 개발용 직접 입력 모드
  - `js/mb-core.js` — MB.db(클라이언트 싱글턴)/MB.api(fetchByRange·fetchMembers·lastSynced·aggregate)/MB.period(정산기간, 앱과 동일 로직)/MB.format
  - `js/render/nav.js` — 사이드바 + 페이지 레지스트리. **새 메뉴 추가 = 렌더 파일 만들고 `MB.registerPage({id,icon,label,mount})` 한 줄**
  - `js/render/dashboard.js` — 가계부 페이지 (요약카드 4개, 도넛/막대 차트, 거래내역 필터 리스트)
  - `js/render/portfolio.js` + `js/mb-portfolio.js`(MB.pf) + `js/stocks-kr.js` — 포트폴리오 페이지 (2026-07-08).
    invest_trades에서 보유종목을 이동평균으로 계산(앱과 동일 로직), 야후 파이낸스 시세/환율(KRW=X)을
    CORS 프록시 폴백 체인(allorigins→corsproxy→codetabs)으로 조회, localStorage 10분 캐시.
    국내 종목명→야후 심볼 맵은 stocks-kr.js(3,744종목, 앱 assets/stocks.json과 같은 원천이라 이름 1:1 매칭).
    연간 예상배당 = 야후 최근 1년 주당 배당 × 수량. '실제 배당' = transactions 수입 중 카테고리/메모에 '배당' 포함 합계.
    시세 실패 종목은 평단으로 표시(※ 마크). 모바일에서 표는 .mb-table-wrap 내부 스크롤
  - 절세계좌 (2026-07-08): 포트폴리오 페이지에서 웹으로 직접 입력하는 유일한 데이터.
    테이블 `pf_tax_accounts` + `pf_tax_holdings`(계좌별 보유종목, FK cascade) — DDL: supabase/pf_tax_accounts.sql
    (사용자가 SQL Editor 실행 필요, 미생성 시 안내문 표시. v1을 이미 실행했다면 파일 하단 ALTER 블록 사용).
    연금저축/IRP/퇴직연금 DC/ISA CRUD(MB.pf.tax) + 계좌별 보유종목을 종목 검색(MB.pf.searchStocks,
    js/stocks-all.js — stocks-kr.js 대체, MB.stockData+MB.krSymbols)으로 입력 → 평가금액 = 예수금 + Σ(수량×시세×환율)
    자동 계산(보유종목 없으면 직접입력 value 사용). 총자산 합산 + 멤버별 세액공제 계산 카드.
    세제 상수는 portfolio.js의 TAX_POLICY (2026 현행: 연금 600만/합산 900만(IRP·DC 본인납입 포함), 16.5%/13.2%,
    ISA 비과세 200만/서민 400만 + 초과 9.9% — ISA 상향 개정안은 국회 미통과라 미반영, 개정 시 상수만 수정)
- 모바일(≤768px): 사이드바가 상단 가로 메뉴로 자동 전환
- 접속정보 변경/가족 코드 변경 시: setup.html로 새 블롭 생성 → mb-config.js 교체 → push

  - 배당 수입 섹션 (2026-07-10, 포트폴리오 내): 월별 예상 배당 차트(야후 divEvents의 지급월 기준) +
    배당주기 분포(1년 배당횟수로 월/분기/연 분류, 평가금액 비중 HTML 막대) + 최근 배당 내역(보유수량×회차 배당금 추정).
    일반투자 보유종목 + 절세계좌 보유종목 합산
  - `js/render/etfcompare.js` — ETF 비교 페이지 (2026-07-10): 검색으로 최대 4개 선택(미국 포함),
    수익률 비교 차트(TR/가격 토글, 기간 1M~MAX, 지수 오버레이 ^KS200/^GSPC/^NDX, 최저/최고/MDD),
    상세 비교 표(국내 ETF는 네이버 모바일 API로 순자산/총보수/운용사/기초지수/기간수익률, 미국은 야후 시계열 계산),
    구성종목 TOP5(네이버 etfTop10MajorConstituentAssets)
  - **시세 프록시**: 야후/네이버 모두 CORS 차단 → MB.pf의 proxyChain이
    ① 사용자 Supabase Edge Function `proxy`(supabase/functions/proxy/index.ts, 대시보드에서 배포 — 화이트리스트 방식)
    ② 직접 ③ allorigins ④ codetabs 순으로 폴백, 2회전 재시도. 공개 프록시는 rate limit으로 자주 죽으므로
    Edge Function 배포가 사실상 필수. 시세 캐시는 localStorage 'mb.quote2.*' 10분

## 데이터 계약 (중요)
- Supabase `public.transactions`: member_id, local_id, amount, type('expense'|'income'), category_name, category_emoji, memo, date('yyyy-MM-dd'), synced_at. PK(member_id, local_id)
- 앱이 **멤버별 전체 미러링(delete→insert)** 으로 업로드하므로 **홈페이지는 조회 전용**.
  웹에서 입력 기능을 만들려면 member_id를 `"이름@web"` 식으로 분리해야 앱 동기화에 안 지워짐
- 멤버 목록은 하드코딩 금지 — `MB.api.fetchMembers()`로 DB에서 자동 인식

## 로컬 확인 방법
- 서버: `C:\flutter\bin\dart.bat tools/serve.dart D:\dev\money_book_web` → http://127.0.0.1:8787
  (프리뷰 도구용 `.claude/launch.json`은 `D:\가계부어플`에 있음 — 새 작업 폴더에서는 이 폴더에 새로 만들 것)
- 게이트의 가족 코드는 사용자만 앎 — 렌더링 검증은 eval로 게이트 오버레이 제거 + MB.api를 가짜 데이터로 교체해서 수행
- 프리뷰 도구 주의: preview_click 좌표 클릭이 페이지에 전달 안 될 수 있음 → `element.click()` eval로 검증.
  프리뷰 탭이 hidden이면 screenshot 타임아웃(페이지 문제 아님). Chart.js는 animation=false 설정돼 있음

## 배포
- `git push` → GitHub Pages 자동 반영 (gh CLI: `C:\Program Files\GitHub CLI\gh.exe`, 계정 leegangwoo94-sudo 로그인됨)
- **JS/CSS를 수정해서 배포할 때는 index.html의 `?v=` 버전 문자열을 반드시 올릴 것** (브라우저 캐시 무효화 — 안 올리면 방문자가 옛 JS로 동작해 "기능이 안 된다"는 문제 발생)
- git user: leegangwoo94-sudo / leegangwoo94@gmail.com (저장소 로컬 설정 완료)

## 남은 작업 후보
- 새 메뉴 페이지들 (레퍼런스의 총자산현황/배당금 기록 등 — 사용자가 나중에 추가 예정)
- 웹에서 기록 입력 (member_id "이름@web" 방식)
- 보안 강화 옵션: 읽기전용 RLS 또는 Cloudflare Access
