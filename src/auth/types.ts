// POST /vendys/v3/token 응답에 포함되는 사용자 계정 정보
// 백엔드 v3: snake_case 유지 (account만 wire 포맷 그대로 노출)
export type AccountPasswordStatus = 'NONE' | 'FORCE' | 'RECOMMEND';

export interface Account {
  guid: string;
  password: AccountPasswordStatus;
  duplicated?: boolean;
  login_time?: number | string;
}

export interface LoginResponse {
  accessToken: string;
  // 백엔드가 전환기 동안 body에도 refreshToken을 보낼 수 있으나 라이브러리는 무시
  refreshToken?: string;
  accessTokenExpireTime?: number;
  refreshTokenExpireTime?: number;
  account?: Account;
  // 백엔드 추가 필드 forward-compat
  [key: string]: unknown;
}

// JWT payload — 만료 검사에 exp만 사용 (jwt.ts 내부 전용)
export interface JwtPayload {
  exp?: number;
  [key: string]: unknown;
}

// 인터셉터·refresh 내부 인터페이스
export interface TokenStore {
  getAccessToken(): string | null;
  setAccessToken(token: string): void;
}

export interface RefreshSingleton {
  run(): Promise<string>;
}
