# 반차관리

뉴스 스튜디오의 반차, 근무표, 뉴스별 필요 인원과 대근 공백을 한 화면에서 관리하는 Next.js 애플리케이션입니다.

## 구현 범위

- 한국어 반응형 공동 운영 대시보드
- 역할별 고정 근무와 음향보조 A/U 근무, U근무 자정 초과 계산
- 뉴스별 준비·방송·정리 시간을 포함한 필요 인원 계산
- 반차 등록 즉시 0.5일 차감, 취소 시 0.5일 복구
- 서무의 스튜디오 인원 완전 제외
- 중계 일정과 반차를 반영한 대근 후보 제외
- 로그인·개인 계정 없이 모든 구성원이 공동 사용
- 직원·근무 배정·뉴스 편성·중계 일정 관리 센터
- 대근 요청·수락·거절과 개인 대근 불가 등록
- 감사 로그와 근무표 CSV 다운로드
- 기존 직원 수정·비활성화, 뉴스·중계 일정 취소
- 기본 뉴스 편성 일괄 불러오기와 변경 이력 조회
- Neon 미연결 시 읽기 전용 데모 데이터
- 핵심 시간/부족 인원 계산 단위 테스트

## 로컬 실행

Node.js 20.9 이상이 필요합니다.

```bash
npm install
copy .env.example .env.local
npm run dev
```

`http://localhost:3000`에서 확인합니다. `DATABASE_URL`이 없으면 샘플 대시보드가 열리고 등록 버튼은 비활성화됩니다.

## Neon 설정

1. Neon에서 프로젝트와 데이터베이스를 생성합니다.
2. 실제 연결 문자열을 Git에서 제외되는 `.dev.vars`에 저장합니다.

```bash
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require
npm run db:inspect
npm run db:migrate
```

3. Cloudflare Worker의 암호화된 Secret으로 등록합니다.

```bash
npx wrangler secret put DATABASE_URL
```

애플리케이션은 `DATABASE_URL`을 지연 초기화하므로 환경 변수가 없는 첫 빌드도 안전합니다.

사이트는 로그인 화면 없이 바로 열리며 모든 구성원이 동일한 조회·등록·수정 권한을 사용합니다. 직원 등록 시 개인 아이디나 PIN을 만들지 않습니다.

## 검증

```bash
npm test
npm run lint
npm run build
npm run build:cloudflare
```

## Cloudflare Workers 배포

```bash
npm run build:cloudflare
npx wrangler deploy
```

배포 설정은 `wrangler.jsonc`와 `open-next.config.ts`에 있으며, Next.js 앱은 OpenNext 어댑터를 통해 Cloudflare Workers에서 실행됩니다. 현재 배포 주소는 `https://teum-half-day.halfday-ops.workers.dev`입니다.

## 주요 폴더

- `app/`: App Router 화면, 서버 액션, 스타일
- `app/manage/`: 근무·편성·중계·직원·대근 관리 센터
- `lib/scheduling.ts`: UI와 분리된 순수 근무 계산
- `lib/repository.ts`: Neon 조회와 데모 폴백
- `db/`: PostgreSQL 스키마와 초기 데이터
