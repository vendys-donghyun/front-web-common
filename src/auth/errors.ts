// 라이브러리에서 발생하는 모든 인증 관련 에러의 베이스
// 프로젝트는 `err instanceof AuthError`로 라이브러리 에러 vs 그 외 구분 가능
export class AuthError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthError';
    this.cause = cause;
  }
}

// KMS 공개키 조회 실패 — 네트워크·404·5xx 등
export class KmsError extends AuthError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'KmsError';
  }
}

// RSA 암호화 실패 — 공개키 형식 잘못됨·입력 너무 김 등
export class RsaEncryptError extends AuthError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'RsaEncryptError';
  }
}

// /vendys/v3/token 실패 — 401(자격증명), 400(파라미터), 5xx 등
// status로 HTTP 상태코드 노출하여 프로젝트가 분기 가능
export class LoginError extends AuthError {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause);
    this.name = 'LoginError';
    this.status = status;
  }
}

// /vendys/v1/refresh-token 실패 — refresh-token 만료/위변조 등
// 명세상 401 + DB 만료 처리 → 재시도 불가, 로그아웃 흐름으로 이어짐
export class RefreshError extends AuthError {
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause);
    this.name = 'RefreshError';
    this.status = status;
  }
}
