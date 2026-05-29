# auth

JWT 액세스 토큰 발급·갱신·axios 인터셉터를 담당하는 모듈

리프레시 토큰은 백엔드가 **HttpOnly 쿠키**로 발급하고 라이브러리는 JS 스토리지에 보관하지 않음. 자동로그인 수명은 백엔드 쿠키 `Max-Age` 값으로 결정 — 라이브러리는 관여하지 않음

## 라이브러리 책임 vs 호출측 책임

| 라이브러리 | 호출측 |
|---|---|
| KMS 공개키 조회·캐시 | 로그인 폼 UI / state |
| RSA 비밀번호 암호화 | 로그인 성공 후 라우팅 |
| `POST /vendys/v3/token` 호출 | 프로젝트 부가 스토리지 정리(`logout()` 직후) |
| 액세스 토큰·account `localStorage['auth']` 보관 | React Context / Redux 상태 동기화 |
| Authorization 헤더 자동 주입 | 비즈니스 헤더(`X-Store-gsid` 등) 추가 인터셉터 |
| 만료 전 선제 갱신 + 401 시 retry | onAuthExpired 콜백 안에서 라우팅·정리 |
| 토큰 폐기 `DELETE /vendys/v1/token` | 자동로그인 UI 토글 (백엔드에 신호 보내기) |

## 빠른 시작 — `createAuth`

`v3` 인증 흐름(KMS 공개키 조회 + RSA 암호화 + 토큰 발급 + 자동 갱신 + 서버 토큰 폐기)을 라이브러리가 모두 담당

```ts
import { createAuth } from '@vendys/front-web-common/auth';

const auth = createAuth({
  authURL: getAuthURL(),                         // 인증 서버 baseURL — env별로 caller가 결정
  clientId: 'YOUR_CLIENT_ID',                    // 서비스별 OAuth 클라이언트 ID
  clientSecret: 'YOUR_CLIENT_SECRET',            // 서비스별 OAuth 시크릿
  kmsKeyId: getKmsKeyId(),                       // 환경별 KMS keyId
  userAgent: () => getXUserAgent(),              // 매 요청마다 동적 평가 — 모바일 앱 버전 변경 대응
  onAuthExpired: () => {                         // 인터셉터발 refresh 영구실패 알림
    clearProjectStorage();                       // 프로젝트 부가 키 정리
    window.location.href = '/login';             // 라우팅
  },
});

// 비즈니스 API 인스턴스마다 인증 인터셉터 설치 (여러 개 가능)
auth.installInterceptor(storeClient);
auth.installInterceptor(mobileClient);

// 로그인 — 한 줄. KMS 공개키 fetch + RSA 암호화 + POST /vendys/v3/token + access·account 저장 자동 처리
try {
  const response = await auth.login({ username, password });
  // response: { accessToken, accessTokenExpireTime?, account?, ... }
  // refreshToken은 응답 body에 와도 라이브러리가 무시 — HttpOnly 쿠키로 별도 발급됨
} catch (err) {
  // err instanceof AuthError, err.kind === 'kms' | 'rsa' | 'login' | 'refresh'
}

// 상태 게터
auth.getAccessToken();   // 현재 access token (없으면 null)
auth.isAuthenticated();  // access token 존재 여부 (만료 검증 X — 낙관적 UI 용도)
auth.getAccount();       // 마지막 로그인 account (없으면 null)
auth.setAccount(next);   // account 갱신 (예: 비밀번호 변경 후 password='NONE' 반영)

// 로그아웃 — async, 서버 토큰 폐기(best-effort) + access·account 정리
await auth.logout();
clearProjectStorage();   // 프로젝트 부가 키(myInfo, storeAdmin 등) 정리는 호출측 책임
```

## 옵션 — `CreateAuthOptions`

| 필드 | 타입 | 설명 |
|---|---|---|
| `authURL` | `string` | 인증 서버 baseURL — caller가 env(dev/stage/prod)별로 결정해 주입 |
| `clientId` | `string` | 백엔드가 발급한 OAuth 클라이언트 ID (디바이스/플랫폼별 다름) |
| `clientSecret` | `string` | OAuth 클라이언트 시크릿 — **SPA 빌드 결과에 inline되므로 실제로는 비밀이 아님**, 백엔드는 이 값만으로 elevated trust를 부여하지 않아야 함 |
| `kmsKeyId` | `string` | KMS 공개키 조회용 keyId (환경별 다를 수 있음) |
| `userAgent` | `() => string` | `X-User-Agent` 헤더 값을 반환하는 함수 — **함수**라서 매 요청마다 재평가, 모바일 앱 버전이 세션 중 바뀌어도 반영 |
| `onAuthExpired` | `() => void` | 인터셉터의 refresh 영구실패 시 호출 — 호출측이 프로젝트별 정리(스토리지 clear, redux dispatch 등)와 라우팅 수행. **`auth.login()` 실패나 `auth.logout()` 호출 시에는 발화되지 않음** (인터셉터 경로 전용) |

## 메서드 — `AuthHandle`

| 메서드 | 시그니처 | 비고 |
|---|---|---|
| `login` | `(params: { username, password }) => Promise<LoginResponse>` | KMS + RSA + 토큰 발급, `AuthError` throw 가능 |
| `logout` | `() => Promise<void>` | 서버 폐기(best-effort) + 라이브러리 storage 정리, 프로젝트 부가 정리는 호출측 책임 |
| `installInterceptor` | `(client: AxiosInstance) => { eject() }` | 비즈니스 axios에 Authorization 주입 + 401 retry 설치 (여러 client 가능) |
| `getAccessToken` | `() => string \| null` | 현재 access token |
| `isAuthenticated` | `() => boolean` | access token 존재 여부 — **만료 검증은 안 함**, UI 낙관적 분기 용도. 실제 검증은 인터셉터가 요청 시점에 수행 |
| `getAccount` | `() => Account \| null` | 마지막 로그인 account |
| `setAccount` | `(account: Account) => void` | account 갱신 (예: 비번 변경 후 force 플래그 해제) |

## 동작

### 로그인 흐름

1. `GET /open/v2/kms/public/{kmsKeyId}` — RSA 공개키 조회 (메모리 캐시·동시호출 dedup)
2. `password`를 RSA-PKCS1v15 + BASE64 암호화
3. `POST /vendys/v3/token` — body: `{clientId, clientSecret, username, password: encrypted}`
4. 응답의 `accessToken`·`account`를 `localStorage['auth']`에 저장
5. **refreshToken은 응답 body에 와도 무시** — 백엔드가 동시에 발급한 `Set-Cookie refresh_token=...; HttpOnly; Secure; SameSite=None; Max-Age=...` 쿠키만 사용

### 저장 형태

```ts
localStorage['auth'] = JSON.stringify({
  accessToken: string;
  account?: Account;
});
```

- **refresh token은 JS 스토리지에 없음** (HttpOnly 쿠키 전용 → XSS exfil 면역)
- 항상 localStorage 사용 — 자동로그인 ON/OFF는 백엔드 쿠키 `Max-Age` 값으로 결정 (라이브러리는 sessionStorage 분기 없음)

### 요청 인터셉터 (`installInterceptor`)

- 모든 요청에 `Authorization: Bearer <accessToken>` 자동 주입
- 요청 직전 토큰 만료 30초(LEEWAY) 이내면 선제 갱신
- 401 응답 시 새 토큰으로 갱신 → 원요청 1회 재시도 (`_retry` 플래그로 무한루프 차단)
- 동시 401 요청들 → 갱신 API는 1회만 호출 (singleton dedup)
- refresh 영구실패 → `onAuthExpired` 콜백 발화

### 토큰 갱신 (`POST /vendys/v1/refresh-token`)

```ts
// 요청 body — refresh token이 없음
{ clientId, clientSecret }

// 응답 — access token만 회전, account는 보존
{ accessToken }
```

- 브라우저가 `withCredentials: true` 덕에 HttpOnly 쿠키를 자동 첨부
- 백엔드가 쿠키에서 refresh token 읽어서 새 access token 발급
- 라이브러리는 새 access token만 storage에 회전 (account는 보존 — refresh 응답엔 없음)

### 로그아웃 흐름

1. 저장된 access token이 있으면 `DELETE /vendys/v1/token` 호출 (Authorization 헤더 첨부)
2. 백엔드가 쿠키 무효화(`Set-Cookie ...; Max-Age=0`) + 서버 토큰 폐기
3. 호출 실패해도 best-effort로 무시하고 진행
4. `localStorage['auth']` 삭제
5. **프로젝트 부가 키(myInfo, storeAdmin 등) 정리는 호출측 책임** — `await auth.logout()` 직후 caller가 직접 처리

## `Account` 타입

`auth.getAccount()` 반환 타입 (snake_case wire 포맷 유지)

```ts
import type { Account, AccountPasswordStatus } from '@vendys/front-web-common/auth';

interface Account {
  guid: string;                     // 사용자 식별값 (GA user_id, 비번변경 대상 id)
  password: AccountPasswordStatus;  // 비밀번호 보안 상태
  duplicated?: boolean;             // 중복 로그인 여부
  login_time?: number | string;     // 마지막 접속 시각
}

type AccountPasswordStatus =
  | 'NONE'       // 정상
  | 'FORCE'      // 강제 비밀번호 변경
  | 'RECOMMEND'; // 비밀번호 변경 안내
```

전형적인 강제 비번변경 게이트 패턴

```tsx
const account = auth.getAccount();
if (account?.password === 'FORCE') {
  return <ForcedPasswordChange />;
}

// 비밀번호 변경 성공 후 게이트 해제
auth.setAccount({ ...account, password: 'NONE' });
```

## 에러 처리 — 단일 `AuthError` + `kind` discriminator

```ts
import { AuthError, type AuthErrorKind } from '@vendys/front-web-common/auth';

try {
  await auth.login({ username, password });
} catch (err) {
  if (err instanceof AuthError) {
    switch (err.kind) {
      case 'kms':
        // KMS 서버 네트워크/장애 — 재시도 버튼 제공
        break;
      case 'rsa':
        // 공개키 형식 문제 — 페이지 새로고침으로 해소
        break;
      case 'login':
        if (err.status === 401) {
          // 자격증명 틀림 — "아이디/비밀번호를 다시 확인해주세요"
        } else if (err.status === 400) {
          // 파라미터 누락 등 — 보통 클라이언트 버그
        } else {
          // 서버 오류 — 일반 메시지
        }
        break;
      case 'refresh':
        // 보통 인터셉터가 자동 onAuthExpired로 처리, 수동 catch는 감사·로깅 용도
        break;
    }
  }
}
```

`err.cause`에는 원본 `AxiosError`가 포함될 수 있음 — **logger sink에 그대로 흘리지 말 것** (Bearer 토큰 등 민감 정보 포함 가능)

비즈니스 API 호출 중 발생하는 `kind === 'refresh'` 에러는 라이브러리 내부에서 자동으로 `onAuthExpired` 흐름을 트리거하므로 프로젝트가 직접 처리할 일은 거의 없음

## export 목록

| 이름 | 종류 | 용도 |
|---|---|---|
| `createAuth` | function | 인증 진입점 |
| `AuthHandle`, `CreateAuthOptions` | type | 핸들 + 옵션 인터페이스 |
| `LoginResponse` | type | 로그인 응답 |
| `Account`, `AccountPasswordStatus` | type | 사용자 부가정보 + 비밀번호 상태 union |
| `AuthError` | class | 단일 에러 클래스 |
| `AuthErrorKind` | type | `'kms' \| 'rsa' \| 'login' \| 'refresh'` |
