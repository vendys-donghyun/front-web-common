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

| 모듈 | import 경로 | 설명 |
|---|---|---|
| auth | `@vendys/front-web-common/auth` | JWT 토큰 저장/갱신/인터셉터 |

### auth

#### 빠른 시작 — `createAuth`

표준 인증 서버(`dev-auth.mealc.co.kr` / `auth.mealc.co.kr`) 케이스. v3 인증 흐름(KMS 공개키 조회 + RSA 암호화 + 토큰 발급 + 자동 갱신 + 서버 토큰 폐기)을 라이브러리가 모두 담당. 토큰·account는 라이브러리가 단일 저장키에 colocate 소유하고, 게터로 노출한다.

```ts
import { createAuth } from '@vendys/front-web-common/auth';

const auth = createAuth({
  clientId: 'YOUR_CLIENT_ID',                   // 서비스별 OAuth 클라이언트 ID
  clientSecret: 'YOUR_CLIENT_SECRET',           // 서비스별 OAuth 시크릿
  xUserAgent: 'Vendys/1.0 {"client":"StoreWeb","os":"web"}',
  kmsKeyId: () => getKmsKeyId(),                // 환경별 KMS keyId 반환. 단순 string도 가능
  autoLogin: () => getRememberMe(),             // boolean 또는 () => boolean. 함수면 매 접근 시 재평가
                                                // 단순 boolean도 가능: autoLogin: true
  onLogout: () => history.push('/login'),       // 미지정 시 '/'로 이동
  onLoginError: (err) => toast.error(err.message), // 로그인 실패 전역 알림 (선택)
  onBeforeRequest: (config) => {                // 요청마다 커스텀 헤더 추가 (선택)
    config.headers['x-userid'] = getUserId();
    return config;
  },
});

// 비즈니스 API 인스턴스마다 인증 인터셉터 설치 (여러 개 가능)
auth.installAuth(storeClient);
auth.installAuth(mobileClient);

// 로그인 — 한 줄. KMS 공개키 fetch + RSA 암호화 + POST /vendys/v3/token + 토큰·account 저장 자동 처리
const response = await auth.login({ username, password });
// response: { accessToken, refreshToken, accessTokenExpireTime, refreshTokenExpireTime, account?, ... }
// 토큰·account 모두 이미 저장됨. response는 직접 받아쓰거나 게터로 다시 읽어도 동일.

// 상태 게터 — 앱이 라이브러리 저장 키를 직접 뒤지지 않고 핸들로만 읽음
auth.getAccessToken();   // 현재 access token (없으면 null)
auth.isAuthenticated();  // access token 존재 여부 (세션 보유 판단)
auth.getAccount();       // 마지막 로그인 account (없으면 null) — Account 타입
auth.setAccount(next);   // account 갱신 (예: 비밀번호 변경 후 password='NONE' 반영)

// 로그아웃 — async. 서버 토큰 폐기(best-effort) + 토큰·account 정리 + onLogout 콜백
await auth.logout();
```

내장 동작:
- **로그인**: `GET /open/v2/kms/public/{keyId}`로 공개키 조회(메모리 캐시·동시호출 dedup) → `password`를 RSA-PKCS1v15 + BASE64 암호화 → `POST /vendys/v3/token` → 토큰·account 저장
- 저장: `localStorage['auth']`에 `{accessToken, refreshToken, account?}` JSON colocate (autoLogin=false면 sessionStorage)
- 매 요청에 `Authorization: Bearer <accessToken>` + `X-User-Agent` 자동 주입 (`onBeforeRequest`로 커스텀 헤더 추가 가능)
- 요청 직전 토큰 만료 30초 전이면 선제 갱신 (`POST /vendys/v1/refresh-token`)
- 401 응답 시 토큰 갱신 후 원요청 1회 재시도
- 동시 요청이 401을 받아도 갱신 API는 1회만 호출(singleton dedup)
- refresh 응답의 새 accessToken + refreshToken 둘 다 회전, account는 보존(refresh 응답엔 account 없음)
- refresh 실패 시 자동 logout (서버가 토큰을 만료 처리하므로 재시도 불가)
- **로그아웃**: 저장된 access token이 있으면 `DELETE /vendys/v1/token`(Authorization 헤더) → 실패해도 best-effort로 무시하고 클라이언트 정리 진행 → `onLogout` 콜백 호출

#### Account 타입 — 비밀번호 보안 상태

`auth.getAccount()`가 반환하는 `Account` 타입(snake_case):

```ts
import type { Account, AccountPasswordStatus } from '@vendys/front-web-common/auth';

interface Account {
  guid: string;                    // 사용자 식별값 (GA user_id, 비번변경 대상 id)
  password: AccountPasswordStatus; // 비밀번호 보안 상태
  duplicated: boolean;             // 중복 로그인 여부
}

type AccountPasswordStatus =
  | 'NONE'       // 정상
  | 'FORCE'      // 강제 비밀번호 변경
  | 'RECOMMEND'; // 비밀번호 변경 안내
```

전형적인 게이트 패턴:

```tsx
const account = auth.getAccount();
if (account?.password === 'FORCE') {
  return <ForcedPasswordChange />;
}
// 비밀번호 변경 후 게이트 해제
auth.setAccount({ ...account, password: 'NONE' });
```

#### 에러 처리

`auth.login()`이 던지는 에러는 단계별로 다른 클래스로 분기되어, 프로젝트가 사용자에게 적절한 메시지·재시도 흐름을 제공할 수 있다.

```ts
import { KmsError, RsaEncryptError, LoginError, RefreshError, AuthError } from '@vendys/front-web-common/auth';

try {
  await auth.login({ username, password });
} catch (err) {
  if (err instanceof RsaEncryptError) {
    // 공개키 형식 문제 — 보통 페이지 새로고침으로 해소 (캐시 키 초기화)
  } else if (err instanceof KmsError) {
    // KMS 서버 네트워크/장애 — 재시도 버튼 제공
  } else if (err instanceof LoginError) {
    if (err.status === 401) {
      // 자격증명 틀림 — "아이디/비밀번호를 다시 확인해주세요"
    } else if (err.status === 400) {
      // 파라미터 누락 등 — 보통 클라이언트 버그
    } else {
      // 서버 오류 — 일반 메시지
    }
  } else if (err instanceof AuthError) {
    // 그 외 라이브러리 에러
  }
}
```

비즈니스 API 호출 중 발생하는 `RefreshError`는 라이브러리 내부에서 자동으로 `onLogout` 흐름을 트리거하므로 프로젝트가 직접 처리할 일은 거의 없음 (보안 감사·로깅 용도로만 catch).

#### export 목록

| 이름 | 종류 | 용도 |
|---|---|---|
| `createAuth` | function | 인증 진입점 |
| `AuthHandle`, `CreateAuthOptions` | type | 핸들 + 옵션 인터페이스 |
| `TokenPair`, `LoginResponse` | type | 토큰 쌍 + 로그인 응답 |
| `Account`, `AccountPasswordStatus` | type | 사용자 부가정보 + 비밀번호 보안 상태 union |
| `AuthError`, `KmsError`, `RsaEncryptError`, `LoginError`, `RefreshError` | class | 단계별 에러 분기 |

`AuthHandle`이 노출하는 메서드:

| 메서드 | 시그니처 | 비고 |
|---|---|---|
| `login` | `(params) => Promise<LoginResponse>` | 토큰·account 저장 + 전체 응답 반환 |
| `logout` | `() => Promise<void>` | 서버 폐기(best-effort) + 정리 + onLogout |
| `installAuth` | `(client) => { eject() }` | axios 인스턴스에 인터셉터 설치 |
| `getAccessToken` | `() => string \| null` | 현재 access token |
| `isAuthenticated` | `() => boolean` | access token 존재 여부 (만료 검사 X) |
| `getAccount` | `() => Account \| null` | 마지막 로그인 account |
| `setAccount` | `(account) => void` | account 갱신 (저장소 + 게터 즉시 반영) |

## 새 모듈 추가 가이드

1. `src/<module>/` 디렉터리 생성, `index.ts`에서 공개 API export
2. `tsup.config.ts`의 entry에 추가
3. `package.json`의 `exports`에 서브패스 추가
4. 본 README의 모듈 표에 한 줄 추가