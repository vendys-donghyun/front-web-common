import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { isExpired } from './jwt';
import type { RefreshSingleton, TokenStore } from './types';
import { setHeader } from './headers';

interface RetryConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;   // 재시도 여부 플래그 — 무한 루프 방지
}

export interface CreateAuthInterceptorOptions {
  axios: AxiosInstance;
  store: TokenStore;
  refresher: RefreshSingleton;
  onLogout: () => void;                           // 갱신 실패 시 로그아웃 처리
  onBeforeRequest?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>; // 프로젝트별 커스텀 헤더 추가 (선택)
}

// 요청 직전 만료 임박 판단 여유(초) — 선제 갱신
const LEEWAY_SEC = 30;

// axios 인스턴스에 요청/응답 인터셉터를 붙여 토큰 자동 갱신 흐름을 구성
// 요청 인터셉터: 토큰 만료 임박 시 선제 갱신 후 헤더 주입
// 응답 인터셉터: 401 응답 시 토큰 갱신 후 원래 요청 재시도 (1회)
export function createAuthInterceptor(opts: CreateAuthInterceptorOptions): { eject(): void } {
  const { axios, store, refresher, onLogout, onBeforeRequest } = opts;

  const reqId = axios.interceptors.request.use(async (config) => {
    let token = store.getAccessToken();

    // 토큰이 있고 만료 임박이면 요청 보내기 전에 먼저 갱신
    if (token && isExpired(token, LEEWAY_SEC)) {
      try {
        token = await refresher.run();
      } catch {
        onLogout();
        throw new Error('Token refresh failed');
      }
    }

    if (token) {
      setHeader(config.headers, 'Authorization', `Bearer ${token}`);
    }

    // 프로젝트별 커스텀 헤더 추가 (x-userid, x-comid 등)
    if (onBeforeRequest) config = await onBeforeRequest(config);

    return config;
  });

  const resId = axios.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const original = error.config as RetryConfig | undefined;

      // config가 없거나 이미 재시도한 요청이면 그냥 에러 반환
      if (!original || original._retry) {
        return Promise.reject(error);
      }
      // 토큰 만료(401)가 아니면 그냥 에러 반환
      if (error.response?.status !== 401) {
        return Promise.reject(error);
      }

      original._retry = true;

      try {
        // 토큰 갱신 후 Authorization 헤더 업데이트하고 원래 요청 재시도
        const newToken = await refresher.run();
        setHeader(original.headers, 'Authorization', `Bearer ${newToken}`);
        return axios(original);
      } catch (refreshErr) {
        onLogout();
        return Promise.reject(refreshErr);
      }
    }
  );

  return {
    // 인터셉터 제거 — 컴포넌트 언마운트나 테스트 정리 시 사용
    eject() {
      axios.interceptors.request.eject(reqId);
      axios.interceptors.response.eject(resId);
    }
  };
}
