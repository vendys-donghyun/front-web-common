// 액세스 토큰 + 리프레시 토큰 쌍
export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
}

// JWT payload — 만료 검사에 exp만 사용, 나머지 클레임은 인덱스 시그니처로 확장
export interface JwtPayload {
  exp?: number;   // 만료 시각 (unix timestamp)
  [key: string]: unknown;
}

// localStorage 읽기/쓰기/삭제를 토큰 구조에 맞게 추상화한 인터페이스
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: TokenPair): void;
  clear(): void;
}

// 동시에 여러 요청이 토큰 갱신을 시도할 때 Promise 하나만 실행하도록 관리하는 인터페이스
export interface RefreshSingleton {
  run(): Promise<string>;  // 진행 중인 갱신이 있으면 그 Promise 재사용, 없으면 새로 실행
}

// 비밀번호 보안 상태 (백엔드 v3 명세):
//   NONE      — 정상
//   FORCE     — 강제 비밀번호 변경
//   RECOMMEND — 비밀번호 변경 안내
export type AccountPasswordStatus = 'NONE' | 'FORCE' | 'RECOMMEND';

// v3 토큰 응답에 포함되는 사용자 계정 부가정보 (3필드, snake_case)
// login_time은 JWT payload로 이전됨(이 인터페이스 밖). store-web은 guid만, corp-web은 3필드 사용 예정.
export interface Account {
  guid: string;                    // 사용자 식별값 (GA user_id, 비번변경 대상 id)
  password: AccountPasswordStatus; // 비밀번호 상태 — 'NONE' 외엔 변경 안내/강제
  duplicated: boolean;             // 중복 로그인 여부
}

// POST /vendys/v3/token 응답
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpireTime: number;   // Unix timestamp ms
  refreshTokenExpireTime: number;  // Unix timestamp ms
  account?: Account;
  [key: string]: unknown;  // 백엔드가 추가 필드 보내도 무시되지 않게
}
