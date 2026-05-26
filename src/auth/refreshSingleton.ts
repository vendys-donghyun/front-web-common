import type { RefreshSingleton, TokenPair } from './types';

export interface CreateRefreshSingletonOptions {
  refresh: () => Promise<TokenPair>;              // 실제 토큰 갱신 API 호출 함수
  onSuccess?: (tokens: TokenPair) => void;        // 갱신 성공 시 토큰 저장 등 후처리
}

// 동시에 여러 요청이 401을 받아도 토큰 갱신 API를 한 번만 호출하도록 보장
// 이미 갱신 중이면 진행 중인 Promise를 반환해서 결과를 공유
export function createRefreshSingleton(opts: CreateRefreshSingletonOptions): RefreshSingleton {
  let refreshPromise: Promise<string> | null = null;

  return {
    run(): Promise<string> {
      // 이미 갱신 중이면 같은 Promise 반환 — API 중복 호출 방지
      if (refreshPromise) return refreshPromise;

      refreshPromise = opts
        .refresh()
        .then((tokens) => {
          opts.onSuccess?.(tokens);
          return tokens.accessToken;
        })
        .finally(() => {
          // 성공/실패 모두 다음 갱신을 위해 초기화 (실패 시 거부는 그대로 전파)
          refreshPromise = null;
        });

      return refreshPromise;
    }
  };
}
