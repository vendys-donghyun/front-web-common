import type { RefreshSingleton } from './types';

export interface CreateRefreshSingletonOptions {
  // 쿠키 path: refresh fn은 access token만 반환 (refreshToken은 쿠키에 있음)
  refresh: () => Promise<{ accessToken: string }>;
  onSuccess: (tokens: { accessToken: string }) => void;
}

export function createRefreshSingleton(opts: CreateRefreshSingletonOptions): RefreshSingleton {
  let inflight: Promise<string> | null = null;

  return {
    run(): Promise<string> {
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const tokens = await opts.refresh();
          opts.onSuccess(tokens);
          return tokens.accessToken;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    }
  };
}
