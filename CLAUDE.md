# @vendys/front-web-common — CLAUDE.md

## 프로젝트 개요
벤디스 프론트엔드 웹 프로젝트가 공통으로 사용하는 라이브러리
- TypeScript 5.x + tsup, ESM + CJS dual build, pnpm 관리
- 배포 예정: GitHub Packages (Private). 현재는 `file:../front-web-common` 로컬 링크

## 모듈 구조

| 모듈 | 경로 | 역할 |
|---|---|---|
| auth | `src/auth/` | JWT 액세스/리프레시 토큰 발급·갱신·axios 인터셉터 |

새 모듈 추가 시 README의 모듈 추가 가이드를 따른다.

## 작업 원칙 (반드시 준수)

### 검토 우선
- 모든 변경은 적용 프로젝트에 영향을 줄 수 있다. **breaking change 가능성이 보이면 작업 전 즉시 알림**
- 불확실하면 추측하지 않고 **먼저 질문**
- 작업 완료 후 반드시 `pnpm typecheck`와 `pnpm build` 통과 여부 확인

### 라이브러리 설계 원칙
- 공개 API는 `src/<module>/index.ts`에서만 export — 내부 구현 파일은 노출 금지
- **peerDependencies로 받는 외부 라이브러리는 직접 의존성으로 추가 금지** (현재: `axios`)
- 공개 API 시그니처 변경은 semver 메이저 — minor/patch에서는 추가만 허용
- 각 모듈은 서브패스 export로 분리 (`@vendys/front-web-common/<module>`) — 트리쉐이킹 보장

### 코드 변경 원칙
- 요청된 사항 **외의 변경 금지** (리팩토링, 불필요한 주석 추가, 포맷팅)
- 새 파일 생성보다 **기존 파일 수정** 우선
- 보안 취약점 발견 시 **즉시 알림** 후 수정
- **커밋·푸시·버전 발행은 절대 수행 금지** — 사용자가 직접 처리

## 기술 스택 (제약사항)

| 항목 | 버전 | 비고 |
|---|---|---|
| TypeScript | ^5.3 | strict 모드 |
| Node | 22.22.2 (Volta) | |
| pnpm | 10.33.2 | 패키지 매니저 — **npm/yarn 사용 금지** |
| tsup | ^8.0 | 빌드 (target: es5, dts: true, ESM+CJS) |
| jwt-decode | ^4.0 | 번들 포함 (`noExternal`) |
| axios (peer) | ≥0.16 <2 | **0.x와 1.x 양쪽 호환 필요** |

## axios 0.x vs 1.x 호환 (핵심 주의사항)
적용 프로젝트의 axios 버전이 0.x ~ 1.x로 갈린다. 모든 axios 관련 코드는 양쪽 모두 동작해야 함

- 헤더 객체 형식 차이: 0.x는 plain object, 1.x는 `AxiosHeaders` 인스턴스 → 헤더 set 시 `typeof headers.set === 'function'` 분기
- `InternalAxiosRequestConfig`는 axios 1.x 전용 타입 — 0.x 환경에서는 import가 깨지므로 양쪽 모두에 존재하는 타입만 사용
- 응답 인터셉터의 `error.config` 재시도 시 `_retry` 플래그로 무한루프 방지 (양 버전 공통)

## 빌드/배포

```bash
pnpm install
pnpm build       # dist/ 생성 (.mjs + .cjs + .d.ts + .d.cts)
pnpm dev         # watch 모드
pnpm typecheck   # 타입 검증
```

빌드 산출물(`dist/`)은 git 미포함, `package.json`의 `files: ["dist"]`로 배포 시 포함.

## 코딩 컨벤션
- 주석은 **한국어** — 구현 의도·주의점·왜 그렇게 짰는지 중심
- 자명한 코드(단순 대입, getter)에는 주석 생략
- 공개 export에는 JSDoc 혹은 인라인 주석으로 옵션 의미·기본값 명시
- 파일명: camelCase (`tokenStore.ts`) — kebab-case 금지
- 외부 의존성 import는 파일 최상단, 내부 import는 그 다음

## 보호된 파일 (수정 전 사용자 확인 필요)
- `package.json`의 `exports`, `peerDependencies` — 잘못 변경 시 적용 프로젝트 일괄 깨짐
- `tsup.config.ts`의 `entry` — 새 모듈 추가 시에만 수정
- `tsconfig.json`의 `target`, `lib`, `module` — 빌드 산출물 호환성에 직접 영향
- `.env`, `*.key`, `credentials*` (마켓플레이스 `security-base` plugin이 추가로 차단)

## Agent 워크플로우

복잡한 변경 시 다음 에이전트 활용:
- **`planner`** — 새 모듈 도입, 공개 API 변경, breaking change 영향 검토
- **`developer`** — 구현 방법, axios 0.x/1.x 호환, dual build 영향 검토
- **`qa`** — 빌드·타입 산출물·exports map·적용 프로젝트 통합 영향 검증

## 마켓플레이스 플러그인

이 프로젝트는 `front-web-claude-marketplace` (GitHub Private) 플러그인을 사용한다.
- `security-base@front-web-claude-marketplace` — 위험 bash 명령 차단, 시크릿 파일 보호
- `pr-workflow@front-web-claude-marketplace` — PR 생성·스테이지 점검

설치는 수동: `/plugin install security-base@front-web-claude-marketplace`, `/plugin install pr-workflow@front-web-claude-marketplace`.
