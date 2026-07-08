# 우리집 포트폴리오 — 증권사 연동 설계 v1 (2026-07-08)

가계부 홈페이지(money_book_web)에 증권사 자산 자동 연동 기능을 추가하는 설계.
**기존 스택 유지**: 순수 HTML/CSS/JS + GitHub Pages + Supabase (Next.js/Vercel 마이그레이션 안 함 — 이유는 §2).

## 1. 현실 진단 — 증권사별 연동 수단 (2026-07 조사)

| 증권사 | 공식 개인용 API | 실제 가능한 연동 방법 |
|---|---|---|
| **토스증권** | ✅ **있음** (2026년 Open API 출시) | **완전 자동** — OAuth2 Client Credentials, REST. 계좌/보유종목/평가금액/주문내역 조회. 무료. 앱(더보기→Open API)에서 신청 |
| **삼성증권** | ❌ 없음 (기관 전용) | ① CSV/엑셀 다운로드 → 웹 업로드 파서 ② CODEF API(데모는 개인 가능, 정식은 사업자 필요) |
| **메리츠증권** | ❌ 없음 | 삼성과 동일 (CSV 업로드 우선) |

- 마이데이터: 라이선스 사업자만 가능 → 제외
- Playwright 자동 로그인: 증권사 로그인은 인증서/2FA 필수 + 약관 위반 소지 + 서버 필요 → 제외 (요청하신 우선순위 6번이지만 비권장)
- 이메일 거래내역 분석: 삼성/메리츠 거래 통보 메일 파싱 — 추후 옵션으로만 남김
- 향후 확장: 한국투자(KIS Developers)·키움·DB·LS도 공식 REST API 있음 → 토스와 같은 커넥터 패턴으로 추가 가능

## 2. 아키텍처 결정

```
[토스 Open API]──┐
                 ├─ Connector Layer ──→ Supabase (pf_* 테이블) ──→ 홈페이지 대시보드
[삼성/메리츠 CSV]─┘
```

**Connector 실행 위치 = Supabase Edge Functions (TypeScript/Deno)** — 서버 없는 기존 구조를 유지하면서:
- 시크릿(토스 Client Secret, service_role 키)을 브라우저에 노출하지 않음
- `pg_cron` + `pg_net`으로 **매일 08:00 / 18:00 자동 동기화** (Supabase 무료 티어 포함)
- 웹의 "동기화" 버튼 → `supabase.functions.invoke()` 로 즉시 실행 (로그인 시 동기화도 동일 경로)
- Next.js 서버가 필요 없는 이유: API 호출 주체가 Edge Function이므로 프론트는 정적이어도 충분

**삼성/메리츠 커넥터 = 브라우저측 파일 업로드 파서** (완전 자동은 불가능하므로 반자동):
- HTS/MTS에서 잔고/거래내역 엑셀·CSV 다운로드 → "증권사 연결" 페이지에 드래그 → 파서가 정규화 → Supabase 기록
- 커넥터 인터페이스는 동일하게 맞춰서, 나중에 CODEF나 공식 API가 생기면 파서만 교체

**요청 스택과의 괴리 처리**: React/Next.js 대신 기존 규칙(순수 JS, MB 네임스페이스) 유지. TypeScript는 Edge Functions에서 사용. Chart.js·Supabase는 그대로.

## 3. 폴더 구조

```
money_book_web/                        (기존 저장소에 추가)
├── js/
│   ├── mb-portfolio.js                MB.pf.* — 포트폴리오 데이터 접근·집계 계층
│   ├── connectors/                    브라우저 커넥터(파일 업로드 파서)
│   │   ├── base.js                    공통 정규화·업서트(BrokerFileConnector)
│   │   ├── samsung.js
│   │   └── meritz.js
│   └── render/
│       ├── portfolio.js               포트폴리오 대시보드 페이지
│       └── brokers.js                 "증권사 연결" 페이지
├── supabase/
│   ├── migrations/001_portfolio.sql   pf_* 테이블 DDL (사용자가 SQL Editor에서 실행)
│   └── functions/
│       ├── _shared/
│       │   ├── connector.ts           BrokerConnector 인터페이스 + 재시도·로그 베이스
│       │   ├── repo.ts                Repository 계층 (Supabase 읽기/쓰기)
│       │   └── brokers/toss.ts        토스 커넥터 구현
│       ├── sync-brokers/index.ts      동기화 진입점 (cron + 수동 버튼 공용)
│       └── snapshot-daily/index.ts    일별 자산 스냅샷 기록
└── PORTFOLIO_DESIGN.md
```

계층 규칙(기존과 동일 철학): `render → MB.pf(api) → db`, Edge Function 내부는 `handler → connector → repo`.

## 4. Supabase 스키마 (신규 pf_* 테이블 — 기존 transactions는 절대 불변)

가계부의 `public.transactions`가 앱과의 계약이므로, 포트폴리오는 전부 `pf_` 접두사로 분리.
`users` 테이블 대신 가계부와 같은 방식의 `member` 텍스트 컬럼(강우/민지) 사용 — 로그인 시스템이 없으므로.

```sql
-- 증권사 연결 상태 (UI의 ●연결됨/○연결하기, 최근 동기화 시간)
pf_connections(member text, broker text, method text,        -- 'api' | 'file'
    status text, last_synced_at timestamptz, PRIMARY KEY(member, broker))

-- 계좌
pf_accounts(id bigint identity PK, member, broker, account_no text,
    account_name text, currency text, UNIQUE(member, broker, account_no))

-- 보유종목 (동기화 시 계좌 단위 delete→insert, 가계부 앱과 같은 미러링 방식)
pf_holdings(id, member, broker, account_no, ticker, name, market,  -- 'KR'|'US'...
    quantity numeric, avg_price numeric, current_price numeric,
    valuation numeric, profit_loss numeric, profit_rate numeric,
    currency text, updated_at timestamptz)

-- 현금/예수금 잔고
pf_balances(member, broker, account_no, cash numeric, currency,
    updated_at, PRIMARY KEY(member, broker, account_no, currency))

-- 거래내역 (멱등 업서트: source_key = API의 주문ID 또는 CSV 행 해시)
pf_trades(id, member, broker, account_no, trade_date date, ticker, name,
    trade_type text,   -- buy/sell/deposit/withdraw/fee/etc
    quantity numeric, price numeric, amount numeric, currency,
    source_key text, UNIQUE(member, broker, source_key))

-- 배당
pf_dividends(id, member, broker, account_no, ticker, name, pay_date date,
    amount numeric, currency, source_key, UNIQUE(member, broker, source_key))

-- 일별 자산 스냅샷 (cron이 기록 → 일별 수익, 월별 추이 차트의 원천)
pf_snapshots(snap_date date, member, broker, total_asset numeric, cash numeric,
    stock_asset numeric, eval_profit numeric, daily_profit numeric,
    PRIMARY KEY(snap_date, member, broker))

-- 동기화 로그 (에러 추적)
pf_sync_logs(id, run_at timestamptz, trigger text,  -- 'cron'|'manual'|'upload'
    member, broker, status text, message text, duration_ms int)
```

RLS: 가계부와 동일하게 anon 정책(가족 코드 게이트가 접근 통제). Edge Function은 service_role 사용.

## 5. Connector 인터페이스

```ts
// supabase/functions/_shared/connector.ts
interface BrokerConnector {
  readonly broker: BrokerId;                       // 'toss' | 'samsung' | 'meritz' | ...
  authenticate(): Promise<void>;                   // OAuth 토큰 발급
  refreshToken(): Promise<void>;                   // 만료 시 재발급(토스는 재발급=재인증)
  getAccounts(): Promise<PfAccount[]>;
  getBalance(acc: PfAccount): Promise<PfBalance>;
  getHoldings(acc: PfAccount): Promise<PfHolding[]>;
  getTransactions(acc: PfAccount, from: string): Promise<PfTrade[]>;
  getDividendHistory(acc: PfAccount, from: string): Promise<PfDividend[]>; // 미지원 시 NotSupported 반환
}
```

- 베이스 클래스가 공통 제공: 지수 백오프 재시도(3회), rate limit(429) 대기, pf_sync_logs 기록
- 토스: getDividendHistory는 공식 API에 배당 전용 엔드포인트가 확인 안 됨 → 거래내역에서 배당 유형 파싱 or NotSupported로 시작
- 브라우저측 파일 커넥터(base.js)는 같은 정규화 타입을 출력: `parse(file) → {holdings, trades, dividends, balance}`
- 멤버별 자격증명: 토스 Open API는 계좌 주인 각자 신청 → `TOSS_CLIENT_ID_<MEMBER>` / `TOSS_CLIENT_SECRET_<MEMBER>` 를 Edge Function secrets로 저장

## 6. 동기화 흐름

**자동 (cron)**: `pg_cron`이 08:00/18:00 KST에 `pg_net`으로 sync-brokers 함수 호출 → 토스 커넥터 실행 → pf_* 업데이트 → snapshot-daily가 스냅샷 기록 (18시 스냅샷이 그날의 확정값, daily_profit = 전일 스냅샷 대비)

**수동**: 증권사 연결 페이지의 [동기화] 버튼 → `functions.invoke('sync-brokers')` → 완료 후 대시보드 재렌더

**페이지 진입 시**: last_synced_at이 6시간 이상 오래됐으면 자동으로 위 수동 흐름 실행 (요청하신 "로그인 시 동기화"에 해당 — 게이트 통과 = 로그인)

**파일 업로드(삼성/메리츠)**: 파일 드롭 → 브라우저 파서 → 미리보기 표 확인 → [반영] → anon 키로 업서트 → pf_connections.last_synced_at 갱신

## 7. 대시보드 집계 (클라이언트 계산 — MB.pf.aggregate)

- 필터: **강우 / 민지 / 전체** (가계부와 동일한 멤버 개념, pf_* 전 테이블의 member 컬럼으로 필터)
- **동일 종목 통합**: ticker 기준 그룹핑 → 수량 합산, 평균단가 = Σ(수량×단가)/Σ수량, 평가금액 합산, 수익률 재계산. 증권사별 내역은 펼침으로 표시
- 카드: 총자산(주식+현금) / 총평가금액 / 총평가손익 / 총수익률 / 오늘수익(스냅샷 대비)
- 차트(Chart.js, 기존 스타일): 증권사별 자산 도넛, 국가별(market 기준) 도넛, 월별 투자금(pf_trades의 매수-매도 순액) 막대, 배당금 월별 막대, 자산 추이 라인(pf_snapshots)
- 환율: US 종목은 원화 환산 필요 → 토스 API 평가금액이 원화면 그대로, 아니면 스냅샷 시점 환율 저장 (구현 단계에서 확정)

## 8. 보안

- 토스 Client ID/Secret, service_role 키: **Supabase Edge Function secrets** (`supabase secrets set`) — 코드/저장소에 절대 미포함
- 브라우저에는 기존과 동일하게 암호화 블롭(가족 코드 게이트)만
- 액세스 토큰: 함수 실행 중 메모리 캐시(만료 ~1h, cron 주기보다 짧으므로 매 실행 발급으로 충분)
- 재시도·rate limit: 커넥터 베이스에 내장, 로그는 pf_sync_logs
- 에러 알림: pf_sync_logs의 최근 실패를 증권사 연결 페이지 상단 배너로 표시 (v1). 추후 이메일/텔레그램 웹훅 확장 가능
- 주의: 공개 저장소이므로 계좌번호 등이 코드·커밋에 들어가지 않도록 함 (데이터는 전부 Supabase에만)

## 9. UI — "증권사 연결" 페이지 (MB.registerPage 한 줄로 메뉴 추가)

```
● 토스증권      연결됨 · 마지막 동기화 07-08 08:00   [동기화] [연결 해제]
○ 삼성증권      연결하기 → 파일 업로드 안내 + 드롭존
○ 메리츠증권    연결하기 → 파일 업로드 안내 + 드롭존
```
- 연결 해제 = pf_connections 상태 변경 + 해당 broker 데이터 삭제 여부 확인
- 포트폴리오 페이지도 별도 메뉴로 등록 (가계부 페이지는 무변경)

## 10. 구현 로드맵 (기능 단위 — 한 번에 하나씩)

| 단계 | 내용 | 사용자가 할 일 |
|---|---|---|
| 1 | pf_* 테이블 DDL + 포트폴리오 페이지 뼈대(가짜 데이터 렌더 검증) | migrations SQL을 Supabase SQL Editor에서 실행 |
| 2 | 토스 커넥터 + sync-brokers Edge Function + 수동 동기화 버튼 | 토스증권 앱에서 Open API 신청, Client ID/Secret 전달(또는 직접 secrets 등록), Supabase access token으로 함수 배포 |
| 3 | pg_cron 08:00/18:00 등록 + snapshot-daily | SQL 1회 실행 |
| 4 | 증권사 연결 페이지 UI (상태/동기화/해제) | — |
| 5 | 삼성증권 파일 업로드 커넥터 | HTS/MTS에서 잔고·거래내역 엑셀 샘플 1개 다운로드해서 전달(파서 작성용) |
| 6 | 메리츠증권 파일 업로드 커넥터 | 동일 |
| 7 | 통합 집계 고도화(동일 종목 합산 펼침, 국가별, 배당, 월별 투자금, 자산 추이) | — |

## 11. 확장 (향후)

- 한국투자·키움·DB·LS: 공식 REST API → `_shared/brokers/` 에 커넥터 파일 추가 + secrets 등록만으로 확장 (인터페이스 §5 고정)
- KB·NH·신한·연금저축·ISA·IRP: 공식 API 없으면 파일 커넥터로
- Interactive Brokers(Flex Query API)·Schwab(공식 API): 동일 패턴 적용 가능
- CODEF 전환: 사업자등록 시 삼성/메리츠도 완전 자동화 가능 — 커넥터 교체만으로 대응
