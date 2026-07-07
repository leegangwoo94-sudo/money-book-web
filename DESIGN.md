# 가계부 홈페이지 — 기반 구조 설계 v2 (2026-07-07, GitHub Pages 확정)

Flutter 가계부(D:\dev\money_book)의 가족 데이터를 보여주는 홈페이지.
**GitHub Pages 정적 호스팅 + 가족 코드 게이트 + Supabase 직접 연동.** 서버 없음, 프레임워크 없음(순수 HTML/CSS/JS).
UI/기능은 사용자가 레퍼런스 제공 후 기능 단위로 구현. (v1에서 아임웹 안이었으나 사용자 승인 하에 GitHub Pages로 변경)

## 1. 전체 시스템 구조
- 가족 각자의 앱(Android/Windows) → 기록/삭제 시 멤버별 미러링 업로드 → Supabase transactions (24시간 가동)
- GitHub Pages(https://계정.github.io/저장소) → 방문자 브라우저에서 supabase-js로 직접 조회
- 자체 서버 없음 → PC 꺼져도 완전 동작. 기존 DB 구조·앱 코드 무변경. 홈페이지는 v1 조회 전용.

## 2. 배포/개발 워크플로
- 저장소 하나 = 홈페이지 전체 (아임웹 복사-붙여넣기, jsDelivr 우회 모두 불필요해짐)
- 로컬 확인: 폴더에서 `python -m http.server` 등 간이 서버로 실데이터 확인
- 배포: git push → GitHub Pages 자동 반영 (1~2분)
- supabase-js v2는 CDN 로드: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2

## 3. 가족 코드 게이트 (프라이버시)
- 페이지 소스에 Supabase URL/anon 키를 평문으로 넣지 않음
- 대신 **AES-GCM으로 암호화한 접속정보 블롭**을 config에 포함, 첫 방문 시 짧은 "가족 코드" 입력
  → WebCrypto(PBKDF2→AES-GCM)로 복호화 성공 시 localStorage에 저장(재입력 불필요)
- 코드 없으면 데이터 접근 불가. 단, 클라이언트 게이트이므로 "가족 외 접근 차단" 수준이며
  코드를 아는 사람은 키를 알 수 있음 — 가족용으로 수용. 추후 Cloudflare Access/RLS로 강화 가능
- GitHub 저장소는 public(무료 Pages 조건)이어도 암호화 블롭만 노출되므로 안전

## 4. 데이터 흐름
- 쓰기(기존 완성): 앱 → 로컬 SQLite → 자동 미러링(멤버별 delete→insert) → transactions
- 읽기: 페이지 로드 → 가족 코드 확인 → MB 초기화 → 기간/멤버 필터 조회 → 브라우저 집계·포맷 → 렌더
- 마지막 동기화 시각은 기존 synced_at 컬럼 활용

## 5. JavaScript 구조 (전역 네임스페이스 MB)
- MB.gate: 가족 코드 입력/복호화/localStorage 관리
- MB.config: 암호화 블롭·상수
- MB.db: supabase 클라이언트 싱글턴 (gate 통과 후 생성)
- MB.api: 데이터 접근 계층 — fetchByPeriod/sumByMember/sumByCategory
- MB.period: 정산기간 계산 (Flutter MonthlyPeriod/periodEnd 로직 이식)
- MB.format: 금액·날짜 포맷 (앱과 표기 통일)
- MB.render.*: 페이지별 UI (레퍼런스 후 기능 단위 추가)
- 계층 규칙: render → api → db 단방향, gate는 진입점에서만

## 6. 저장소(=사이트) 폴더 구조
```
money_book_web/            ← GitHub 저장소 = GitHub Pages 사이트
├── index.html             ← 대시보드 (게이트 포함 진입점)
├── js/
│   ├── mb-gate.js
│   ├── mb-core.js         (config/db/api/period/format)
│   └── render/            (화면별 렌더 모듈, 레퍼런스 후 추가)
├── css/
│   └── mb-style.css       (앱과 같은 그린 테마)
└── DESIGN.md
```

## 7. 확장 구조
- 새 화면 = render 모듈 + html 추가 (코어 무변경)
- 홈페이지 입력 기능(추후): member_id를 "이름@web"으로 분리해 앱 미러링과 충돌 회피 (DB 구조 변경 없음)
- Realtime 구독으로 자동 갱신 확장 가능
- 보안 강화 옵션: Cloudflare Access(무료) 또는 읽기전용 RLS 정책

## 8. 동기화 방식 (변경 없음)
- 진실의 원본 = 각 멤버 기기의 로컬 SQLite (single writer per member)
- Supabase = 멤버별 미러 사본, 홈페이지 = 무상태 조회 전용 → 충돌 원천 차단, 앱과 100% 호환 자동 보장
- 홈페이지 read-only 이유: 앱 업로드가 멤버 행 전체 교체라 같은 member_id의 웹 데이터는 소멸됨
- 멤버 장기 오프라인 시 옛 데이터 표시 한계 → synced_at으로 "마지막 업데이트" 표시

## 참조 (기존 시스템)
- Supabase 테이블: public.transactions — member_id, local_id, amount, type('expense'|'income'),
  category_name, category_emoji, memo, date(yyyy-MM-dd), synced_at. PK(member_id, local_id). RLS anon 전체 허용.
- 앱 테마: 딥그린 #166534, 연그린 #E0F0E4, 배경 #F2F4F6, 지출 #E5484D, 수입 #16A34A, 카드 라운드 20px
- 정산기간: 시작일 d일 → [당월/전월 d일, 다음달 d일-1] (앱 설정과 동일 로직, 웹은 자체 설정 필요)

## 구현 시작 시 첫 단계 (레퍼런스 수령 후)
1. GitHub 저장소 생성 + Pages 활성화 (gh CLI 인증 필요할 수 있음)
2. mb-gate + mb-core 공통 모듈 (기능 단위 1)
3. 이후 레퍼런스 기반 화면들 기능 단위로
