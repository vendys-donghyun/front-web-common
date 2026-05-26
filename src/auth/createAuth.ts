import axios from 'axios';
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse, TokenPair, Account } from './types';
import { createRefreshSingleton } from './refreshSingleton';
import { createAuthInterceptor } from './interceptor';
import { createKmsClient } from './kms';
import { encryptPasswordRSA } from './rsa';
import { AuthError, LoginError, RefreshError } from './errors';
import { setHeader } from './headers';

// auth 서버 — 적용 프로젝트의 번들러가 process.env.NODE_ENV를 치환
const BASE_URL =
  process.env.NODE_ENV === 'production'
    ? 'https://auth.mealc.co.kr'
    : 'https://dev-auth.mealc.co.kr';

// localStorage / sessionStorage에 두 토큰을 하나의 JSON으로 저장
const STORAGE_KEY = 'auth';

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  account?: Account;
}

const safeRedirect = (url: string) => {
  if (typeof window !== 'undefined') window.location.href = url;
};

export interface CreateAuthOptions {
  // 서비스별 발급된 OAuth 클라이언트 ID
  clientId: string;
  // 서비스별 발급된 OAuth 클라이언트 시크릿
  clientSecret: string;
  // 매 요청에 추가되는 X-User-Agent 헤더 값
  // 예: 'Vendys/1.0 {"client":"CorpWeb","os":"web"}'
  xUserAgent: string;
  // KMS 공개키 조회용 keyId — 환경별로 다름
  // 함수로 넘기면 호출 시점에 평가 (런타임 환경 감지 가능)
  kmsKeyId: string | (() => string);
  // 자동 로그인 여부 — true(기본): localStorage, false: sessionStorage
  // 함수로 넘기면 매 storage 접근마다 평가 — 런타임 토글(자동로그인 체크박스 변경) 대응
  autoLogin?: boolean | (() => boolean);
  // 로그아웃 시 실행할 함수 — 미지정 시 루트('/')로 이동
  onLogout?: () => void;
  // 로그인 실패 시 호출 — 각 프로젝트의 전역 알림(toast/modal)으로 라우팅하는 용도
  // 호출된 뒤에도 login()은 동일 에러를 throw하므로 react-query onError·isError 등 호출측 흐름은 유지된다
  // error.cause에 원본 AxiosError가 있어 응답 body 기반 메시지 표시 가능, error.status로 HTTP 상태 분기 가능
  onLoginError?: (error: AuthError) => void;
  // 요청마다 커스텀 헤더 추가 — Authorization/X-User-Agent 주입 후 실행
  onBeforeRequest?: (
    config: InternalAxiosRequestConfig
  ) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
}

export interface AuthHandle {
  // 로그인 — KMS+RSA+POST /vendys/v3/token + 토큰·account 저장. 전체 응답 반환.
  login(params: { username: string; password: string }): Promise<LoginResponse>;
  // 비즈니스 API axios 인스턴스에 인증 인터셉터 설치
  installAuth(client: AxiosInstance): { eject(): void };
  // 서버 토큰 폐기(best-effort) + 토큰·account 삭제 + onLogout 실행
  logout(): Promise<void>;
  // 현재 access token (없으면 null)
  getAccessToken(): string | null;
  // access token 존재 여부 (세션 보유 판단)
  isAuthenticated(): boolean;
  // 마지막 로그인의 account (없으면 null)
  getAccount(): Account | null;
  // account 갱신 (예: 비밀번호 변경 후 password 상태 'NONE' 반영). 저장소 + 게터에 즉시 반영.
  setAccount(account: Account): void;
}

// refresh 응답 — 사용하는 두 토큰만 명시 (만료 시각은 토큰에서 디코딩)
interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export function createAuth(opts: CreateAuthOptions): AuthHandle {
  // 매 호출마다 평가 — autoLogin이 함수면 그때그때, 값이면 그대로
  const resolveAutoLogin = (): boolean => {
    if (typeof opts.autoLogin === 'function') return opts.autoLogin();
    return opts.autoLogin !== false;
  };
  const getStorage = (): Storage =>
    resolveAutoLogin() ? localStorage : sessionStorage;

  function readStored(): StoredAuth | null {
    try {
      const raw = getStorage().getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredAuth) : null;
    } catch {
      return null;
    }
  }

  function writeStored(data: StoredAuth) {
    getStorage().setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // 두 토큰을 함께 회전 — refresh 응답이 항상 둘 다 새로 발급하므로
  // 부분 갱신을 방어하기 위해 기존 값을 fallback으로 보존
  const store = {
    getAccessToken: () => readStored()?.accessToken ?? null,
    getRefreshToken: () => readStored()?.refreshToken ?? null,
    setTokens: (tokens: TokenPair) => {
      writeStored({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? readStored()?.refreshToken ?? '',
        account: readStored()?.account,   // 갱신 응답엔 account 없음 → 기존 보존
      });
    },
    getAccount: (): Account | null => readStored()?.account ?? null,
    setAccount: (account: Account | undefined) => {
      const cur = readStored();
      if (cur) writeStored({ ...cur, account });
    },
    clear: () => getStorage().removeItem(STORAGE_KEY),
  };

  // auth/KMS/token API 공통 클라이언트 — 인증 인터셉터를 달지 않음 (자기 자신 재귀 호출 방지)
  const authServerClient = axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Agent': opts.xUserAgent,
    },
  });

  // KMS 공개키 fetcher — 메모리 캐시
  const kms = createKmsClient({
    axios: authServerClient,
    keyIdResolver: () =>
      typeof opts.kmsKeyId === 'function' ? opts.kmsKeyId() : opts.kmsKeyId,
  });

  // /vendys/v1/refresh-token — body에 두 토큰 + 클라이언트 자격증명 모두 전송
  // 실패 시 DB에서 해당 토큰이 만료 처리되어 재시도 불가 → onLogout으로 처리
  const refresher = createRefreshSingleton({
    refresh: async () => {
      const accessToken = store.getAccessToken();
      const refreshToken = store.getRefreshToken();
      if (!accessToken || !refreshToken) {
        throw new RefreshError('No tokens available for refresh');
      }
      try {
        const { data } = await authServerClient.post<RefreshTokenResponse>(
          '/vendys/v1/refresh-token',
          {
            clientId: opts.clientId,
            clientSecret: opts.clientSecret,
            accessToken,
            refreshToken,
          }
        );
        return { accessToken: data.accessToken, refreshToken: data.refreshToken };
      } catch (err) {
        // 라이브러리 내부 에러(예: 잘못된 호출)는 그대로 전파, axios 응답 에러만 래핑
        if (err instanceof AuthError) throw err;
        const status = (err as AxiosError | undefined)?.response?.status;
        throw new RefreshError('Token refresh failed', status, err);
      }
    },
    onSuccess: (tokens) => store.setTokens(tokens),
  });

  // 서버 토큰 폐기 → 클라이언트 정리 → onLogout 콜백 순서.
  // 폐기 실패는 무시(best-effort) — 사용자 의도는 로그아웃이므로 클라이언트 정리는 반드시 수행.
  const handleLogout = async (): Promise<void> => {
    const token = store.getAccessToken();
    if (token) {
      try {
        await authServerClient.delete('/vendys/v1/token', {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // 네트워크/4xx/5xx 등 폐기 실패 — 클라이언트 정리는 계속 진행
      }
    }
    store.clear();
    opts.onLogout ? opts.onLogout() : safeRedirect('/');
  };

  // 모든 요청에 X-User-Agent 자동 주입 후, 프로젝트별 커스텀 헤더 훅 실행
  const onBeforeRequest = async (config: InternalAxiosRequestConfig) => {
    setHeader(config.headers, 'X-User-Agent', opts.xUserAgent);
    return opts.onBeforeRequest ? opts.onBeforeRequest(config) : config;
  };

  return {
    async login(params) {
      try {
        // 1. KMS 공개키 획득 (메모리 캐시 사용) — 실패 시 KmsError throw
        const publicKey = await kms.getPublicKey();
        // 2. RSA-PKCS1v15로 password 암호화 → BASE64 문자열 — 실패 시 RsaEncryptError throw
        const encryptedPassword = encryptPasswordRSA(params.password, publicKey);
        // 3. POST /vendys/v3/token — 실패 시 LoginError로 래핑
        let data: LoginResponse;
        try {
          const res = await authServerClient.post<LoginResponse>('/vendys/v3/token', {
            clientId: opts.clientId,
            clientSecret: opts.clientSecret,
            username: params.username,
            password: encryptedPassword,
          });
          data = res.data;
        } catch (err) {
          if (err instanceof AuthError) throw err;
          const status = (err as AxiosError | undefined)?.response?.status;
          throw new LoginError('Login request failed', status, err);
        }
        // 4. 토큰 저장 자동 처리
        store.setTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
        store.setAccount(data.account);
        // 5. 전체 응답 반환 — account 등 부가 정보는 프로젝트가 직접 사용
        return data;
      } catch (err) {
        // KMS/RSA/토큰 요청 등 로그인 흐름의 모든 에러를 프로젝트 전역 알림으로 전달 후 재throw
        // (throw 유지 — react-query onError·isError 등 호출측 기존 흐름 보존)
        if (opts.onLoginError && err instanceof AuthError) opts.onLoginError(err);
        throw err;
      }
    },
    installAuth(client) {
      return createAuthInterceptor({
        axios: client,
        store,
        refresher,
        onLogout: handleLogout,
        onBeforeRequest,
      });
    },
    logout: handleLogout,
    getAccessToken: () => store.getAccessToken(),
    isAuthenticated: () => store.getAccessToken() != null,
    getAccount: () => store.getAccount(),
    setAccount: (account) => store.setAccount(account),
  };
}
