import axios, { AxiosError, AxiosInstance } from 'axios';
import type { Account, LoginResponse } from './types';
import { createRefreshSingleton } from './refreshSingleton';
import { createAuthInterceptor } from './interceptor';
import { createKmsClient } from './kms';
import { encryptPasswordRSA } from './rsa';
import { AuthError } from './errors';
import { setHeader } from './headers';

const STORAGE_KEY = 'auth';

interface StoredAuth {
  accessToken: string;
  account?: Account;
}

export interface CreateAuthOptions {
  authURL: string;
  clientId: string;
  clientSecret: string;
  kmsKeyId: string;
  userAgent: () => string;
  // 인터셉터발 refresh 실패 알림 (정리 + 라우팅은 프로젝트 책임)
  onAuthExpired: () => void;
}

export interface AuthHandle {
  login(params: { username: string; password: string }): Promise<LoginResponse>;
  logout(): Promise<void>;
  installInterceptor(client: AxiosInstance): { eject(): void };
  getAccessToken(): string | null;
  isAuthenticated(): boolean;
  getAccount(): Account | null;
  setAccount(account: Account): void;
}

export function createAuth(opts: CreateAuthOptions): AuthHandle {
  // 토큰+account 저장은 localStorage 고정 (refresh는 쿠키, 자동로그인은 쿠키 Max-Age가 결정)
  function readStored(): StoredAuth | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredAuth) : null;
    } catch {
      return null;
    }
  }

  function writeStored(data: StoredAuth) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  const store = {
    getAccessToken: (): string | null => readStored()?.accessToken ?? null,
    setAccessToken: (token: string) => {
      writeStored({ accessToken: token, account: readStored()?.account });
    },
    getAccount: (): Account | null => readStored()?.account ?? null,
    setAccount: (account: Account) => {
      const cur = readStored();
      writeStored({ accessToken: cur?.accessToken ?? '', account });
    },
    clear: () => localStorage.removeItem(STORAGE_KEY)
  };

  const baseURL = opts.authURL;

  // 인증서버 클라이언트 — login/refresh/logout. HttpOnly 쿠키 전송 위해 withCredentials
  const authServerClient = axios.create({
    baseURL,
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' }
  });

  // userAgent는 매 요청마다 동적 (앱 버전 변경 대응)
  authServerClient.interceptors.request.use((config) => {
    config.withCredentials = true;
    setHeader(config.headers, 'X-User-Agent', opts.userAgent());
    return config;
  });

  // KMS public 엔드포인트 — 쿠키·인증 헤더 모두 불필요 (keyId만으로 공개키 조회)
  // withCredentials를 켜면 백엔드의 CORS wildcard origin과 브라우저 정책이 충돌하므로 끈다.
  const kmsClient = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' }
  });

  const kms = createKmsClient({
    axios: kmsClient,
    keyIdResolver: () => opts.kmsKeyId
  });

  // /vendys/v1/refresh-token — 쿠키 path: body에 자격증명만, refresh token은 쿠키
  const refresher = createRefreshSingleton({
    refresh: async () => {
      try {
        const { data } = await authServerClient.post<{ accessToken: string }>(
          '/vendys/v1/refresh-token',
          { clientId: opts.clientId, clientSecret: opts.clientSecret }
        );
        return { accessToken: data.accessToken };
      } catch (err) {
        const status = (err as AxiosError | undefined)?.response?.status;
        throw new AuthError('refresh', 'Token refresh failed', { status, cause: err });
      }
    },
    onSuccess: (tokens) => store.setAccessToken(tokens.accessToken)
  });

  const handleLogout = async (): Promise<void> => {
    const token = store.getAccessToken();
    if (token) {
      try {
        await authServerClient.delete('/vendys/v1/token', {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch {
        // 서버 폐기 실패해도 클라 정리는 진행
      }
    }
    store.clear();
  };

  return {
    async login(params) {
      // 1) KMS 공개키
      let publicKey: string;
      try {
        publicKey = await kms.getPublicKey();
      } catch (err) {
        throw new AuthError('kms', 'KMS public key fetch failed', { cause: err });
      }

      // 2) RSA 암호화
      let encrypted: string;
      try {
        encrypted = encryptPasswordRSA(params.password, publicKey);
      } catch (err) {
        throw new AuthError('rsa', 'Password encryption failed', { cause: err });
      }

      // 3) POST /vendys/v3/token
      let data: LoginResponse;
      try {
        const res = await authServerClient.post<LoginResponse>('/vendys/v3/token', {
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          username: params.username,
          password: encrypted
        });
        data = res.data;
      } catch (err) {
        const status = (err as AxiosError | undefined)?.response?.status;
        throw new AuthError('login', 'Login failed', { status, cause: err });
      }

      // 4) access + account 저장 (refreshToken은 body에 와도 무시 — 쿠키에 있음)
      store.setAccessToken(data.accessToken);
      if (data.account) store.setAccount(data.account);
      return data;
    },

    logout: handleLogout,

    installInterceptor(client) {
      return createAuthInterceptor({
        axios: client,
        store: { getAccessToken: store.getAccessToken, setAccessToken: store.setAccessToken },
        refresher,
        onAuthExpired: opts.onAuthExpired
      });
    },

    getAccessToken: store.getAccessToken,
    isAuthenticated: () => store.getAccessToken() != null,
    getAccount: store.getAccount,
    setAccount: store.setAccount
  };
}
