-- 절세계좌(연금저축·IRP·퇴직연금 DC·ISA) 웹 입력 테이블 v2
-- Supabase 대시보드 → SQL Editor에서 1회 실행
-- 홈페이지에서 직접 쓰는 테이블이므로 앱 미러링과 무관 (transactions/invest_trades 계약과 충돌 없음)

create table public.pf_tax_accounts (
  id          bigint generated always as identity primary key,
  member      text not null,                 -- 소유자 (강우/민지)
  account_type text not null check (account_type in ('연금저축', 'IRP', 'DC', 'ISA')),
  broker      text not null default '',
  principal   numeric not null default 0,    -- 총 납입원금
  cash        numeric not null default 0,    -- 예수금/현금성
  value       numeric not null default 0,    -- 평가금액 직접입력 (보유종목 없을 때만 사용)
  year_paid   numeric not null default 0,    -- 올해 본인 납입액 (세액공제 계산용, DC는 회사부담 제외)
  isa_type    text check (isa_type in ('일반', '서민')),  -- ISA만
  salary_high boolean not null default false, -- 총급여 5,500만 초과 여부 (공제율 13.2%/16.5%)
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- 계좌별 보유종목 (종목 검색으로 입력 → 시세 기준 평가금액 자동 계산)
create table public.pf_tax_holdings (
  id          bigint generated always as identity primary key,
  account_id  bigint not null references public.pf_tax_accounts (id) on delete cascade,
  name        text not null,                 -- 표시명 (국내: 종목명, 미국: 티커)
  symbol      text,                          -- 야후 심볼 (직접 입력이면 null 가능)
  currency    text not null default 'KRW' check (currency in ('KRW', 'USD')),
  quantity    numeric not null,
  avg_price   numeric not null,
  created_at  timestamptz not null default now()
);

alter table public.pf_tax_accounts enable row level security;
alter table public.pf_tax_holdings enable row level security;

create policy "pf_tax_accounts anon all"
  on public.pf_tax_accounts for all to anon using (true) with check (true);

create policy "pf_tax_holdings anon all"
  on public.pf_tax_holdings for all to anon using (true) with check (true);

-- ─────────────────────────────────────────────────────────────
-- ※ 이전 버전(v1) pf_tax_accounts를 이미 만들었다면, 위 대신 아래만 실행:
--
-- alter table public.pf_tax_accounts
--   add column cash numeric not null default 0;
-- alter table public.pf_tax_accounts
--   drop constraint pf_tax_accounts_account_type_check;
-- alter table public.pf_tax_accounts
--   add constraint pf_tax_accounts_account_type_check
--   check (account_type in ('연금저축', 'IRP', 'DC', 'ISA'));
-- (그리고 위의 create table public.pf_tax_holdings 블록 + RLS 두 줄 실행)
