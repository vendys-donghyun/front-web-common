import { describe, it, expect, vi } from 'vitest';
import { createKmsClient } from './kms';
import { KmsError } from './errors';

const fakeAxios = (impl: (url: string) => Promise<{ data: { publicKey: string } }>) =>
  ({ get: vi.fn(impl) }) as any;

describe('createKmsClient', () => {
  it('첫 성공 후 키 캐시 — 다음 호출은 fetch 안 함', async () => {
    const axios = fakeAxios(async () => ({ data: { publicKey: 'KEY1' } }));
    const kms = createKmsClient({ axios, keyIdResolver: () => 'k1' });

    expect(await kms.getPublicKey()).toBe('KEY1');
    expect(await kms.getPublicKey()).toBe('KEY1');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('동시 호출은 inflight promise 공유(dedup)', async () => {
    let resolveFn!: (v: { data: { publicKey: string } }) => void;
    const get = vi.fn(
      () =>
        new Promise<{ data: { publicKey: string } }>((res) => {
          resolveFn = res;
        }),
    );
    const kms = createKmsClient({ axios: { get } as any, keyIdResolver: () => 'k1' });

    const p1 = kms.getPublicKey();
    const p2 = kms.getPublicKey();
    expect(get).toHaveBeenCalledTimes(1);

    resolveFn({ data: { publicKey: 'KEY' } });
    expect(await p1).toBe('KEY');
    expect(await p2).toBe('KEY');
  });

  it('실패는 캐시 안 됨 → 다음 호출에서 재시도 가능 + KmsError로 래핑', async () => {
    let attempts = 0;
    const axios = {
      get: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('network');
        return { data: { publicKey: 'KEY2' } };
      }),
    } as any;
    const kms = createKmsClient({ axios, keyIdResolver: () => 'k1' });

    await expect(kms.getPublicKey()).rejects.toBeInstanceOf(KmsError);
    expect(await kms.getPublicKey()).toBe('KEY2');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
