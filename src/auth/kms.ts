import type { AxiosInstance } from 'axios';
import { AuthError } from './errors';

export interface CreateKmsClientOptions {
  axios: AxiosInstance;             // KMS API 호출용 axios 인스턴스 (보통 refresh와 같은 baseURL)
  keyIdResolver: () => string;      // 매 호출 시 평가 — 런타임 환경 감지 가능
}

export interface KmsClient {
  getPublicKey(): Promise<string>;
  /** 캐시 무효화 — 키 회전 감지 시 강제 재조회 */
  invalidate(): void;
}

// KMS 공개키 조회 + 메모리 캐시
// 한 번 fetch한 키는 page reload 전까지 재사용 (키 회전은 reload로 해소)
// fetch 실패 시 캐시 미스 상태로 복귀 — 다음 호출에서 재시도 가능
export function createKmsClient(opts: CreateKmsClientOptions): KmsClient {
  let cachedKey: string | null = null;
  let inflight: Promise<string> | null = null;

  return {
    async getPublicKey(): Promise<string> {
      if (cachedKey) return cachedKey;
      // 동시 호출 dedupe — 진행 중인 요청이 있으면 그 Promise 공유
      if (inflight) return inflight;

      const keyId = opts.keyIdResolver();
      inflight = opts.axios
        .get<{ publicKey: string }>(`/open/v2/kms/public/${keyId}`)
        .then((res) => {
          cachedKey = res.data.publicKey;
          return cachedKey;
        })
        .catch((err) => {
          // 실패 시 캐시 안 채우고 KmsError로 래핑해 throw — 다음 호출에서 재시도 가능
          throw new AuthError('kms', 'Failed to fetch KMS public key', { cause: err });
        })
        .finally(() => {
          inflight = null;
        });

      return inflight;
    },
    invalidate: () => { cachedKey = null; },
  };
}
