import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { isExpired } from './jwt';
import type { RefreshSingleton, TokenStore } from './types';
import { setHeader } from './headers';
import { AuthError } from './errors';

interface RetryConfig extends InternalAxiosRequestConfig {
  // eslint-disable-next-line no-underscore-dangle
  _retry?: boolean;
}

export interface CreateAuthInterceptorOptions {
  axios: AxiosInstance;
  store: TokenStore;
  refresher: RefreshSingleton;
  // 인터셉터 발 refresh 영구실패 시 알림 (caller가 정리·라우팅)
  onAuthExpired: () => void;
}

const LEEWAY_SEC = 30;

// 비즈니스 axios에 인증 인터셉터 설치.
// 요청: 만료 임박이면 선제 갱신 후 Authorization 주입.
// 응답: 401이면 1회 갱신 + 원요청 재시도.
export function createAuthInterceptor(opts: CreateAuthInterceptorOptions): { eject(): void } {
  const { axios, store, refresher, onAuthExpired } = opts;

  const reqId = axios.interceptors.request.use(async (config) => {
    let token = store.getAccessToken();

    if (token && isExpired(token, LEEWAY_SEC)) {
      try {
        token = await refresher.run();
      } catch (err) {
        onAuthExpired();
        throw new AuthError('refresh', 'Token refresh failed', { cause: err });
      }
    }

    if (token) {
      setHeader(config.headers, 'Authorization', `Bearer ${token}`);
    }
    return config;
  });

  const resId = axios.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const original = error.config as RetryConfig | undefined;

      // eslint-disable-next-line no-underscore-dangle
      if (!original || original._retry) return Promise.reject(error);
      if (error.response?.status !== 401) return Promise.reject(error);

      // eslint-disable-next-line no-underscore-dangle
      original._retry = true;

      try {
        const newToken = await refresher.run();
        setHeader(original.headers, 'Authorization', `Bearer ${newToken}`);
        return await axios(original);
      } catch (refreshErr) {
        onAuthExpired();
        return Promise.reject(refreshErr);
      }
    }
  );

  return {
    eject() {
      axios.interceptors.request.eject(reqId);
      axios.interceptors.response.eject(resId);
    }
  };
}
