# @vendys/front-web-common

벤디스 프론트엔드 웹 프로젝트의 공통 모듈

## 설치

GitHub Packages 배포 전까지는 로컬 `file:` 프로토콜로 연결

```jsonc
// 적용 프로젝트의 package.json
{
  "dependencies": {
    "@vendys/front-web-common": "file:../front-web-common"
  }
}
```

`peerDependencies`로 `axios >=0.16 <2`를 요구하므로, 적용 프로젝트는 axios를 직접 의존성으로 갖고 있어야 합니다.

## 개발

```bash
pnpm install
pnpm build         # dist/ 생성
pnpm dev           # watch 모드
pnpm typecheck
pnpm test          # vitest run (jsdom env, src/**/*.test.ts)
pnpm test:watch    # vitest 인터랙티브
pnpm test:coverage # 커버리지 리포트(v8)
```

## 모듈

서브패스 export로 모듈을 분리하여, 사용하지 않는 코드는 번들에 포함되지 않음

| 모듈 | import 경로 | 설명 | 상세 |
|---|---|---|---|
| auth | `@vendys/front-web-common/auth` | JWT 액세스 토큰 발급·갱신·axios 인터셉터 | [src/auth/README.md](src/auth/README.md) |
